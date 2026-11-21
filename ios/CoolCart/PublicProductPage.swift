import Foundation
import WebKit

final class PublicProductPage: NSObject, WKScriptMessageHandlerWithReply {
    private let session: URLSession

    override init() {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForRequest = 5
        config.timeoutIntervalForResource = 7
        session = URLSession(configuration: config, delegate: FixedEndpointDelegate(), delegateQueue: nil)
        super.init()
    }

    deinit { session.invalidateAndCancel() }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let origin = message.frameInfo.request.url, BundledWebContent.contains(origin),
              let url = Self.allowedURL(message.body, includeSources: message.name == "publicProductPage") else {
            replyHandler(NSNull(), nil)
            return
        }
        Task { @MainActor in
            if let html = await Self.fetch(url, session: session) { replyHandler(html, nil) }
            else { replyHandler(NSNull(), nil) }
        }
    }

    static func allowedURL(_ value: Any, includeSources: Bool) -> URL? {
        guard let raw = value as? String, raw.utf8.count <= 2048,
              let parts = URLComponents(string: raw), parts.scheme == "https",
              parts.user == nil, parts.password == nil, parts.port == nil, parts.fragment == nil else { return nil }
        if parts.host == "item.jd.com", let link = ProductImportBridge.productLink(raw) { return URL(string: link) }
        guard includeSources, parts.query == nil else { return nil }
        let pattern: String
        switch parts.host {
        case "watchmono.com":
            pattern = #"^/e/[A-Za-z0-9_-]+$"#
        case "m.ithome.com":
            pattern = #"^/(?:html/[0-9]+|0/[0-9]{3,4}/[0-9]{3})\.htm$"#
        case "www.ithome.com":
            pattern = #"^/(?:html/[0-9]+|0/[0-9]{3,4}/[0-9]{3}|[0-9]{1,2}/[0-9]{3}/[0-9]{3})\.htm$"#
        case "digi.ithome.com":
            pattern = #"^/archiver/[0-9]{1,2}/[0-9]{3}/[0-9]{3}\.htm$"#
        case "www.jd.com":
            pattern = #"(?i)^/(?:(?:pinpai[0-9]*|brand)/[a-z0-9]+|phb/key_[a-z0-9]+|chanpin/[0-9]+)\.html$"#
        case "item.m.jd.com":
            pattern = #"^/product/[0-9]+\.html$"#
        default:
            return nil
        }
        guard parts.percentEncodedPath.range(of: pattern, options: .regularExpression) != nil else { return nil }
        return parts.url
    }

    private nonisolated static func fetch(_ url: URL, session: URLSession) async -> String? {
        let maxBytes = 1024 * 1024
        var request = URLRequest(url: url)
        request.setValue("text/html", forHTTPHeaderField: "Accept")
        do {
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            guard let http = response as? HTTPURLResponse, http.statusCode == 200, http.mimeType == "text/html",
                  http.expectedContentLength <= maxBytes else { return nil }
            var data = Data()
            if http.expectedContentLength > 0 { data.reserveCapacity(Int(http.expectedContentLength)) }
            for try await byte in bytes {
                guard data.count < maxBytes else { return nil }
                data.append(byte)
            }
            return data.isEmpty ? nil : String(data: data, encoding: .utf8)
        } catch {
            return nil
        }
    }
}
