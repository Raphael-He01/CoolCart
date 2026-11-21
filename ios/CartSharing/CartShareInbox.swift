import Foundation
import Security

// OCR results and small item crops cross the extension boundary. Each share is an
// independent local item, so consecutive shares cannot overwrite each other.
enum CartShareInbox {
    private static let service = "com.crosspointx.coolcart.cart-share-batch.v1"

    private struct InboxError: Error {
        let status: OSStatus
    }

    private static func query() throws -> [String: Any] {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "CoolCartShareInboxAccessGroup") as? String,
              !group.isEmpty, !group.hasPrefix(".") else { throw InboxError(status: errSecMissingEntitlement) }
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: group,
            kSecAttrSynchronizable as String: false
        ]
    }

    static func submit(_ batch: CartShareBatch) throws {
        var item = try query()
        item[kSecAttrAccount as String] = batch.id.uuidString
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let encoder = JSONEncoder()
        encoder.outputFormatting = .withoutEscapingSlashes
        item[kSecValueData as String] = try encoder.encode(batch)
        var status = SecItemAdd(item as CFDictionary, nil)
        if (status == errSecDataTooLarge || status == errSecParam),
           batch.products.contains(where: { $0.screenshotCrop != nil }) {
            item[kSecValueData as String] = try encoder.encode(batch.removingScreenshotCrops())
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw InboxError(status: status) }
    }

    static func pending() throws -> [CartShareBatch] {
        var request = try query()
        request[kSecMatchLimit as String] = kSecMatchLimitAll
        request[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return [] }
        guard status == errSecSuccess, let records = result as? [Data] else { throw InboxError(status: status) }
        let decoder = JSONDecoder()
        return records.compactMap { try? decoder.decode(CartShareBatch.self, from: $0) }.sorted {
            $0.sharedAt == $1.sharedAt ? $0.id.uuidString < $1.id.uuidString : $0.sharedAt < $1.sharedAt
        }
    }

    static func acknowledge(_ ids: [UUID]) throws {
        let base = try query()
        for id in ids {
            var record = base
            record[kSecAttrAccount as String] = id.uuidString
            let status = SecItemDelete(record as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw InboxError(status: status) }
        }
    }
}
