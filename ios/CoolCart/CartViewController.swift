import UIKit
import WebKit

final class CartViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    static let backgroundColor = UIColor(red: 255/255, green: 245/255, blue: 227/255, alpha: 1)
    private let content = BundledWebContent()

    override func loadView() {
        let demo = ProcessInfo.processInfo.arguments.contains("--demo")
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.setURLSchemeHandler(content, forURLScheme: BundledWebContent.scheme)
        ProductImportBridge.install(in: configuration.userContentController)
        let retail = RetailLinkBridge()
        configuration.userContentController.addScriptMessageHandler(retail, contentWorld: .page, name: "openRetailLink")
        configuration.userContentController.addScriptMessageHandler(retail, contentWorld: .page, name: "copyRetailQuery")
        configuration.userContentController.addScriptMessageHandler(
            CartScreenshotBridge(presenter: self), contentWorld: .page, name: "cartScreenshot"
        )
        configuration.userContentController.addScriptMessageHandler(
            CartShareBridge(), contentWorld: .page, name: "cartShareInbox"
        )
        if !demo {
            configuration.userContentController.addScriptMessageHandler(
                CartReminderBridge(), contentWorld: .page, name: "cartReminders"
            )
            NotificationCenter.default.addObserver(self, selector: #selector(refreshReminders),
                                                   name: .coolCartReminderOpened, object: nil)
        }
        #if canImport(ScreenCaptureKit)
        if #available(iOS 27.0, *) {
            configuration.userContentController.addScriptMessageHandler(
                ScreenShoppingCapture(demo: demo), contentWorld: .page, name: "screenShopping"
            )
        }
        #endif
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.backgroundColor = Self.backgroundColor
        webView.underPageBackgroundColor = Self.backgroundColor
        webView.navigationDelegate = self
        webView.uiDelegate = self
        #if DEBUG
        webView.isInspectable = true
        #endif
        view = webView
        NotificationCenter.default.addObserver(self, selector: #selector(appBecameActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)

        webView.load(URLRequest(url: BundledWebContent.home(demo: demo)))
    }

    @objc private func appBecameActive() {
        (viewIfLoaded as? WKWebView)?.evaluateJavaScript("window.dispatchEvent(new Event('coolcart:share-inbox'))")
        refreshReminders()
    }

    @objc private func refreshReminders() {
        (viewIfLoaded as? WKWebView)?.evaluateJavaScript("window.dispatchEvent(new Event('coolcart:reminders'))")
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else {
            decisionHandler(.cancel)
            return
        }
        if BundledWebContent.contains(url) {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        if action.navigationType == .linkActivated, ["http", "https"].contains(url.scheme?.lowercased()) {
            UIApplication.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard let url = frame.request.url, BundledWebContent.contains(url),
              presentedViewController == nil else {
            completionHandler(false)
            return
        }
        let prompt = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        prompt.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        prompt.addAction(UIAlertAction(title: "确定", style: .destructive) { _ in completionHandler(true) })
        present(prompt, animated: true)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}
