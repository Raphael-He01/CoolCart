import Foundation
import Security

enum PersonalImportKey {
    private static var item: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: (Bundle.main.bundleIdentifier ?? "CoolCart") + ".productImport",
         kSecAttrAccount as String: "deepseek"]
    }

    static func read() -> String? {
        var query = item
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    #if DEBUG
    static func consumeDevelopmentFile() {
        let directory = FileManager.default.temporaryDirectory
        let file = directory.appendingPathComponent("CoolCartPersonalImport.key")
        guard FileManager.default.fileExists(atPath: file.path) else { return }
        defer { try? FileManager.default.removeItem(at: file) }
        var ready = false
        if let data = try? Data(contentsOf: file), data.count <= 4096,
           let token = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !token.isEmpty, token.utf8.allSatisfy({ (33...126).contains($0) }) {
            let fields: [String: Any] = [kSecValueData as String: Data(token.utf8),
                                         kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
            var status = SecItemUpdate(item as CFDictionary, fields as CFDictionary)
            if status == errSecItemNotFound {
                status = SecItemAdd(item.merging(fields) { _, new in new } as CFDictionary, nil)
            }
            ready = status == errSecSuccess && read() == token
        }
        let receipt = directory.appendingPathComponent("CoolCartPersonalImport.result")
        try? (ready ? "ready" : "failed").write(to: receipt, atomically: true, encoding: .utf8)
    }
    #endif
}
