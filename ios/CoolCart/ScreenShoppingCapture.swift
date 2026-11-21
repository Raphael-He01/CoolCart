#if canImport(ScreenCaptureKit)
import CoreMedia
import ImageIO
import ScreenCaptureKit
import UIKit
import Vision
import WebKit

@available(iOS 27.0, *)
private final class ShoppingFrameReader: NSObject, SCStreamOutput {
    let inputQueue = DispatchQueue(label: "CoolCart.shopping.frames")
    private let ocrQueue = DispatchQueue(label: "CoolCart.shopping.ocr", qos: .utility)
    private var detector = CartScreenDetector() // Accessed only on ocrQueue.
    private var failures = 0
    private var preferCPU = false // Only read or written on ocrQueue.
    private var accepting = false
    private var busy = false
    private var lastSample = -TimeInterval.infinity
    var onProducts: (([CartScreenProduct]) -> Void)?
    var onFailure: (() -> Void)?

    func setAccepting(_ enabled: Bool) {
        // inputQueue only gates frames. Stopping never waits on a Vision request.
        inputQueue.sync { accepting = enabled }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        let time = ProcessInfo.processInfo.systemUptime
        guard accepting, !busy, time - lastSample >= 0.45, type == .screen,
              sample.isValid, let image = sample.imageBuffer else { return }
        busy = true
        lastSample = time
        let info = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]]
        let orientation = (info?.first?[.videoOrientation] as? NSNumber)
            .flatMap { CGImagePropertyOrientation(rawValue: $0.uint32Value) } ?? .up

        // At most one pixel buffer is retained. A scroll cannot queue a backlog of shopping screens.
        ocrQueue.async {
            defer { self.inputQueue.async { self.busy = false } }
            autoreleasepool {
                do {
                    let lines: [ScreenTextObservation]
                    do {
                        lines = try self.recognize(image, orientation: orientation, cpuOnly: self.preferCPU)
                    } catch {
                        let alternative = !self.preferCPU
                        lines = try self.recognize(image, orientation: orientation, cpuOnly: alternative)
                        self.preferCPU = alternative
                    }
                    let products = self.detector.observe(lines, at: time)
                    self.failures = 0
                    if !products.isEmpty { DispatchQueue.main.async { self.onProducts?(products) } }
                } catch {
                    self.detector = CartScreenDetector()
                    self.failures += 1
                    if self.failures == 3 { DispatchQueue.main.async { self.onFailure?() } }
                }
            }
        }
    }

    private func recognize(_ image: CVPixelBuffer, orientation: CGImagePropertyOrientation,
                           cpuOnly: Bool) throws -> [ScreenTextObservation] {
        try CartTextRecognition.observations(using: VNImageRequestHandler(cvPixelBuffer: image, orientation: orientation),
                                             cpuOnly: cpuOnly)
    }
}

@available(iOS 27.0, *)
private final class ShoppingCaptureSession: NSObject, SCContentSharingPickerObserver, SCStreamDelegate {
    enum Phase: String { case picking, starting, running, stopping, ended }
    let frames = ShoppingFrameReader()
    private let picker = SCContentSharingPicker.shared
    private var stream: SCStream?
    private(set) var phase = Phase.picking
    private var inBackground = false
    private var timeout: DispatchWorkItem?
    private var stopWatchdog: DispatchWorkItem?
    private var finishMessage = "已结束识别。"
    var onEnd: ((String) -> Void)?

    func present() {
        var configuration = SCContentSharingPickerConfiguration()
        configuration.showsMicrophoneControl = false
        configuration.showsCameraControl = false
        picker.defaultConfiguration = configuration
        picker.add(self)
        picker.isActive = true
        let deadline = DispatchWorkItem { [weak self] in self?.stop("已到两分钟，购物车识别已结束。") }
        timeout = deadline
        DispatchQueue.main.asyncAfter(deadline: .now() + 120, execute: deadline)
        picker.present()
    }

    func enteredBackground() {
        inBackground = true
        if phase == .running { frames.setAccepting(true) }
    }

    func returningToApp() {
        guard inBackground else { return }
        inBackground = false
        frames.setAccepting(false)
        if phase == .running || phase == .starting { stop("已返回 CoolCart，屏幕共享已结束。") }
    }

    func stop(_ message: String = "已结束识别。") {
        frames.setAccepting(false)
        switch phase {
        case .picking: finish(message)
        case .starting:
            finishMessage = message
            phase = .stopping // Stop as soon as the system finishes starting the stream.
            scheduleStopWatchdog { [weak self] in self?.stopStream() }
        case .running:
            finishMessage = message
            phase = .stopping
            stopStream()
        case .stopping, .ended: break
        }
    }

    private func scheduleStopWatchdog(_ action: @escaping () -> Void) {
        stopWatchdog?.cancel()
        let work = DispatchWorkItem(block: action)
        stopWatchdog = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: work)
    }

    private func stopStream() {
        guard let stream else { finish(finishMessage); return }
        let systemStopNotice = "本机识别已停止。若仍显示共享标志，请在系统共享控件结束。"
        scheduleStopWatchdog { [weak self] in self?.finish(systemStopNotice) }
        stream.stopCapture { [weak self] error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.finish(error == nil ? self.finishMessage : systemStopNotice)
            }
        }
    }

    private func finish(_ message: String) {
        guard phase != .ended else { return }
        phase = .ended
        frames.setAccepting(false)
        timeout?.cancel()
        stopWatchdog?.cancel()
        picker.remove(self)
        picker.isActive = false
        stream = nil
        onEnd?(message)
    }

    func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for updated: SCStream?) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let updated {
                if self.stream === updated { self.stop("共享画面已更换，请重新开始购物车识别。") }
                return
            }
            guard self.phase == .picking else { return }
            let config = SCStreamConfiguration()
            config.capturesAudio = false
            let next = SCStream(filter: filter, configuration: config, delegate: self)
            do {
                try next.addStreamOutput(self.frames, type: .screen, sampleHandlerQueue: self.frames.inputQueue)
                self.stream = next
                self.phase = .starting
                next.startCapture { [weak self] error in
                    DispatchQueue.main.async {
                        guard let self, self.stream === next else {
                            if error == nil { next.stopCapture { _ in } }
                            return
                        }
                        if error != nil { self.finish("共享未能启动，请重新选择屏幕。"); return }
                        if self.phase == .stopping { self.stopStream(); return }
                        self.phase = .running
                        self.frames.setAccepting(self.inBackground)
                    }
                }
            } catch { self.finish("系统无法读取共享画面，请重试。") }
        }
    }

    func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        DispatchQueue.main.async { if self.phase == .picking { self.finish("已取消共享。") } }
    }

    func contentSharingPickerStartDidFailWithError(_ error: Error) {
        DispatchQueue.main.async { if self.phase == .picking { self.finish("系统选屏暂不可用，请重试。") } }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async {
            if self.stream === stream { self.finish(self.phase == .stopping ? self.finishMessage : "系统已结束屏幕共享。") }
        }
    }
}

@available(iOS 27.0, *)
final class ScreenShoppingCapture: NSObject, WKScriptMessageHandlerWithReply {
    private struct Item {
        let id = UUID().uuidString
        var product: CartScreenProduct
    }

    private struct ProductKey: Hashable {
        let name: String
        let variant: String
        let platform: String

        init(_ product: CartScreenProduct) {
            func normalized(_ value: String) -> String {
                value.folding(options: [.caseInsensitive, .widthInsensitive], locale: Locale(identifier: "zh_CN"))
                    .components(separatedBy: .whitespacesAndNewlines).joined()
            }
            name = normalized(product.name)
            variant = normalized(product.variant)
            platform = normalized(product.platform)
        }
    }

    private var session: ShoppingCaptureSession?
    private var items: [Item] = []
    private var dismissed: Set<ProductKey> = []
    private var notice = ""
    private let pendingKey: String
    private var completed: CartShareBatch?

    init(demo: Bool) {
        let key = demo ? "screen-shopping.v1.demo" : "screen-shopping.v1"
        pendingKey = key
        if let data = UserDefaults.standard.data(forKey: key) {
            completed = try? JSONDecoder().decode(CartShareBatch.self, from: data)
        }
        super.init()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(background), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(foreground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    @objc private func background() { session?.enteredBackground() }
    @objc private func foreground() { session?.returningToApp() }

    private func existingIndex(for key: ProductKey) -> Int? {
        if let exact = items.firstIndex(where: { ProductKey($0.product) == key }) { return exact }
        // A platform heading can scroll out of view. Only merge an unlabeled row
        // if exactly one otherwise identical candidate could have produced it.
        let matches = items.indices.filter { index in
            let other = ProductKey(items[index].product)
            return key.name == other.name && key.variant == other.variant && (key.platform.isEmpty || other.platform.isEmpty)
        }
        return matches.count == 1 ? matches.first : nil
    }

    private func collect(_ products: [CartScreenProduct]) {
        for product in products {
            let key = ProductKey(product)
            guard !dismissed.contains(key) else { continue }
            if let index = existingIndex(for: key) {
                let prior = items[index].product
                items[index].product = CartScreenProduct(name: product.name, variant: product.variant,
                    platform: product.platform.isEmpty ? prior.platform : product.platform,
                    priceCents: product.priceCents ?? prior.priceCents)
            } else if items.count < 30 {
                items.append(Item(product: product))
            } else {
                notice = "已有 30 件待核对商品，请先处理后再继续。"
            }
        }
    }

    private func start() {
        let active = ShoppingCaptureSession()
        session = active
        items.removeAll()
        dismissed.removeAll()
        notice = ""
        active.frames.onProducts = { [weak self, weak active] products in
            guard let self, let active, self.session === active, active.phase == .running else { return }
            self.collect(products)
        }
        active.frames.onFailure = { [weak self, weak active] in
            guard let self, let active, self.session === active else { return }
            active.stop("本机暂时无法识别文字，请重新开始。")
        }
        active.onEnd = { [weak self] message in
            guard let self else { return }
            self.notice = message
            self.session = nil
            self.dismissed.removeAll()
            if self.items.isEmpty {
                if message.contains("已结束") { self.notice += " 未识别到商品。" }
            } else {
                let batch = CartShareBatch(recognized: self.items.map(\.product))
                self.completed = batch
                if let data = try? JSONEncoder().encode(batch) {
                    UserDefaults.standard.set(data, forKey: self.pendingKey)
                }
            }
            self.items.removeAll()
        }
        active.present()
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, BundledWebContent.contains(url),
              let input = message.body as? [String: String], let action = input["action"],
              input.keys.allSatisfy({ $0 == "action" || ($0 == "id" && ["discard", "acknowledge"].contains(action)) }) else {
            replyHandler(nil, "请从购物车识别入口重试。")
            return
        }
        switch action {
        case "start":
            if session == nil {
                guard completed == nil else {
                    replyHandler(nil, "上一批商品还未保存，请处理完成后再开始。")
                    return
                }
                guard UIApplication.shared.applicationState == .active, SCContentSharingPicker.shared.isAvailable else {
                    replyHandler(nil, "当前设备暂不能共享屏幕，请从 iPhone 前台重试，或使用截图导入。")
                    return
                }
                start()
            }
        case "stop": session?.stop()
        case "acknowledge":
            if let completed, completed.id.uuidString == input["id"] {
                self.completed = nil
                UserDefaults.standard.removeObject(forKey: pendingKey)
            }
        case "discard":
            let id = input["id"]
            items.removeAll { row in
                guard id == nil || row.id == id else { return false }
                if session != nil { dismissed.insert(ProductKey(row.product)) }
                return true
            }
        case "status": break
        default:
            replyHandler(nil, "未知的购物车识别操作。")
            return
        }
        var response: [String: Any] = ["phase": session?.phase.rawValue ?? "idle", "notice": notice]
        if let completed {
            let id = completed.id.uuidString
            response["batch"] = ["id": id, "sharedAt": Int64(completed.sharedAt.timeIntervalSince1970 * 1000),
                "items": completed.products.enumerated().map { index, product in product.bridgeRow(id: "\(id):\(index)") }]
        }
        replyHandler(response, nil)
    }
}
#endif
