import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let titleLabel = UILabel()
    private let detailLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let closeButton = UIButton(type: .system)
    private var work: Task<Void, Never>?
    private var loading: Progress?
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        let cream = UIColor(red: 255/255, green: 241/255, blue: 207/255, alpha: 1)
        let ink = UIColor(red: 40/255, green: 27/255, blue: 38/255, alpha: 1)
        let red = UIColor(red: 167/255, green: 46/255, blue: 53/255, alpha: 1)
        let navy = UIColor(red: 23/255, green: 59/255, blue: 115/255, alpha: 1)
        view.backgroundColor = cream
        preferredContentSize = CGSize(width: 420, height: 240)

        titleLabel.font = .preferredFont(forTextStyle: .title3)
        titleLabel.textColor = red
        titleLabel.text = "CoolCart"
        detailLabel.font = .preferredFont(forTextStyle: .body)
        detailLabel.textColor = ink
        for label in [titleLabel, detailLabel] {
            label.numberOfLines = 0
            label.adjustsFontForContentSizeCategory = true
        }
        titleLabel.accessibilityTraits.insert(.header)
        var buttonStyle = UIButton.Configuration.filled()
        buttonStyle.cornerStyle = .fixed
        buttonStyle.background.cornerRadius = 0
        buttonStyle.background.strokeColor = ink
        buttonStyle.background.strokeWidth = 2
        buttonStyle.baseBackgroundColor = navy
        buttonStyle.baseForegroundColor = .white
        closeButton.configuration = buttonStyle
        closeButton.setTitle("取消", for: .normal)
        closeButton.addTarget(self, action: #selector(close), for: .touchUpInside)
        spinner.hidesWhenStopped = true
        spinner.color = navy

        let content = UIStackView(arrangedSubviews: [titleLabel, detailLabel, spinner, closeButton])
        content.axis = .vertical
        content.spacing = 14
        content.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(content)
        let safeArea = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: safeArea.leadingAnchor, constant: 22),
            content.trailingAnchor.constraint(equalTo: safeArea.trailingAnchor, constant: -22),
            content.topAnchor.constraint(equalTo: safeArea.topAnchor, constant: 22),
            content.bottomAnchor.constraint(lessThanOrEqualTo: safeArea.bottomAnchor, constant: -18)
        ])
        detailLabel.text = "正在读取已分享的购物车截屏…"
        spinner.startAnimating()
        work = Task { await recognizeAttachments() }
    }

    private func recognizeAttachments() async {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        let images = providers.compactMap { provider -> (NSItemProvider, String)? in
            guard let type = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .image) == true })
            else { return nil }
            return (provider, type)
        }
        guard !images.isEmpty, images.count <= 10 else {
            presentResult(title: "请选择商品截屏", detail: "一次可以分享 1 至 10 张图片。", success: false)
            return
        }

        var recognized: [CartScreenProduct] = []
        var missed = 0
        var unreadable = 0
        for (index, image) in images.enumerated() {
            if Task.isCancelled { return }
            detailLabel.text = "正在识别第 \(index + 1) 张，共 \(images.count) 张。"
            do {
                let products = try await readProducts(image.0, type: image.1)
                recognized.append(contentsOf: products)
                if products.isEmpty { missed += 1 }
            } catch { unreadable += 1 }
        }
        guard !Task.isCancelled else { return }
        let batch = CartShareBatch(recognized: recognized)
        guard !batch.products.isEmpty else {
            if unreadable == images.count {
                presentResult(title: "无法读取共享图像", detail: "请在相册打开原图后重新分享，也可以从 App 内选择截屏。", success: false)
            } else {
                let skipped = unreadable == 0 ? "" : " 另有 \(unreadable) 张图片无法读取。"
                presentResult(title: "未识别到商品",
                              detail: "请保留完整购物车商品行，或单品详情的商品名和购买按钮。\(skipped)", success: false)
            }
            return
        }
        do {
            try CartShareInbox.submit(batch)
            let skipped = (missed == 0 ? "" : " \(missed) 张未识别到购物车商品。")
                + (unreadable == 0 ? "" : " \(unreadable) 张图片无法读取。")
            presentResult(title: "已识别 \(batch.products.count) 件商品",
                          detail: "打开 CoolCart 时会自动导入。\(skipped)", success: true)
        } catch {
            presentResult(title: "暂未交给购物车", detail: "请保持 iPhone 解锁并重新分享这批截屏。", success: false)
        }
    }

    private func readProducts(_ provider: NSItemProvider, type: String) async throws -> [CartScreenProduct] {
        do {
            return try await withCheckedThrowingContinuation { continuation in
                loading = provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
                    let result = autoreleasepool {
                        Result {
                            guard let url else { throw error ?? CocoaError(.fileReadUnknown) }
                            return try CartTextRecognition.screenshot(at: url)
                        }
                    }
                    continuation.resume(with: result)
                }
            }
        } catch {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                loading = provider.loadDataRepresentation(forTypeIdentifier: type) { data, error in
                    let result = autoreleasepool {
                        Result {
                            guard let data, data.count <= 20 * 1024 * 1024 else { throw error ?? CocoaError(.fileReadUnknown) }
                            return try CartTextRecognition.screenshot(data: data)
                        }
                    }
                    continuation.resume(with: result)
                }
            }
        }
    }

    private func presentResult(title: String, detail: String, success: Bool) {
        finished = true
        loading = nil
        let showResult = {
            self.spinner.stopAnimating()
            self.titleLabel.text = title
            self.detailLabel.text = detail
            self.closeButton.setTitle(success ? "完成" : "关闭", for: .normal)
        }
        if UIAccessibility.isReduceMotionEnabled || view.window == nil {
            showResult()
        } else {
            UIView.transition(with: view, duration: 0.19, options: [.transitionCrossDissolve, .allowUserInteraction],
                              animations: showResult)
        }
        UIAccessibility.post(notification: .screenChanged, argument: titleLabel)
    }

    @objc private func close() {
        if finished {
            extensionContext?.completeRequest(returningItems: nil)
        } else {
            work?.cancel()
            loading?.cancel()
            extensionContext?.cancelRequest(withError: CocoaError(.userCancelled))
        }
    }
}
