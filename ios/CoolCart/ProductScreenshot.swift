import Foundation
import ImageIO
import UniformTypeIdentifiers

enum ProductScreenshot {
    static let maxBytes = 20 * 1024 * 1024
    private static let maxEncodedBytes = ((maxBytes + 2) / 3) * 4
    private static let formats: [String: UTType] = [
        "data:image/png;base64": .png,
        "data:image/jpeg;base64": .jpeg,
        "data:image/webp;base64": .webP,
    ]

    static func validated(_ value: Any?) -> String? {
        guard let url = value as? String, url.utf8.count <= maxEncodedBytes + 32,
              let comma = url.firstIndex(of: ","), let type = formats[String(url[..<comma])] else { return nil }
        let encoded = String(url[url.index(after: comma)...])
        guard !encoded.isEmpty, encoded.utf8.count <= maxEncodedBytes,
              encoded.utf8.count % 4 == 0, let data = Data(base64Encoded: encoded),
              data.count <= maxBytes, let image = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetType(image) as String? == type.identifier, CGImageSourceGetCount(image) > 0,
              let info = CGImageSourceCopyPropertiesAtIndex(image, 0, nil) as? [CFString: Any],
              let width = info[kCGImagePropertyPixelWidth] as? Int, width > 0,
              let height = info[kCGImagePropertyPixelHeight] as? Int, height > 0 else { return nil }
        return url
    }

    static func dataURL(from data: Data) throws -> String {
        guard data.count <= maxBytes else { throw CocoaError(.fileReadTooLarge) }
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, options), CGImageSourceGetCount(source) > 0 else {
            throw CocoaError(.fileReadCorruptFile)
        }
        if let type = CGImageSourceGetType(source) as String?,
           let format = formats.first(where: { $0.value.identifier == type }) {
            return format.key + "," + data.base64EncodedString()
        }

        // Photos can supply an HEIF screenshot even when the file picker requests a compatible representation.
        let thumbnailOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 2560
        ]
        let index = CGImageSourceGetPrimaryImageIndex(source)
        let converted = NSMutableData()
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, index, thumbnailOptions as CFDictionary),
              let jpeg = CGImageDestinationCreateWithData(converted, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        CGImageDestinationAddImage(jpeg, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        guard CGImageDestinationFinalize(jpeg), converted.length <= maxBytes else { throw CocoaError(.fileReadCorruptFile) }
        return "data:image/jpeg;base64," + (converted as Data).base64EncodedString()
    }
}
