import Foundation
import ImageIO
import Vision

enum CartTextRecognition {
    static func observations(using handler: VNImageRequestHandler, cpuOnly: Bool = false) throws -> [ScreenTextObservation] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        if cpuOnly {
            for (stage, devices) in try request.supportedComputeStageDevices {
                if let cpu = devices.first(where: { if case .cpu = $0 { return true }; return false }) {
                    request.setComputeDevice(cpu, for: stage)
                }
            }
        }
        try handler.perform([request])
        return (request.results ?? []).compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let text = candidate.string
            let money = text.range(of: #"[¥￥]|^[.0-9,，\s]+$"#, options: .regularExpression) != nil
            guard candidate.confidence >= (money ? 0.45 : 0.30) || CartScreenDetector.isPrivacyMarker(text) else { return nil }
            return ScreenTextObservation(text: text, bounds: observation.boundingBox)
        }
    }

    static func screenshot(at url: URL, onImageReady: ((CGImage) -> Void)? = nil) throws -> [CartScreenProduct] {
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        return try screenshot(from: CGImageSourceCreateWithURL(url as CFURL, options), onImageReady: onImageReady)
    }

    static func screenshot(data: Data, onImageReady: ((CGImage) -> Void)? = nil) throws -> [CartScreenProduct] {
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        return try screenshot(from: CGImageSourceCreateWithData(data as CFData, options), onImageReady: onImageReady)
    }

    private static func screenshot(from source: CGImageSource?, onImageReady: ((CGImage) -> Void)?) throws -> [CartScreenProduct] {
        guard let source, CGImageSourceGetCount(source) > 0 else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let thumbnailOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: 2560
        ]
        let index = CGImageSourceGetPrimaryImageIndex(source)
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, index, thumbnailOptions as CFDictionary) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        onImageReady?(image)
        let lines = try observations(using: VNImageRequestHandler(cgImage: image, orientation: .up))
        let rows = CartScreenDetector.rows(inScreenshot: lines)
        var products = rows.map(\.product)
        // Missing-price rows are certain to need review. Keep their crops first when the image is long.
        let priority = rows.indices.filter { rows[$0].product.priceCents == nil }
        let priced = rows.indices.filter { rows[$0].product.priceCents != nil }
        var remaining = CartScreenshotCrop.batchBytes
        for index in priority + priced {
            guard let bounds = rows[index].cropBounds,
                  let crop = CartScreenshotCrop.jpeg(from: image, bounds: bounds,
                                                    byteLimit: min(CartScreenshotCrop.maxBytes, remaining)) else { continue }
            products[index].screenshotCrop = crop
            remaining -= crop.count
            if remaining == 0 { break }
        }
        return products
    }
}
