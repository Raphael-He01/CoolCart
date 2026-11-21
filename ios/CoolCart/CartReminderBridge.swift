import CoreFoundation
import UIKit
import UserNotifications
import WebKit

private struct CartReminderTarget: Equatable, Sendable {
    enum Kind: String, Sendable {
        case cooldown, followUp

        var title: String {
            switch self {
            case .cooldown: return "冷静期结束"
            case .followUp: return "买后回访到期"
            }
        }
    }

    static let prefix = "com.crosspointx.coolcart.reminder."
    let itemId: String
    let kind: Kind
    let dueAt: Int64

    init?(fields: [AnyHashable: Any]) {
        guard let itemId = fields["itemId"] as? String,
              itemId.range(of: #"\A[A-Za-z0-9._-]{1,128}\z"#, options: .regularExpression) != nil,
              let kindName = fields["kind"] as? String, let kind = Kind(rawValue: kindName),
              let timestamp = fields["dueAt"] as? NSNumber, CFGetTypeID(timestamp) != CFBooleanGetTypeID(),
              timestamp.doubleValue > 0, timestamp.doubleValue <= 8.64e15,
              let dueAt = Int64(exactly: timestamp.doubleValue) else { return nil }
        self.itemId = itemId
        self.kind = kind
        self.dueAt = dueAt
    }

    init?(request: UNNotificationRequest) {
        self.init(fields: request.content.userInfo)
        guard identifier == request.identifier else { return nil }
    }

    var identifier: String { Self.prefix + kind.rawValue + "." + itemId }
    var payload: [String: Any] { ["itemId": itemId, "kind": kind.rawValue, "dueAt": dueAt] }
    var fireDate: Date { Date(timeIntervalSince1970: ceil(Double(dueAt) / 1_000)) }

    var request: UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = kind.title
        content.body = "打开 CoolCart 查看这件商品。"
        content.userInfo = payload
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        var components = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: fireDate)
        components.timeZone = calendar.timeZone
        components.calendar = calendar
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        return UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
    }
}

private struct CartReminderStatus: Sendable {
    var permission: String
    var scheduled = 0
    var waiting = 0
    var failed = false

    var payload: [String: Any] {
        ["permission": permission, "scheduled": scheduled, "waiting": waiting, "failed": failed]
    }
}

extension Notification.Name {
    static let coolCartReminderOpened = Notification.Name("coolCartReminderOpened")
}

@MainActor
final class CartReminderCenter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = CartReminderCenter()
    private static let limit = 64
    private let center = UNUserNotificationCenter.current()
    private var pendingOpen: CartReminderTarget?
    private var syncTask: Task<CartReminderStatus, Never>?

    func installDelegate() {
        center.delegate = self
    }

    func takeOpen() -> [String: Any]? {
        defer { pendingOpen = nil }
        return pendingOpen?.payload
    }

    func authorize() async throws {
        if await center.notificationSettings().authorizationStatus == .notDetermined {
            _ = try await center.requestAuthorization(options: [.alert])
        }
    }

    fileprivate func sync(_ plan: [CartReminderTarget]) async -> [String: Any] {
        let previous = syncTask
        let task = Task {
            // A snapshot that arrived later must reconcile after earlier writes finish.
            _ = await previous?.value
            return await reconcile(plan)
        }
        syncTask = task
        return await task.value.payload
    }

    private func reconcile(_ plan: [CartReminderTarget]) async -> CartReminderStatus {
        let authorization = await center.notificationSettings().authorizationStatus
        var status = CartReminderStatus(permission: "allowed")
        let targets: [String: CartReminderTarget]
        switch authorization {
        case .authorized, .provisional, .ephemeral:
            targets = Dictionary(plan.map { ($0.identifier, $0) }, uniquingKeysWith: { _, recent in recent })
        case .notDetermined:
            status.permission = "notDetermined"
            targets = [:]
        default:
            status.permission = "denied"
            targets = [:]
        }

        let pending = await center.pendingNotificationRequests()
        let delivered = await center.deliveredNotifications()
        let managed = pending.filter { $0.identifier.hasPrefix(CartReminderTarget.prefix) }
        let stableDelivered = reconcileDelivered(delivered, targets: targets)
        let now = Date()
        let matching = managed.compactMap(CartReminderTarget.init(request:)).filter { targets[$0.identifier] == $0 }
        // The scheduler can still be delivering a relevant notification when the app returns at its deadline.
        let expiring = matching.filter { $0.fireDate <= now && !stableDelivered.contains($0.identifier) }
        let future = targets.values.filter { $0.fireDate > now && !stableDelivered.contains($0.identifier) }
            .sorted { $0.dueAt == $1.dueAt ? $0.identifier < $1.identifier : $0.dueAt < $1.dueAt }
        let chosen = future.prefix(max(0, Self.limit - (pending.count - managed.count) - expiring.count))
        let chosenIds = Set(chosen.map(\.identifier))
        let existing = Set(matching.map(\.identifier)).intersection(chosenIds)
        let retained = existing.union(expiring.map(\.identifier))
        let obsolete = managed.map(\.identifier).filter { !retained.contains($0) }
        status.waiting = future.count - chosen.count

        if !obsolete.isEmpty {
            center.removePendingNotificationRequests(withIdentifiers: obsolete)
        }
        status.scheduled = existing.count
        for target in chosen where !existing.contains(target.identifier) && target.fireDate > Date() {
            do {
                try await center.add(target.request)
                status.scheduled += 1
            } catch {
                status.failed = true
            }
        }
        return status
    }

    private func reconcileDelivered(_ delivered: [UNNotification],
                                    targets: [String: CartReminderTarget]) -> Set<String> {
        var current = Set<String>()
        var obsolete = [String]()
        for notification in delivered where notification.request.identifier.hasPrefix(CartReminderTarget.prefix) {
            let request = notification.request
            if let target = targets[request.identifier], target == CartReminderTarget(request: request) {
                current.insert(request.identifier)
            } else {
                obsolete.append(request.identifier)
            }
        }
        if !obsolete.isEmpty {
            center.removeDeliveredNotifications(withIdentifiers: obsolete)
        }
        return current
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let options: UNNotificationPresentationOptions =
            CartReminderTarget(request: notification.request) == nil ? [] : [.banner, .list]
        DispatchQueue.main.async {
            completionHandler(options)
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        let target = response.actionIdentifier == UNNotificationDefaultActionIdentifier
            ? CartReminderTarget(request: response.notification.request) : nil
        DispatchQueue.main.async {
            if let target {
                self.pendingOpen = target
                NotificationCenter.default.post(name: .coolCartReminderOpened, object: nil)
            }
            // iOS transitions the scene within this callback and expects the main thread.
            completionHandler()
        }
    }
}

final class CartReminderBridge: NSObject, WKScriptMessageHandlerWithReply {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url,
              BundledWebContent.contains(url), let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            replyHandler(nil, "Invalid reminder request")
            return
        }

        switch action {
        case "sync":
            guard let fields = body["requests"] as? [[String: Any]] else {
                replyHandler(nil, "Invalid reminder plan")
                return
            }
            let targets = fields.compactMap { CartReminderTarget(fields: $0) }
            guard targets.count == fields.count else {
                replyHandler(nil, "Invalid reminder target")
                return
            }
            Task { @MainActor in replyHandler(await CartReminderCenter.shared.sync(targets), nil) }
        case "authorize":
            Task { @MainActor in
                do {
                    try await CartReminderCenter.shared.authorize()
                    replyHandler(true, nil)
                } catch {
                    replyHandler(nil, "Notification permission unavailable")
                }
            }
        case "takeOpen":
            Task { @MainActor in replyHandler(CartReminderCenter.shared.takeOpen() ?? (NSNull() as Any), nil) }
        case "openSettings":
            Task { @MainActor in
                let url = URL(string: UIApplication.openSettingsURLString)!
                let opened = await UIApplication.shared.open(url)
                replyHandler(opened, opened ? nil : "Unable to open notification settings")
            }
        default:
            replyHandler(nil, "Unknown reminder action")
        }
    }
}
