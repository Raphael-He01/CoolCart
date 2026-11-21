import UniformTypeIdentifiers
import WebKit

// The fixed origin keeps WebKit storage accessible across app updates.
final class BundledWebContent: NSObject, WKURLSchemeHandler {
    static let scheme = "coolcart"
    private static let host = "app"

    static func home(demo: Bool) -> URL {
        var url = URLComponents()
        url.scheme = scheme
        url.host = host
        url.path = "/"
        var options: [URLQueryItem] = []
        if demo { options.append(URLQueryItem(name: "demo", value: "1")) }
        #if DEBUG
        options.append(URLQueryItem(name: "testBuild", value: "1"))
        #endif
        if !options.isEmpty { url.queryItems = options }
        return url.url!
    }

    static func contains(_ url: URL) -> Bool {
        url.scheme == scheme && url.host == host && url.user == nil && url.password == nil && url.port == nil
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, Self.contains(url),
              task.request.httpMethod == "GET", let resources = Bundle.main.resourceURL else {
            task.didFailWithError(URLError(.unsupportedURL))
            return
        }
        let path = url.path(percentEncoded: false)
        let root = resources.appendingPathComponent("Web", isDirectory: true).standardizedFileURL
        let file = root.appendingPathComponent(path == "/" ? "index.html" : path).standardizedFileURL
        let fileExtension = file.pathExtension.lowercased()
        let mimeType = fileExtension == "woff2" ? "font/woff2" : UTType(filenameExtension: fileExtension)?.preferredMIMEType
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file),
              let type = mimeType else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let response = URLResponse(url: url, mimeType: type, expectedContentLength: data.count,
                                   textEncodingName: type.hasPrefix("text/") ? "utf-8" : nil)
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    // Bundled resources are small and delivered synchronously on the WebKit callback.
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
