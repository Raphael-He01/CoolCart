import Foundation

enum PurchaseReviewRequest {
    static func endpoint(from importEndpoint: URL?) -> URL? {
        guard let importEndpoint,
              var parts = URLComponents(url: importEndpoint, resolvingAgainstBaseURL: false),
              parts.scheme == "https", parts.host?.isEmpty == false,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.percentEncodedPath == "/api/import-product" else { return nil }
        parts.path = "/api/purchase-review"
        return parts.url
    }

    static func payload(_ input: Any) -> [String: Any]? {
        guard let body = input as? [String: Any], let phase = body["phase"] as? String,
              phase == "questions" || phase == "reminder",
              Set(body.keys) == (phase == "questions" ? ["phase", "product"] : ["phase", "product", "questions", "answers"]),
              let product = body["product"] as? [String: Any],
              Set(product.keys).isSubset(of: ["name", "category", "variant", "price"]),
              let name = text(product["name"], 1...120) else { return nil }
        var cleanProduct: [String: Any] = ["name": name]
        for key in ["category", "variant"] {
            if let value = product[key] {
                guard let value = text(value, 0...60) else { return nil }
                cleanProduct[key] = value
            }
        }
        if let value = product["price"] {
            if value is NSNull {
                cleanProduct["price"] = NSNull()
            } else {
                guard let price = value as? NSNumber, CFGetTypeID(price) != CFBooleanGetTypeID(),
                      (0...10_000_000).contains(price.doubleValue) else { return nil }
                cleanProduct["price"] = price
            }
        }
        var result: [String: Any] = ["phase": phase, "product": cleanProduct]
        if phase == "reminder" {
            guard let questions = pair(body["questions"], maxLength: 120),
                  let answers = pair(body["answers"], maxLength: 500) else { return nil }
            result["questions"] = questions
            result["answers"] = answers
        }
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: .withoutEscapingSlashes),
              data.count <= 16 * 1024 else { return nil }
        return result
    }

    private static func text(_ value: Any?, _ length: ClosedRange<Int>) -> String? {
        guard let raw = value as? String else { return nil }
        let clean = raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard length.contains(clean.utf16.count), !clean.unicodeScalars.contains(where: {
            $0.properties.generalCategory == .control || $0.properties.generalCategory == .format
        }) else { return nil }
        return clean
    }

    private static func pair(_ value: Any?, maxLength: Int) -> [String]? {
        guard let values = value as? [String], values.count == 2,
              let first = text(values[0], 1...maxLength), let second = text(values[1], 1...maxLength) else { return nil }
        return [first, second]
    }
}
