import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum CartScreenshotCrop {
    // A small JPEG stays readable when enlarged and inexpensive to move through the local inbox.
    static let maxBytes = 18 * 1024
    static let batchBytes = 192 * 1024

    static func jpeg(from image: CGImage, bounds: CGRect, byteLimit: Int = maxBytes) -> Data? {
        let width = CGFloat(image.width)
        let height = CGFloat(image.height)
        let pixels = CGRect(x: bounds.minX * width, y: (1 - bounds.maxY) * height,
                            width: bounds.width * width, height: bounds.height * height).integral
        guard byteLimit > 0, !pixels.isEmpty, let cropped = image.cropping(to: pixels) else { return nil }
        for (extent, quality) in [(700, 0.74), (540, 0.67), (420, 0.61), (340, 0.52)] {
            guard let image = resize(cropped, maxExtent: extent) else { continue }
            let output = NSMutableData()
            guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else {
                return nil
            }
            CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
            if CGImageDestinationFinalize(destination), output.length <= byteLimit {
                return output as Data
            }
        }
        return nil
    }

    private static func resize(_ image: CGImage, maxExtent: Int) -> CGImage? {
        let extent = max(image.width, image.height)
        guard extent > maxExtent else { return image }
        let ratio = CGFloat(maxExtent) / CGFloat(extent)
        let width = max(1, Int(CGFloat(image.width) * ratio))
        let height = max(1, Int(CGFloat(image.height) * ratio))
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
            return nil
        }
        context.interpolationQuality = .high
        context.setFillColor(red: 1, green: 1, blue: 1, alpha: 1)
        let area = CGRect(x: 0, y: 0, width: width, height: height)
        context.fill(area)
        context.draw(image, in: area)
        return context.makeImage()
    }
}
