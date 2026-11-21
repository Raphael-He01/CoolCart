import Foundation
import WebKit

final class FixedEndpointDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

final class ProductImportBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let endpoint: URL?
    private let session: URLSession
    private let largeUploadSession: URLSession

    static func install(in controller: WKUserContentController) {
        #if DEBUG
        PersonalImportKey.consumeDevelopmentFile()
        #endif
        let bridge = ProductImportBridge()
        if bridge.endpoint != nil {
            controller.addScriptMessageHandler(bridge, contentWorld: .page, name: "importProductLink")
            controller.addScriptMessageHandler(bridge, contentWorld: .page, name: "importProductImage")
            controller.addScriptMessageHandler(bridge, contentWorld: .page, name: "importProductQuery")
            controller.addScriptMessageHandler(bridge, contentWorld: .page, name: "lookupCartProduct")
        }
        if PurchaseReviewRequest.endpoint(from: bridge.endpoint) != nil {
            controller.addScriptMessageHandler(bridge, contentWorld: .page, name: "purchaseReview")
        }
        if PersonalImportKey.read() != nil {
            controller.addScriptMessageHandler(bridge, contentWorld: .page, name: "personalProductImport")
            let publicPages = PublicProductPage()
            controller.addScriptMessageHandler(publicPages, contentWorld: .page, name: "publicProductPage")
            controller.addScriptMessageHandler(publicPages, contentWorld: .page, name: "jdPublicProductPage")
        }
    }

    private override init() {
        endpoint = Self.configuredEndpoint()
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.urlCredentialStorage = nil
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 32
        session = URLSession(configuration: config, delegate: FixedEndpointDelegate(), delegateQueue: nil)
        // A 20 MiB screenshot produces a roughly 28 MB JSON upload on a cellular connection.
        config.timeoutIntervalForResource = 180
        largeUploadSession = URLSession(configuration: config, delegate: FixedEndpointDelegate(), delegateQueue: nil)
        super.init()
    }

    private static func configuredEndpoint() -> URL? {
        guard let file = Bundle.main.url(forResource: "ImportEndpoint.local", withExtension: "txt"),
              let raw = try? String(contentsOf: file, encoding: .utf8),
              let components = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme?.lowercased() == "https", let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil, components.query == nil, components.fragment == nil,
              !components.path.isEmpty, components.path != "/" else { return nil }
        return components.url
    }

    deinit {
        session.invalidateAndCancel()
        largeUploadSession.invalidateAndCancel()
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let origin = message.frameInfo.request.url, BundledWebContent.contains(origin) else {
            replyHandler(nil, "请从购物车中的商品导入入口重试。")
            return
        }
        let request: URLRequest
        let personal = message.name == "personalProductImport"
        if personal {
            guard let key = PersonalImportKey.read(), let accepted = PersonalImportRequest.make(message.body, key: key) else {
                replyHandler(nil, "个人商品导入配置或请求无效。")
                return
            }
            request = accepted
        } else {
            guard let endpoint else {
                replyHandler(nil, "商品导入服务未配置。")
                return
            }
            let payload: [String: Any]
            var destination = endpoint
            switch message.name {
            case "purchaseReview":
                guard let target = PurchaseReviewRequest.endpoint(from: endpoint),
                      let review = PurchaseReviewRequest.payload(message.body) else {
                    replyHandler(nil, "商品或回答内容无效，请核对后重试。")
                    return
                }
                destination = target
                payload = review
            case "importProductQuery":
                guard let query = Self.productQuery(message.body) else {
                    replyHandler(nil, "请填写 2 至 160 个字符的商品名称或型号。")
                    return
                }
                payload = ["query": query]
            case "lookupCartProduct":
                guard let item = message.body as? [String: Any],
                      Set(item.keys).isSubset(of: ["name", "variant", "platform", "needsPrice"]),
                      let rawName = item["name"] as? String, let name = Self.productQuery(rawName), name.utf16.count <= 120,
                      let variant = item["variant"] as? String, variant.utf16.count <= 60,
                      Self.productQuery("规格 " + variant) != nil,
                      let platform = item["platform"] as? String, ["", "京东", "淘宝", "天猫"].contains(platform),
                      item["needsPrice"] == nil || item["needsPrice"] is Bool else {
                    replyHandler(nil, "请核对要查找的商品名称、规格和来源平台。")
                    return
                }
                var entry: [String: Any] = ["name": name, "variant": variant, "platform": platform]
                if let needsPrice = item["needsPrice"] as? Bool, needsPrice { entry["needsPrice"] = true }
                payload = ["cartProduct": entry]
            case "importProductImage":
                guard let image = ProductScreenshot.validated(message.body) else {
                    replyHandler(nil, "请选择 20 MB 以内的有效 PNG、JPEG 或 WebP 截图。")
                    return
                }
                payload = ["image": image]
            case "importProductLink":
                guard let link = Self.productLink(message.body) else {
                    replyHandler(nil, "请使用淘宝、天猫或京东商品分享链接。")
                    return
                }
                payload = ["link": link]
            default:
                replyHandler(nil, "请求无效。")
                return
            }
            var post = URLRequest(url: destination)
            post.httpMethod = "POST"
            post.setValue("application/json", forHTTPHeaderField: "Content-Type")
            post.httpBody = try? JSONSerialization.data(withJSONObject: payload, options: .withoutEscapingSlashes)
            request = post
        }

        Task { @MainActor in
            do {
                let transfer = (request.httpBody?.count ?? 0) > 4 * 1024 * 1024 ? largeUploadSession : session
                let (data, response) = try await transfer.data(for: request)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                if personal && request.url?.path == "/v1/tools/fetch" && [403, 404].contains(status) {
                    replyHandler(NSNull(), nil)
                    return
                }
                if personal && [401, 402, 429].contains(status) {
                    replyHandler(nil, "DeepSeek 服务暂不可用，请检查个人密钥、额度或稍后重试。")
                    return
                }
                let limit = personal ? 8 * 1024 * 1024 : 65_536
                let json = data.count <= limit ? (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] : nil
                guard (200..<300).contains(status), let json else {
                    let detail = personal ? nil : json?["message"] as? String
                    let unavailable = message.name == "purchaseReview"
                        ? "购买问答服务暂不可用，请稍后重试。" : "商品导入服务暂不可用，请稍后重试或手动填写。"
                    replyHandler(nil, detail.flatMap { $0.isEmpty ? nil : String($0.prefix(300)) } ?? unavailable)
                    return
                }
                replyHandler(json, nil)
            } catch {
                if message.name == "purchaseReview" {
                    replyHandler(nil, "暂时无法连接购买问答服务，请稍后重试。")
                } else {
                    replyHandler(nil, (error as? URLError)?.code == .timedOut
                        ? "商品导入超时，请重试或手动填写。" : "无法连接商品导入服务，请重试或手动填写。")
                }
            }
        }
    }

    static func productQuery(_ input: Any) -> String? {
        guard let raw = input as? String,
              raw.range(of: #"https?://|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]"#,
                        options: [.regularExpression, .caseInsensitive]) == nil else { return nil }
        let query = raw.split(whereSeparator: { $0.isWhitespace || $0 == "\u{FEFF}" }).joined(separator: " ")
        return (2...160).contains(query.utf16.count) ? query : nil
    }

    static func productLink(_ body: Any) -> String? {
        guard let raw = body as? String, raw.utf16.count <= 2048, var url = URLComponents(string: raw),
              url.scheme == "https", let host = url.host, url.user == nil, url.password == nil,
              url.port == nil, url.fragment == nil else { return nil }
        let params = url.queryItems ?? []
        func digits(_ key: String) -> URLQueryItem? {
            guard let field = params.first(where: { $0.name == key }), let value = field.value,
                  value.range(of: #"^[0-9]+$"#, options: .regularExpression) != nil else { return nil }
            return field
        }
        let sku = digits("skuId")
        switch host {
        case "u.jd.com", "3.cn", "m.tb.cn", "e.tb.cn":
            guard !url.path.isEmpty, url.path != "/" else { return nil }
        case "item.jd.com", "item.m.jd.com":
            let numeric = url.path.range(of: #"^/(?:product/)?[0-9]+\.html$"#, options: .regularExpression) != nil
            let token = host == "item.jd.com" && url.path.range(of: #"^/product/[A-Za-z0-9_-]{22}\.html$"#, options: .regularExpression) != nil
            guard numeric || token else { return nil }
            url.queryItems = sku.map { [$0] }
        case "item.taobao.com", "detail.tmall.com", "detail.m.tmall.com", "h5.m.taobao.com":
            guard ["/item.htm", "/awp/core/item.htm"].contains(url.path), let id = digits("id") else { return nil }
            url.queryItems = [id, sku].compactMap { $0 }
        default:
            return nil
        }
        return url.url?.absoluteString
    }
}
