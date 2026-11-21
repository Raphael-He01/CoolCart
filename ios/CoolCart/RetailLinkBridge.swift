import UIKit
import WebKit

final class RetailLinkBridge: NSObject, WKScriptMessageHandlerWithReply {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let origin = message.frameInfo.request.url,
              BundledWebContent.contains(origin), let raw = message.body as? String else {
            replyHandler(false, nil)
            return
        }
        if message.name == "copyRetailQuery" {
            let query = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !query.isEmpty, query.utf8.count <= 1024,
                  !query.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) else {
                replyHandler(false, nil)
                return
            }
            Task { @MainActor in
                UIPasteboard.general.string = query
                replyHandler(true, nil)
            }
            return
        }
        guard raw.utf8.count <= 8192,
              let url = URL(string: raw), let scheme = url.scheme?.lowercased(), ["https", "http"].contains(scheme),
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil else {
            replyHandler(false, nil)
            return
        }

        Task { @MainActor in
            replyHandler(await Self.open(url), nil)
        }
    }

    @MainActor
    private static func open(_ url: URL) async -> Bool {
        let application = UIApplication.shared
        if url.absoluteString == "https://cart.jd.com/cart_index" {
            if let cart = jdAppURL(destination: "cartB"), await application.open(cart) { return true }
            if await application.open(url, options: [.universalLinksOnly: true]) { return true }
            return await application.open(url)
        }
        var webURL = url
        if let product = ProductImportBridge.productLink(url.absoluteString), let merchantURL = URL(string: product) {
            if let sku = jdSKU(in: merchantURL) {
                if let appURL = jdAppURL(destination: "productDetail", sku: sku), await application.open(appURL) { return true }
                if let mobileURL = URL(string: "https://item.m.jd.com/product/\(sku).html") { webURL = mobileURL }
            }
            if await application.open(merchantURL, options: [.universalLinksOnly: true]) { return true }
            if webURL != url, webURL != merchantURL,
               await application.open(webURL, options: [.universalLinksOnly: true]) { return true }
        }
        return await application.open(webURL)
    }

    private static func jdSKU(in url: URL) -> String? {
        guard ["item.jd.com", "item.m.jd.com"].contains(url.host),
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        if let sku = parts.queryItems?.first(where: { $0.name == "skuId" })?.value,
           sku.range(of: #"^[0-9]+$"#, options: .regularExpression) != nil { return sku }
        let filename = url.deletingPathExtension().lastPathComponent
        return filename.range(of: #"^[0-9]+$"#, options: .regularExpression) != nil ? filename : nil
    }

    private static func jdAppURL(destination: String, sku: String? = nil) -> URL? {
        var parts = URLComponents()
        parts.scheme = "openApp.jdMobile"
        parts.host = "virtual"
        var payload = ["category": "jump", "des": destination]
        payload["skuId"] = sku
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let parameters = String(data: data, encoding: .utf8) else { return nil }
        parts.queryItems = [URLQueryItem(name: "params", value: parameters)]
        return parts.url
    }
}
