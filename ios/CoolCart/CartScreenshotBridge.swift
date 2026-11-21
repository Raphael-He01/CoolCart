import PhotosUI
import UniformTypeIdentifiers
import WebKit

final class CartScreenshotBridge: NSObject, WKScriptMessageHandlerWithReply, PHPickerViewControllerDelegate,
                                  UIAdaptivePresentationControllerDelegate {
    private enum Intent: String {
        case cart = "pick"
        case product = "pickProduct"
    }

    private enum Picture {
        case file(URL)
        case data(Data)

        func result(for intent: Intent, onImageReady: @escaping (CGImage) -> Void) throws -> [String: Any] {
            if case .file(let url) = self,
               let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > ProductScreenshot.maxBytes {
                throw CocoaError(.fileReadTooLarge)
            }

            if intent == .product {
                let data: Data
                switch self {
                case .file(let url): data = try Data(contentsOf: url, options: .mappedIfSafe)
                case .data(let bytes): data = bytes
                }
                return ["status": "selected", "image": try ProductScreenshot.dataURL(from: data)]
            }

            let products: [CartScreenProduct]
            switch self {
            case .file(let url):
                products = try CartTextRecognition.screenshot(at: url, onImageReady: onImageReady)
            case .data(let bytes):
                guard bytes.count <= ProductScreenshot.maxBytes else { throw CocoaError(.fileReadTooLarge) }
                products = try CartTextRecognition.screenshot(data: bytes, onImageReady: onImageReady)
            }
            return ["status": "recognized", "items": products.map { $0.bridgeRow(id: UUID().uuidString) }]
        }
    }

    private weak var presenter: UIViewController?
    private weak var picker: PHPickerViewController?
    private var reply: ((Any?, String?) -> Void)?
    private var operation: UUID?
    private var requestID: String?
    private var loading: Progress?
    private var deadline: DispatchWorkItem?
    private var intent: Intent = .cart

    init(presenter: UIViewController) {
        self.presenter = presenter
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, BundledWebContent.contains(url),
              let input = message.body as? [String: String], let action = input["action"], let intent = Intent(rawValue: action),
              input.count == 1 || (intent == .cart && input.count == 2 && (1...80).contains(input["requestId"]?.count ?? 0)) else {
            replyHandler(nil, "请从 CoolCart 的截图入口选择图片。")
            return
        }
        guard reply == nil, let presenter, presenter.viewIfLoaded?.window != nil,
              presenter.presentedViewController == nil else {
            replyHandler(nil, "请先结束当前选图或识别，再重试。")
            return
        }
        var configuration = PHPickerConfiguration()
        configuration.filter = .images
        configuration.selectionLimit = 1
        configuration.preferredAssetRepresentationMode = intent == .product ? .compatible : .current
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        picker.presentationController?.delegate = self
        self.picker = picker
        self.intent = intent
        requestID = input["requestId"]
        reply = replyHandler
        presenter.present(picker, animated: true)
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        if presentationController.presentedViewController === picker {
            finish(["status": "cancelled"])
        }
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        guard picker === self.picker else { return }
        self.picker = nil
        picker.dismiss(animated: true)
        guard let provider = results.first?.itemProvider else {
            finish(["status": "cancelled"])
            return
        }
        guard let type = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .image) == true }) else {
            finish(nil, "这张图片无法打开，请选择系统截屏重试。")
            return
        }

        let id = UUID()
        let intent = self.intent
        operation = id
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, self.operation == id else { return }
            self.loading?.cancel()
            self.finish(nil, "这张图片读取或识别超时。请确认原图已下载，或换一张清晰的截屏。")
        }
        deadline = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 45, execute: timeout)
        loading = provider.loadFileRepresentation(forTypeIdentifier: type) { [weak self] url, _ in
            // The Photos picker owns this file; its URL expires as soon as this callback returns.
            self?.process(url.map(Picture.file), intent: intent, operation: id) { [weak self] in
                guard let self else { return }
                self.loading = provider.loadDataRepresentation(forTypeIdentifier: type) { [weak self] data, _ in
                    self?.process(data.map(Picture.data), intent: intent, operation: id)
                }
            }
        }
    }

    private func process(_ picture: Picture?, intent: Intent, operation id: UUID,
                         onReadFailure: (() -> Void)? = nil) {
        let started = ProcessInfo.processInfo.systemUptime
        let result = autoreleasepool {
            Result {
                guard let picture else { throw CocoaError(.fileReadNoSuchFile) }
                return try picture.result(for: intent) { [weak self] image in
                    let bounds = CGRect(x: 0, y: 0, width: 1, height: 1)
                    let jpeg = CartScreenshotCrop.jpeg(from: image, bounds: bounds, byteLimit: 64 * 1024)
                    let preview = jpeg.map { "data:image/jpeg;base64," + $0.base64EncodedString() } ?? ""
                    DispatchQueue.main.async {
                        guard let self, self.operation == id, let requestID = self.requestID,
                              let webView = self.presenter?.viewIfLoaded as? WKWebView,
                              let url = webView.url, BundledWebContent.contains(url) else { return }
                        webView.callAsyncJavaScript(
                            "window.dispatchEvent(new CustomEvent('coolcart:cart-screenshot-ready', {detail: {requestId, preview}}))",
                            arguments: ["requestId": requestID, "preview": preview], in: nil, in: .page
                        )
                    }
                }
            }
        }
        let duration = Int((ProcessInfo.processInfo.systemUptime - started) * 1000)
        DispatchQueue.main.async { [weak self] in
            guard let self, self.operation == id else { return }
            switch result {
            case .success(var response):
                response["durationMs"] = duration
                self.finish(response)
            case .failure(let error as CocoaError) where error.code == .fileReadTooLarge:
                self.finish(nil, "这张图片超过 20 MB，请裁剪后重试。")
            case .failure:
                if let onReadFailure {
                    onReadFailure()
                } else {
                    self.finish(nil, "无法读取这张图片。请确认原图已下载，或重新选一张清晰截屏。")
                }
            }
        }
    }

    private func finish(_ result: Any?, _ error: String? = nil) {
        deadline?.cancel()
        deadline = nil
        loading = nil
        operation = nil
        requestID = nil
        picker = nil
        let callback = reply
        reply = nil
        callback?(result, error)
    }
}
