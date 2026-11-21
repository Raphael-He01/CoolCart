import WebKit

final class CartShareBridge: NSObject, WKScriptMessageHandlerWithReply {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, BundledWebContent.contains(url),
              let command = message.body as? [String: Any], let action = command["action"] as? String else {
            replyHandler(nil, "请从 CoolCart 读取截屏分享。")
            return
        }
        do {
            switch action {
            case "pending":
                let batches = try CartShareInbox.pending().map { batch -> [String: Any] in
                    let id = batch.id.uuidString
                    let rows = batch.products.enumerated().map { index, product in
                        product.bridgeRow(id: id + "-" + String(index))
                    }
                    return ["id": id, "sharedAt": Int64(batch.sharedAt.timeIntervalSince1970 * 1000), "items": rows]
                }
                replyHandler(batches, nil)
            case "acknowledge":
                guard let keys = command["ids"] as? [String] else {
                    replyHandler(nil, "截屏分享确认格式无效。")
                    return
                }
                let ids = keys.compactMap(UUID.init(uuidString:))
                guard ids.count == keys.count else {
                    replyHandler(nil, "截屏分享确认编号无效。")
                    return
                }
                try CartShareInbox.acknowledge(ids)
                replyHandler(true, nil)
            default:
                replyHandler(nil, "截屏分享请求无效。")
            }
        } catch {
            replyHandler(nil, "暂时无法同步截屏分享，请保持解锁并重新打开 CoolCart。")
        }
    }
}
