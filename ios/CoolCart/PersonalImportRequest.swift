import Foundation

enum PersonalImportRequest {
    static func make(_ input: Any, key: String) -> URLRequest? {
        guard let message = input as? [String: Any], Set(message.keys) == ["path", "body"],
              let path = message["path"] as? String, let body = message["body"] as? [String: Any] else { return nil }
        let payload: [String: Any]
        switch path {
        case "/v1/tools/fetch":
            guard body.count == 1, let link = ProductImportBridge.productLink(body["url"] as Any) else { return nil }
            payload = ["url": link]
        case "/v1/tools/search":
            guard Set(body.keys).isSubset(of: ["query", "count", "need_content"]),
                  body["need_content"] == nil || body["need_content"] as? Bool == true,
                  let query = body["query"] as? String, !query.isEmpty, query.utf8.count <= 2048,
                  let count = body["count"] as? Int, (1...5).contains(count) else { return nil }
            payload = body
        case "/chat/completions":
            let required: Set<String> = ["model", "thinking", "response_format", "max_tokens", "messages"]
            let fields = Set(body.keys)
            guard fields == required || fields == required.union(["temperature"]),
                  body["model"] as? String == "deepseek-flash",
                  body["thinking"] as? [String: String] == ["type": "disabled"],
                  body["response_format"] as? [String: String] == ["type": "json_object"],
                  let tokens = body["max_tokens"] as? Int, (1...650).contains(tokens),
                  let messages = body["messages"] as? [[String: Any]], messages.count == 2,
                  messages[0].count == 2, messages[0]["role"] as? String == "system",
                  validText(messages[0]["content"], maxBytes: 4096),
                  messages[1].count == 2, messages[1]["role"] as? String == "user",
                  validUserContent(messages[1]["content"]) else { return nil }
            if let temperature = body["temperature"] {
                guard messages[1]["content"] is [[String: Any]], let number = temperature as? NSNumber,
                      CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue == 0 else { return nil }
            }
            payload = body
        default:
            return nil
        }
        guard let url = URL(string: "https://api.deepseek.com" + path),
              let data = try? JSONSerialization.data(withJSONObject: payload, options: .withoutEscapingSlashes) else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
        request.httpBody = data
        return request
    }

    private static func validText(_ value: Any?, maxBytes: Int) -> Bool {
        guard let text = value as? String else { return false }
        return !text.isEmpty && text.utf8.count <= maxBytes
    }

    private static func validUserContent(_ content: Any?) -> Bool {
        if validText(content, maxBytes: 192 * 1024) { return true }
        guard let parts = content as? [[String: Any]], parts.count == 2,
              parts[0].count == 2, parts[0]["type"] as? String == "text", validText(parts[0]["text"], maxBytes: 4096),
              parts[1].count == 2, parts[1]["type"] as? String == "image_url",
              let image = parts[1]["image_url"] as? [String: String], image.count == 1 else { return false }
        return ProductScreenshot.validated(image["url"]) != nil
    }
}
