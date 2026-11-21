import Foundation

struct CartShareBatch: Codable {
    let id: UUID
    let sharedAt: Date
    private(set) var products: [CartScreenProduct]

    init(recognized: [CartScreenProduct]) {
        id = UUID()
        sharedAt = Date()
        var merged = Self.mergeOverlappingProducts(recognized)
        let priority = merged.indices.filter { merged[$0].priceCents == nil }
        let priced = merged.indices.filter { merged[$0].priceCents != nil }
        var remaining = CartScreenshotCrop.batchBytes
        for index in priority + priced {
            guard let crop = merged[index].screenshotCrop else { continue }
            if crop.count > remaining {
                merged[index].screenshotCrop = nil
            } else {
                remaining -= crop.count
            }
        }
        products = merged
    }

    func removingScreenshotCrops() -> Self {
        var batch = self
        for index in batch.products.indices { batch.products[index].screenshotCrop = nil }
        return batch
    }

    static func mergeOverlappingProducts(_ products: [CartScreenProduct]) -> [CartScreenProduct] {
        let platforms = Dictionary(grouping: products, by: \.productKey).mapValues {
            Set($0.map(\.platform).filter { !$0.isEmpty })
        }

        // Keep the first appearance of each SKU-sized description. A header may
        // be out of view on an overlapping screen, so use its identified
        // platform only when these screenshots agree on one marketplace.
        struct Key: Hashable {
            let product: String
            let platform: String
        }
        var order: [Key] = []
        var first: [Key: CartScreenProduct] = [:]
        var previews: [Key: CartScreenProduct] = [:]
        var prices: [Key: Set<Int>] = [:]
        for product in products {
            let known = platforms[product.productKey] ?? []
            let recognizedPlatform = known.count == 1 ? known.first : nil
            let platform = product.platform.isEmpty ? (recognizedPlatform ?? "") : product.platform
            let key = Key(product: product.productKey, platform: platform)
            if first[key] == nil {
                order.append(key)
                first[key] = product
            }
            if let cents = product.priceCents {
                prices[key, default: []].insert(cents)
            }
            if product.screenshotCrop != nil, previews[key] == nil
                || (previews[key]?.priceCents == nil && product.priceCents != nil) {
                previews[key] = product
            }
        }
        return order.compactMap { key in
            guard let product = first[key] else { return nil }
            let observed = prices[key] ?? []
            let price = observed.count == 1 ? observed.first : nil
            // A crop showing one conflicting price could be mistaken for the confirmed amount.
            let preview = observed.count <= 1 && previews[key]?.priceCents == price ? previews[key]?.screenshotCrop : nil
            return CartScreenProduct(name: product.name, variant: product.variant, platform: key.platform,
                                     priceCents: price, screenshotCrop: preview)
        }
    }
}
