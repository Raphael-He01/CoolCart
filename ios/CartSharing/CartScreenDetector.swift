import CoreGraphics
import Foundation

struct ScreenTextObservation {
    let text: String
    let bounds: CGRect // Vision coordinates: the origin is at the lower left.
}

struct CartScreenProduct: Equatable, Codable {
    let name: String
    let variant: String
    let platform: String
    let priceCents: Int?
    var screenshotCrop: Data? = nil

    var productKey: String { [name, variant].map(\.cartKey).joined(separator: "\u{1f}") }
    fileprivate var rowKey: String { platform.cartKey + "\u{1f}" + productKey }

    func bridgeRow(id: String) -> [String: Any] {
        var row: [String: Any] = ["id": id, "name": name, "platform": platform, "variant": variant]
        if let cents = priceCents { row["price"] = Double(cents) / 100 }
        if let screenshotCrop { row["screenshotCrop"] = screenshotCrop.base64EncodedString() }
        return row
    }
}

struct CartScreenshotRow {
    let product: CartScreenProduct
    let cropBounds: CGRect?
}

private struct CartLine {
    let text: String
    let bounds: CGRect
    var y: CGFloat { bounds.midY }
    var compact: String { text.filter { !$0.isWhitespace } }

    init?(_ observation: ScreenTextObservation) {
        let trimmed = observation.text.precomposedStringWithCompatibilityMapping
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let rect = observation.bounds
        guard !trimmed.isEmpty, trimmed.count <= 200, !rect.isEmpty, !rect.isNull,
              rect.minX >= -0.001, rect.maxX <= 1.001, rect.minY >= -0.001, rect.maxY <= 1.001 else { return nil }
        text = trimmed
        bounds = rect
    }
}

private extension String {
    func matches(_ pattern: String) -> Bool {
        range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    var cartKey: String {
        precomposedStringWithCompatibilityMapping.lowercased().filter { !$0.isWhitespace }
    }
}

struct CartScreenDetector {
    private var previous: [String: CartScreenProduct] = [:]
    private var reported: [String: CartScreenProduct] = [:]
    private var lastFrame: TimeInterval?
    private var detail: (item: CartScreenProduct, time: TimeInterval)?
    private var toastVisible = false

    /// A user-selected still image already contains a single, complete observation of the page.
    static func rows(inScreenshot observations: [ScreenTextObservation]) -> [CartScreenshotRow] {
        guard let lines = screenedLines(observations) else { return [] }
        let rows = cartRows(in: lines, includeCrop: true) ?? detailRows(in: lines)
        let counts = Dictionary(grouping: rows, by: \.product.rowKey)
        let privateBounds = observations.filter { isPrivacyMarker($0.text) }.map(\.bounds)
        var seen: Set<String> = []
        return rows.compactMap { row in
            let product = row.product
            guard seen.insert(product.rowKey).inserted else { return nil }
            guard counts[product.rowKey]?.count == 1 else {
                // Identical rows may be different listings. Neither crop identifies a unique row.
                let unresolved = CartScreenProduct(name: product.name, variant: product.variant,
                                                   platform: product.platform, priceCents: nil)
                return CartScreenshotRow(product: unresolved, cropBounds: nil)
            }
            if let crop = row.cropBounds, privateBounds.contains(where: { $0.intersects(crop) }) {
                return CartScreenshotRow(product: product, cropBounds: nil)
            }
            return row
        }
    }

    private static func screenedLines(_ observations: [ScreenTextObservation]) -> [CartLine]? {
        guard observations.count <= 300 else { return nil }
        var lines = observations.compactMap(CartLine.init).sorted { $0.y > $1.y }
        let header = lines.first(where: isCartHeader)
        // A cart header can include a delivery destination. Discard that field locally.
        if let header, let delivery = lines.first(where: {
            $0.y >= max(0.77, header.y - 0.10) && $0.compact.matches("^(?:配送至|送至)")
                && !$0.compact.matches("验证码|核对订单|确认订单|提交订单|支付|收件人|收货人|密码|银行卡|订单号")
        }) {
            lines.removeAll { $0.y == delivery.y && $0.bounds == delivery.bounds }
        }
        return lines.contains(where: { isPrivacyMarker($0.compact) }) ? nil : lines
    }

    private static func cartRows(in lines: [CartLine], includeCrop: Bool = false) -> [CartScreenshotRow]? {
        guard let header = lines.first(where: isCartHeader) else { return nil }
        let footer = lines.filter { line in
            line.y < header.y && (isRecommendation(line) || (line.y <= 0.27 && isCartTotal(line)))
        }.max { $0.y < $1.y }
        let body = lines.filter { $0.y < header.y && $0.y > (footer?.y ?? 0) + 0.006 }
        let bottom = footer?.bounds.maxY ?? 0
        let available = includeCrop
            ? CGRect(x: 0, y: bottom, width: 1, height: max(0, header.bounds.minY - bottom))
            : nil
        let storefront = platform(in: lines)
        let rows = products(in: joinWrappedTitles(in: body), platform: storefront, availableCrop: available)
        guard rows.isEmpty,
              storefront == "京东" || (storefront.isEmpty && lines.contains(where: {
                  $0.y >= 0.72 && $0.compact.contains("京东")
              })) else { return rows }
        return jdCartCards(in: body, availableCrop: available)
    }

    /// 京东购物车的长标题常为两行，商品品类和所选规格可以都不出现。
    /// 用同列重复卡片、店铺和价格旁的数量控件交叉确认。
    private static func jdCartCards(in body: [CartLine], availableCrop: CGRect?) -> [CartScreenshotRow] {
        guard body.contains(where: {
            $0.bounds.minX < 0.22 && $0.compact.matches("京东自营|旗舰店|自营店|官方店|专营店|专卖店")
        }) else { return [] }
        let titles = body.filter {
            (0.24...0.56).contains($0.bounds.minX) && $0.bounds.width >= 0.44 && $0.compact.count >= 8
                && productName($0, allowUnlisted: true) != nil
        }
        guard titles.count >= 2, let x = titles.first?.bounds.minX,
              titles.allSatisfy({ abs($0.bounds.minX - x) <= 0.035 }) else { return [] }

        var anchored = 0
        var results: [CartScreenshotRow] = []
        for (index, title) in titles.enumerated() {
            let next = index + 1 < titles.count ? titles[index + 1].bounds.maxY : 0
            let boundary = max(next, title.y - 0.16)
            let band = body.filter { $0.y < title.y - 0.014 && $0.y > boundary }
            let sameColumn = band.filter { abs($0.bounds.minX - title.bounds.minX) < 0.045 }
            let prices: [Int] = sameColumn.compactMap { line in
                guard let cents = price(in: line, neighbors: band), band.contains(where: {
                    $0.bounds.minX >= 0.74 && abs($0.y - line.y) < 0.023
                        && $0.compact.matches(#"^(?:\d{1,3}|[-−+]|[-−]\d{1,3}\+|[×x]\d{1,3})$"#)
                }) else { return nil }
                return cents
            }
            let selected = sameColumn.first { $0.compact.matches("^(?:已选|所选|规格)") }
            guard !prices.isEmpty || selected != nil, let name = productName(title, allowUnlisted: true) else { continue }
            if !prices.isEmpty { anchored += 1 }
            let specs = Set(sameColumn.compactMap(jdCardVariant))
            let product = CartScreenProduct(name: name, variant: specs.count == 1 ? (specs.first ?? "") : "",
                platform: "京东", priceCents: prices.count == 1 && specs.count <= 1 ? prices[0] : nil)
            let bounds = availableCrop.flatMap { cropBounds(title, neighbors: sameColumn, boundary: boundary, within: $0) }
            results.append(CartScreenshotRow(product: product, cropBounds: bounds))
        }
        return anchored >= 2 ? results : []
    }

    private static func jdCardVariant(_ line: CartLine) -> String? {
        if let value = variant(line) { return value }
        let disclosure = CharacterSet(charactersIn: "⌄∨﹀▽˅vV")
        let colors = "[深浅亮暗曜墨星冰雪天海珍珠太空远峰]*[黑白蓝红粉紫绿黄棕银灰金橙]色"
        let size = #"(?:[XSML]{1,4}|[2-5]XL)(?:\(\d{2,3}/\d{2,3}[A-Z]\))?"#
        let capacity = #"\d{1,4}(?:L|升|ml|毫升)"#
        guard line.compact.trimmingCharacters(in: disclosure)
            .matches("^(?:[A-Z]{1,4}[-–])?" + colors + "[,、/|](?:" + size + "|" + capacity + ")$") else { return nil }
        return line.text.trimmingCharacters(in: disclosure).trimmingCharacters(in: .whitespaces)
    }

    private static func detailRows(in lines: [CartLine]) -> [CartScreenshotRow] {
        let toolbar = lines.filter { $0.y < 0.18 }.map(\.compact)
        guard toolbar.contains("加入购物车"), toolbar.contains(where: { $0.matches("^立即购.{0,1}$") }),
              lines.contains(where: { $0.y > 0.78 && ["商品", "详情", "商品详情"].contains($0.compact) }) else { return [] }
        let recommendations = lines.filter(isRecommendation).map(\.y).max() ?? 0
        let body = lines.filter { $0.y > max(0.18, recommendations) && $0.y < 0.76 }
        var titles: [CartLine] = []
        for line in body {
            guard line.bounds.minX < 0.24, line.bounds.width > 0.24, productName(line) != nil,
                  !line.compact.matches("排行榜|热卖榜|第[0-9]+名|参数|图文详情|已选|规格[:：]|送达|联名卡") else { continue }
            if let upper = titles.last, abs(upper.bounds.minX - line.bounds.minX) < 0.026,
               (-0.003...0.014).contains(upper.bounds.minY - line.bounds.maxY),
               let combined = CartLine(.init(text: upper.text + " " + line.text, bounds: upper.bounds.union(line.bounds))) {
                titles[titles.count - 1] = combined
            } else {
                titles.append(line)
            }
        }
        guard titles.count == 1, let title = titles.first, let name = productName(title), name.count >= 8 else { return [] }
        let variants = Set(body.filter { $0.y < title.bounds.minY && title.y - $0.y < 0.18 }.compactMap(variant))
        let identifiedPlatform = platform(in: lines)
        let marketplace = identifiedPlatform.isEmpty && lines.contains(where: {
            $0.compact.matches("京东白条|京东联名卡|京东物流|京东自营")
        }) ? "京东" : identifiedPlatform
        // A detail page may show promotions or a price for another specification.
        // Keep the nearby price visible for review without treating it as a cart unit price.
        let visiblePrice = body.last { line in
            line.y > title.bounds.maxY && line.y - title.y < 0.21 && line.bounds.minX < 0.44
                && price(in: line, neighbors: body) != nil
        }
        let area = visiblePrice.map { title.bounds.union($0.bounds) } ?? title.bounds
        let crop = area.insetBy(dx: -0.01, dy: -0.005).intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        let product = CartScreenProduct(name: name, variant: variants.count == 1 ? (variants.first ?? "") : "",
                                        platform: marketplace, priceCents: nil)
        return [CartScreenshotRow(product: product, cropBounds: crop)]
    }

    mutating func observe(_ observations: [ScreenTextObservation], at time: TimeInterval) -> [CartScreenProduct] {
        guard time.isFinite, let lines = Self.screenedLines(observations) else { self = Self(); return [] }
        if let lastFrame, time < lastFrame || time - lastFrame > 4 { self = Self() }
        if lastFrame == time { return [] }
        let interval = lastFrame.map { time - $0 }
        lastFrame = time

        let toast = lines.contains { $0.compact.matches("^(?:已(?:成功)?加入购物车|加入购物车成功|成功加入购物车|加购成功)$") }
        defer { toastVisible = toast }

        if let rows = Self.cartRows(in: lines) {
            detail = nil
            return stable(rows.map(\.product), contiguous: (interval ?? 0) <= 2.5)
        }

        previous.removeAll()
        reported.removeAll()
        let purchase = lines.contains { $0.compact.matches("^(?:加入购物车|立即购买)$") }
        if purchase {
            let cutoff = lines.filter(Self.isRecommendation).map(\.y).max() ?? 0
            let products = Self.products(in: lines.filter { $0.y > cutoff }, platform: Self.platform(in: lines))
            detail = products.count == 1 ? (products[0].product, time) : nil
        } else if !toast || lines.contains(where: { Self.productName($0) != nil || $0.compact.matches("[¥￥]") }) {
            detail = nil
        }
        guard toast, !toastVisible, let detail, time - detail.time <= 4 else { return [] }
        self.detail = nil
        return [detail.item]
    }

    private mutating func stable(_ products: [CartScreenProduct], contiguous: Bool) -> [CartScreenProduct] {
        if !contiguous { previous.removeAll(); reported.removeAll() }
        let grouped = Dictionary(grouping: products, by: \.rowKey)
        var current: [String: CartScreenProduct] = [:]
        var result: [CartScreenProduct] = []
        for product in products {
            let key = product.rowKey
            // Identical rows may belong to different sellers/SKUs. Do not choose between their prices.
            guard grouped[key]?.count == 1 else { continue }
            current[key] = product
            guard let old = previous[key] else { continue }
            let price = old.priceCents == product.priceCents ? product.priceCents : nil
            let verified = CartScreenProduct(name: product.name, variant: product.variant, platform: product.platform, priceCents: price)
            if let prior = reported[key], prior.priceCents == price || price == nil { continue }
            result.append(verified)
            reported[key] = verified
        }
        previous = current
        reported = reported.filter { current[$0.key] != nil }
        return result
    }

    static func isPrivacyMarker(_ raw: String) -> Bool {
        let text = raw.precomposedStringWithCompatibilityMapping.filter { !$0.isWhitespace }
        return text.matches("验证码|收货地址|收件地址|配送至|^送至|详细地址|收货人|收件人|联系(?:人|电话|方式)|手机号码|支付密码|输入密码|确认订单|提交订单|核对订单|订单(?:结算|详情|明细|支付|号|编号)|确认支付|支付成功|付款码|银行卡号")
            || text.matches(#"(?:1[3-9](?:[- ]?\d){9}|1[3-9]\d?[*•]{3,}\d{2,4}|0\d{2,3}[- ]?\d{7,8}|\d{12,}|[\w.+-]+@[\w.-]+\.[A-Z]{2,}|[路街巷道].{0,8}\d{1,5}[号弄]|(?:省|自治区).{1,10}市.{1,12}(?:区|县))"#)
    }

    private static func isCartHeader(_ line: CartLine) -> Bool {
        line.y >= 0.72 && line.compact.matches(#"^(?:(?:京东|淘宝|天猫|我的)[·•-]?)?购物车(?:[(:·【\[]?\d{1,4}\+?(?:件)?[)】\]]?)?(?:[/|·•›-]?(?:常买|常购|管理|编辑|全部商品)){0,3}$"#)
    }

    private static func platform(in lines: [CartLine]) -> String {
        let badges = lines.filter { $0.y >= 0.72 }.compactMap { line -> String? in
            for brand in ["京东", "淘宝", "天猫"] {
                if line.compact == brand || (isCartHeader(line) && line.compact.hasPrefix(brand)) { return brand }
            }
            return nil
        }
        let unique = Set(badges)
        return unique.count == 1 ? (unique.first ?? "") : ""
    }

    private static func isRecommendation(_ line: CartLine) -> Bool {
        line.compact.matches("^(?:为你推荐|猜你喜欢|你可能还喜欢|看了又看|推荐商品|相似推荐|更多好物|失效(?:宝贝|商品))(?:[·›>].*)?$")
    }

    private static func isCartTotal(_ line: CartLine) -> Bool {
        line.compact.matches(#"^(?:合计|总计|应付|去结算|结算)(?:[:(\d¥￥].*)?$"#)
    }

    private static let categoryWords = "耳机|鼠标|键盘|手机|平板|笔记本|显示器|相机|音箱|充电器|充电宝|数据线|保护壳|路由器|台灯|中性笔|钢笔|铅笔|笔芯|练习本|收纳盒|水杯|保温杯|咖啡|牛奶|饼干|面包|洗发水|护肤|面霜|口红|防晒|运动鞋|跑鞋|衬衫|外套|短袖|连衣裙|双肩包|抽纸|纸巾|洗衣液|牙刷|牙膏|电饭煲|电吹风|电风扇|枕头|床单"

    private static func productName(_ line: CartLine, allowUnlisted: Bool = false) -> String? {
        let text = line.text
        let compact = line.compact
        guard (4...120).contains(text.count), !isCartHeader(line), !isRecommendation(line),
              !compact.matches("旗舰店|专卖店|专营店|官方店|自营店|购物车|加入|立即购买|优惠|领取|领券|合计|已选|所选|收起|配送|运费|预计|猜你喜欢|国家补贴|已售|查看|客服|评价|://|[¥￥]"),
              variant(line) == nil, !compact.matches("^(?:价格|售价|单价|京东价|淘宝价|到手价|推荐|已优惠|数量|小计|共计|适用商品)") else { return nil }
        if let label = text.range(of: #"^(?:商品名称|商品名)\s*[:：]\s*"#, options: .regularExpression) {
            let name = String(text[label.upperBound...])
            return (3...110).contains(name.count) ? name : nil
        }
        // An isolated slogan, store name or arbitrary contact line is not a product title.
        let category = compact.matches(Self.categoryWords)
        let modeled = text.matches(#"(?:[A-Za-z]{1,12}[ -]?\d{1,5}[A-Za-z]?|iPhone\s*\d{1,2}|AirPods|MacBook|iPad)"#)
        if category || modeled { return text }
        guard allowUnlisted, line.bounds.minX >= 0.12, text.count >= 5,
              text.matches(#"[\p{L}]{3}"#), !compact.matches("专区|商城|会员|促销|活动|折扣|热卖|优惠|正品保障|购物|服务|折叠更多|快递|包邮") else { return nil }
        return text
    }

    private static func variant(_ line: CartLine) -> String? {
        let text = line.text
        if let label = text.range(of: #"^(?:已选(?:择)?|所选规格|规格|颜色(?:分类)?|型号|版本|尺码)\s*[:：]\s*"#, options: .regularExpression) {
            let value = String(text[label.upperBound...]).trimmingCharacters(in: .whitespaces)
            return !value.isEmpty && value.count <= 60 ? value : nil
        }
        guard text.count <= 45, !line.compact.matches("[:¥￥]") else { return nil }
        let part = #"(?:[深浅亮暗曜墨星冰雪天海珍珠太空远峰]*[黑白蓝红粉紫绿黄棕银灰金橙]色(?:[黑白灰蓝红]边)?|官方标配|标准版|基础版|标配|[0-9]{1,4}(?:GB|TB|毫升|ml|码)|[XSML]{1,3}码)"#
        return line.compact.matches("^(?:" + part + ")(?:[,、;/|·-]?" + part + ")*$") ? text : nil
    }

    private static func joinWrappedTitles(in lines: [CartLine]) -> [CartLine] {
        var result: [CartLine] = []
        var index = 0
        while index < lines.count {
            let upper = lines[index]
            if index + 1 < lines.count {
                let lower = lines[index + 1]
                let verticalGap = upper.bounds.minY - lower.bounds.maxY
                // A short continuation aligned with a brand/model is common on narrow screens.
                // Never join two complete names or a standalone specification from the next row.
                if abs(upper.bounds.minX - lower.bounds.minX) < 0.024,
                   (0...min(0.012, upper.bounds.height * 0.65)).contains(verticalGap),
                   !upper.compact.matches(categoryWords), upper.text.matches(#"[A-Za-z]+[ -]?\d+[A-Za-z]?$"#),
                   (3...30).contains(lower.text.count), variant(lower) == nil,
                   lower.text.matches("^(?:入耳式|头戴式|无线|有线|便携式|机械|蓝牙|降噪|办公|运动|家用)"),
                   productName(lower) != nil, !lower.text.matches(#"[A-Za-z]+[ -]?\d+"#),
                   let joined = CartLine(.init(text: upper.text + " " + lower.text, bounds: upper.bounds.union(lower.bounds))) {
                    result.append(joined)
                    index += 2
                    continue
                }
            }
            result.append(upper)
            index += 1
        }
        return result
    }

    private static func endsRow(_ line: CartLine) -> Bool {
        let text = line.compact
        if text.matches("旗舰店|专营店|专卖店|官方店|自营店|京东自营") { return true }
        // A new, unrecognized title must not donate its price to the item above.
        guard text.count >= 5, text.matches(#"[\p{L}]{3}"#), variant(line) == nil else { return false }
        return !text.matches("价格|售价|单价|优惠|到手|配送|运费|满减|国补|补贴|数量|退换|包邮|活动|立减|[¥￥]")
    }

    private static let priceArea = "[¥￥]|售价|单价|到手价|券后价"

    private static func products(in lines: [CartLine], platform: String, availableCrop: CGRect? = nil) -> [CartScreenshotRow] {
        let titles = lines.compactMap { line -> (CartLine, String)? in
            if let name = productName(line) { return (line, name) }
            // Unlisted categories are accepted when the screen independently provides a variant
            // and a price/quantity directly beneath the prospective title.
            guard let name = productName(line, allowUnlisted: true) else { return nil }
            let details = lines.filter {
                $0.y < line.y - 0.009 && $0.y > line.y - 0.16 && $0.bounds.minX >= line.bounds.minX - 0.06
            }.prefix(while: { !endsRow($0) })
            guard details.contains(where: { variant($0) != nil }),
                  details.contains(where: { $0.compact.matches("[¥￥]|^(?:数量|[×x][-0-9])") }) else { return nil }
            return (line, name)
        }
        return titles.enumerated().compactMap { index, entry in
            let (title, name) = entry
            // The recognizer targets single-column cart rows. Side-by-side recommendations cannot share a price.
            if titles.filter({ abs($0.0.y - title.y) < 0.024 }).count > 1 { return nil }
            let nextTitle = index + 1 < titles.count ? titles[index + 1].0 : nil
            let lowerBound = max(nextTitle.map { $0.bounds.maxY + 0.004 } ?? 0, title.y - 0.17)
            let inBand = lines.filter { line in
                line.y < title.y - 0.006 && line.y > lowerBound
                    && line.bounds.maxX >= title.bounds.minX - 0.04 && line.bounds.minX >= title.bounds.minX - 0.12
            }
            let boundary = inBand.first(where: endsRow)?.bounds.maxY ?? lowerBound
            let neighbors = inBand.filter { $0.y > boundary }
            let variants = Set(neighbors.compactMap(variant))
            let prices = variants.count > 1 ? [] : neighbors.compactMap { price(in: $0, neighbors: inBand) }
            let hasPriceArea = neighbors.contains { $0.compact.matches(priceArea) }
            let quantity = neighbors.contains { $0.compact.matches(#"^(?:[x×]\d{1,3}|数量[:]?\d{1,3}|[-−]\d{1,3}\+)$"#) }
            guard !variants.isEmpty || hasPriceArea || quantity else { return nil }
            let product = CartScreenProduct(name: name, variant: variants.count == 1 ? (variants.first ?? "") : "",
                                            platform: platform, priceCents: prices.count == 1 ? prices[0] : nil)
            let bounds = availableCrop.flatMap { cropBounds(title, neighbors: neighbors, boundary: boundary, within: $0) }
            return CartScreenshotRow(product: product, cropBounds: bounds)
        }
    }

    private static func cropBounds(_ title: CartLine, neighbors: [CartLine], boundary: CGFloat, within available: CGRect) -> CGRect? {
        let priceLines = neighbors.filter { $0.compact.matches(priceArea) }
        let evidence = neighbors.filter { line in
            if variant(line) != nil || line.compact.matches(priceArea) { return true }
            // Include a split amount and price qualifier on the same visual line.
            return line.compact.matches(#"^[.\d,]+$|券后|补贴|到手|会员|预估|原价|起$"#) && priceLines.contains {
                abs($0.y - line.y) < 0.014 && $0.bounds.insetBy(dx: -0.12, dy: 0).intersects(line.bounds)
            }
        }.reduce(title.bounds) { $0.union($1.bounds) }
        let lower = max(available.minY, boundary)
        guard available.maxY > lower else { return nil }
        let band = CGRect(x: 0, y: lower, width: 1, height: available.maxY - lower)
        // Reject cut-off evidence instead of expanding into the next product or the footer.
        guard band.contains(evidence) else { return nil }
        return evidence.insetBy(dx: -0.009, dy: -0.003).intersection(band)
    }

    private static func price(in line: CartLine, neighbors: [CartLine]) -> Int? {
        var value = line.compact
        let amount = #"(?:\d{1,3}(?:,\d{3}){1,2}|\d{1,7})(?:\.\d{1,2})?"#
        if value.matches("^" + amount + "$") {
            guard neighbors.contains(where: {
                ["¥", "￥"].contains($0.compact) && abs($0.y - line.y) < 0.012
                    && line.bounds.minX - $0.bounds.maxX >= -0.004 && line.bounds.minX - $0.bounds.maxX <= 0.022
            }) else { return nil }
            value = "¥" + value
        }
        let prefix = "^(?:(?:普通单价|当前单价|单价|售价|京东价|淘宝价|天猫价):?)?"
        guard value.matches(prefix + "(?:[¥￥]" + amount + "元?|" + amount + "元)$") else { return nil }
        // A visually adjacent qualifier can be a separate OCR observation.
        let qualified = neighbors.contains {
            abs($0.y - line.y) <= max(0.023, line.bounds.height)
                && $0.bounds.minX < line.bounds.maxX + 0.085 && $0.bounds.maxX > line.bounds.minX - 0.16
                && $0.compact.matches("券后|到手|优惠|立减|满减|国补|补贴|已省|再省|预估|预计|原价|划线|会员|新人|秒杀|活动价|折后|起售|起价|起$|低至|实付|合计|总计|小计|定金|尾款|日元|日圆|円|JPY|USD|HKD|港币|美元|[~～至]|^[-–—]$")
        }
        guard !qualified else { return nil }
        let digits = value.filter { ($0.isASCII && $0.isNumber) || $0 == "." }.split(separator: ".", omittingEmptySubsequences: false)
        guard let first = digits.first, let units = Int(first), units <= 9_999_999 else { return nil }
        let fraction = digits.count == 2 ? Int(digits[1].padding(toLength: 2, withPad: "0", startingAt: 0)) ?? 0 : 0
        let cents = units * 100 + fraction
        return cents > 0 ? cents : nil
    }
}
