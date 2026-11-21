import Foundation

func line(_ text: String, _ y: CGFloat, x: CGFloat = 0.30, width: CGFloat = 0.48) -> ScreenTextObservation {
    ScreenTextObservation(text: text, bounds: CGRect(x: x, y: y - 0.009, width: width, height: 0.018))
}

let header = line("京东购物车（2）", 0.93)
let top = [line("罗技 M185 无线鼠标", 0.78), line("已选：黑色灰边", 0.73), line("¥45.00", 0.68)]
let bottom = [line("水月雨 Blessing 3 入耳式耳机", 0.53), line("官方标配", 0.49), line("单价：￥2000.80", 0.44)]
let summary = [line("合计：￥2045.80", 0.09), line("去结算", 0.07)]
let two = [header] + top + bottom + summary

func confirmed(_ lines: [ScreenTextObservation]) -> [CartScreenProduct] {
    var detector = CartScreenDetector()
    precondition(detector.observe(lines, at: 1).isEmpty)
    return detector.observe(lines, at: 1.35)
}

let items = confirmed(two.reversed())
precondition(items.map(\.name) == ["罗技 M185 无线鼠标", "水月雨 Blessing 3 入耳式耳机"])
precondition(items.map(\.variant) == ["黑色灰边", "官方标配"])
precondition(items.map(\.priceCents) == [4500, 200080] && items.allSatisfy { $0.platform == "京东" })
let tb = confirmed([line("淘宝", 0.96), line("购物车 (2)", 0.90)] + top + bottom)
precondition(tb.count == 2 && tb.allSatisfy { $0.platform == "淘宝" })
precondition(confirmed([line("购物车", 0.9)] + top).first?.platform == "")
precondition(confirmed([line("天猫购物车", 0.9)] + top).first?.platform == "天猫")

let mouse = [header, top[0], top[1]]
for label in ["合计 ¥22", "预计到手￥22", "已省 ¥22", "实付 ¥22", "¥22–¥66", "¥22起", "日元 ¥22", "$22", "优惠额", "JPY 22"] {
    let result = confirmed(mouse + [line(label, 0.68)] + bottom)
    precondition(result.count == 2 && result[0].priceCents == nil && result[1].priceCents == 200080, label)
}
for qualifier in ["券后", "国家补贴", "折后", "小计", "优惠额", "JPY", "起"] {
    let qualified = mouse + [line(qualifier, 0.68, x: 0.28, width: 0.07), line("¥45", 0.68, x: 0.36, width: 0.1)]
    precondition(confirmed(qualified).first?.priceCents == nil, qualifier)
}
let split = mouse + [line("￥", 0.682, width: 0.023), line("45.09", 0.68, x: 0.33, width: 0.1)]
precondition(confirmed(split).first?.priceCents == 4509)
precondition(confirmed(mouse + [line("¥45", 0.68), line("¥44", 0.65)]).first?.priceCents == nil)
precondition(confirmed(mouse + [line("¥120", 0.55)]).first?.priceCents == nil)
precondition(confirmed(mouse + [line("¥500", 0.68, x: 0.02, width: 0.08)]).first?.priceCents == nil)
precondition(confirmed(mouse + [line("厨房折叠伸缩杆", 0.70), line("¥120", 0.65)]).first?.priceCents == nil)
let unlisted = confirmed([header, line("古法手工琉璃镇纸", 0.76), line("规格：山水纹", 0.71), line("¥109", 0.65)])
precondition(unlisted.first?.name == "古法手工琉璃镇纸" && unlisted.first?.priceCents == 10900)
precondition(confirmed(mouse + bottom).map(\.priceCents) == [nil, 200080])

for privateText in ["张女士 138-1234-5678", "邮箱 user@example.test", "收货地址", "地址 测试路123号", "核对订单", "已选：备注 139****1234"] {
    precondition(confirmed(two + [line(privateText, 0.4)]).isEmpty, privateText)
}
precondition(confirmed(two + [line("配送至 测试路123号", 0.89)]) == items)
precondition(confirmed(two + [line("配送至 测试路123号", 0.41)]).isEmpty)
precondition(confirmed(two + [line("配送至 测试路123号", 0.89), line("收货人", 0.86)]).isEmpty)
precondition(confirmed([header] + top + [line("猜你喜欢", 0.60)] + bottom).count == 1)
precondition(confirmed([line("首页", 0.92)] + top + bottom).isEmpty)
let paired = [header, line("罗技 M185 无线鼠标", 0.76, x: 0.04, width: 0.38),
              line("罗技 M190 无线鼠标", 0.76, x: 0.55, width: 0.35), line("¥99", 0.70)]
precondition(confirmed(paired).isEmpty)

var detector = CartScreenDetector()
precondition(detector.observe(two, at: 1).isEmpty)
precondition(detector.observe(two, at: 1).isEmpty)
precondition(detector.observe(two, at: 1.4).count == 2)
precondition(detector.observe(two, at: 1.7).isEmpty)
precondition(detector.observe([], at: 2).isEmpty)
precondition(detector.observe(two, at: 3).isEmpty)
precondition(detector.observe(two, at: 3.4).count == 2) // session queue merges revisits
detector = CartScreenDetector()
precondition(detector.observe(mouse, at: 1).isEmpty)
precondition(detector.observe([header] + top, at: 1.4).first?.priceCents == nil)
precondition(detector.observe([header] + top, at: 1.8).first?.priceCents == 4500)
precondition(detector.observe(two, at: 9).isEmpty)

let detail = [line("立即购买", 0.08)] + top
let success = [line("已加入购物车", 0.5)]
detector = CartScreenDetector()
precondition(detector.observe(detail, at: 1).isEmpty)
precondition(detector.observe(success, at: 1.4).first?.name == "罗技 M185 无线鼠标")
precondition(detector.observe(success, at: 1.8).isEmpty)
for interruption in [[line("取消", 0.6)], [line("收货地址", 0.6)], [line("聊天列表", 0.6)]] {
    detector = CartScreenDetector()
    precondition(detector.observe(detail, at: 1).isEmpty)
    precondition(detector.observe(interruption, at: 1.5).isEmpty)
    precondition(detector.observe(success, at: 2).isEmpty)
}
print("购车多行、价格归属、隐私页、连续帧与加购确认通过")

let screenshotRows = CartScreenDetector.rows(inScreenshot:)
let screenshot = { screenshotRows($0).map(\.product) }
precondition(screenshot(two) == items)

// Geometry reproduced from a JD phone screenshot. Titles use public test text.
let alignedJdCards = [
    line("购物车（4）", 0.921, x: 0.40, width: 0.20),
    line("京东秒送", 0.875, x: 0.64, width: 0.16),
    line("工艺旗舰店", 0.792, x: 0.097, width: 0.41),
    line("古法手工琉璃镇纸山水图案书房摆件", 0.762, x: 0.343, width: 0.586),
    line("BU-蓝色，XL （180/100A）⌄", 0.732, x: 0.343, width: 0.379),
    line("¥109.00", 0.672, x: 0.343, width: 0.126),
    line("1", 0.671, x: 0.839, width: 0.015),
    line("+", 0.671, x: 0.905, width: 0.034),
    line("厨房折叠伸缩杆免打孔实木墙面挂杆", 0.626, x: 0.343, width: 0.583),
    line("DB-深蓝色，25升", 0.595, x: 0.343, width: 0.280),
    line("¥89", 0.537, x: 0.343, width: 0.107),
    line("+", 0.535, x: 0.905, width: 0.031),
    line("木质拓印印章篆刻材料天然原木组合", 0.491, x: 0.343, width: 0.589),
    line("所选规格：混合纹样", 0.422, x: 0.343, width: 0.309),
    line("手工石膏装饰压纹花卉书房造型摆件", 0.243, x: 0.343, width: 0.589),
    line("合计 ¥198.00", 0.118, x: 0.501, width: 0.205),
]
let jdPending = screenshot(alignedJdCards)
precondition(jdPending.count == 3 && jdPending.allSatisfy { $0.platform == "京东" })
precondition(jdPending.map(\.priceCents) == [10900, 8900, nil])
precondition(jdPending[0].variant == "BU-蓝色,XL (180/100A)" && jdPending[1].variant == "DB-深蓝色,25升")
precondition(jdPending.last?.variant == "混合纹样")
precondition(confirmed(alignedJdCards) == jdPending)
precondition(screenshot(alignedJdCards.filter { $0.bounds.minX < 0.74 }).isEmpty)
precondition(screenshot(alignedJdCards.filter { !$0.text.contains("旗舰店") }).isEmpty)
precondition(screenshot(alignedJdCards + [line("确认订单", 0.40)]).isEmpty)
print("静态京东长标题识别、缺证据排除和待核对金额通过")

for nav in ["购物车(99+)", "购物车 常买 管理", "购物车(2件)/常买/编辑", "京东购物车【2】"] {
    precondition(screenshot([line(nav, 0.91)] + top + bottom).count == 2, nav)
}
for nav in ["订单结算", "购物车结算", "常买/管理", "加入购物车"] {
    precondition(screenshot([line(nav, 0.93)] + top + bottom).isEmpty, nav)
}
precondition(screenshot([line("推荐", 0.93), line("购物车", 0.06)] + top + bottom).isEmpty)
precondition(screenshot(two + [line("确认支付", 0.35)]).isEmpty)
precondition(CartScreenDetector.isPrivacyMarker("收 货 地 址"))
precondition(!CartScreenDetector.isPrivacyMarker("罗技 M185 无线鼠标"))
let duplicate = [header] + top + [line("罗技M185 无线鼠标", 0.53), line("规格：黑色灰边", 0.49), line("¥79.00", 0.44)]
precondition(screenshot(duplicate).count == 1 && screenshot(duplicate)[0].priceCents == nil)
precondition(screenshot(mouse + [line("规格：白色", 0.71), line("¥45", 0.67)]).first ==
             CartScreenProduct(name: top[0].text, variant: "", platform: "京东", priceCents: nil))
precondition(screenshot(mouse).first?.name == top[0].text && screenshot(mouse).first?.priceCents == nil)
let wrapped = [header, line("水月雨 Blessing3", 0.75), line("入耳式有线耳机", 0.724),
               line("规格：银色", 0.67), line("京东价 ￥1,999.63", 0.64)]
precondition(screenshot(wrapped) == [.init(name: "水月雨 Blessing3 入耳式有线耳机", variant: "银色", platform: "京东", priceCents: 199963)])
let separateTitles = [header, line("罗技无线鼠标 M185", 0.75), line("无线机械键盘", 0.724),
                      line("规格：黑色", 0.67), line("￥125", 0.64)]
precondition(screenshot(separateTitles).first?.name == "无线机械键盘")
precondition(screenshot(mouse + [line("¥1,99.00", 0.68)]).first?.priceCents == nil)
print("单张购物车截图、混排页头、歧义价格与重复商品通过")

let detailTitle = line("水月雨 Blessing3 入耳式有线耳机", 0.37, x: 0.04, width: 0.89)
let detailContinuation = line("混合式监听 HiFi 耳机 Blessing3", 0.344, x: 0.04, width: 0.80)
let detailAmount = line("¥1999.63", 0.51, x: 0.03, width: 0.24)
let detailScreenshot = [line("商品", 0.91), detailAmount, line("京东联名卡", 0.40), detailTitle, detailContinuation,
                        line("规格：银色", 0.25), line("四已选：Blessing3.1件", 0.22, x: 0.04, width: 0.4),
                        line("加入购物车", 0.07), line("立即购买", 0.08)]
let details = screenshotRows(detailScreenshot)
precondition(details.count == 1 && details.first?.product.name == detailTitle.text + " " + detailContinuation.text)
precondition(details.first?.product.variant == "银色" && details.first?.product.platform == "京东")
precondition(details.first?.product.priceCents == nil && details.first?.cropBounds?.contains(detailAmount.bounds) == true)
precondition(screenshotRows(detailScreenshot + [line("确认订单", 0.24)]).isEmpty)
precondition(screenshotRows(detailScreenshot + [line("另一款有线耳机 A52", 0.60, x: 0.05, width: 0.7)]).isEmpty)
precondition(screenshotRows(detailScreenshot.filter { $0.text != "立即购买" }).isEmpty)
precondition(screenshotRows(detailScreenshot.filter { $0.text != "立即购买" } + [line("立即购安", 0.08)]).count == 1)
print("单品详情只进待核对，隐私页面和多候选详情保持排除")

let crops = screenshotRows(two).compactMap(\.cropBounds)
precondition(crops.count == 2)
precondition(crops[0].contains(top[0].bounds) && crops[0].contains(top[1].bounds) && crops[0].contains(top[2].bounds))
precondition(crops[1].contains(bottom[0].bounds) && crops[1].contains(bottom[2].bounds))
precondition(crops.allSatisfy { !$0.intersects(header.bounds) && !$0.intersects(summary[0].bounds) })
precondition(!crops[0].intersects(crops[1]) && crops[0].minX > 0.25 && crops[0].maxX < 0.85)
let coupon = line("券后", 0.68, x: 0.24, width: 0.065)
let disputed = screenshotRows(mouse + [coupon, line("¥45", 0.68, x: 0.32, width: 0.1)])
precondition(disputed.first?.product.priceCents == nil && disputed.first?.cropBounds?.contains(coupon.bounds) == true)
precondition(screenshotRows(split).first?.cropBounds?.contains(split.last!.bounds) == true)
precondition(screenshotRows(duplicate).first?.cropBounds == nil)
let delivery = line("配送至 测试路123号", 0.859)
let tooClose = screenshotRows([header, delivery, line(top[0].text, 0.84), top[1], top[2]])
precondition(tooClose.count == 1 && tooClose[0].cropBounds == nil)
precondition(screenshotRows(two + [line("收件人", 0.57)]).isEmpty)
print("裁剪范围覆盖本行标题、规格和金额，排除配送信息、重复行和相邻商品")

let sharedMouse = items[0]
let sharedHeadphones = items[1]
let unknownMouse = CartScreenProduct(name: "罗技Ｍ１８５无线鼠标", variant: "黑色灰边", platform: "", priceCents: nil)
let taobaoMouse = CartScreenProduct(name: sharedMouse.name, variant: sharedMouse.variant, platform: "淘宝", priceCents: 4900)
let repricedMouse = CartScreenProduct(name: sharedMouse.name, variant: sharedMouse.variant, platform: "京东", priceCents: 4600)
let combined = CartShareBatch.mergeOverlappingProducts([unknownMouse, sharedHeadphones, sharedMouse, sharedMouse])
precondition(combined.map(\.platform) == ["京东", "京东"] && combined.map(\.priceCents) == [4500, 200080])
precondition(CartShareBatch.mergeOverlappingProducts([sharedMouse, taobaoMouse, unknownMouse]).count == 3)
precondition(CartShareBatch.mergeOverlappingProducts([sharedMouse, repricedMouse, sharedMouse]).map(\.priceCents) == [nil])
var imaged = sharedMouse
imaged.screenshotCrop = Data([1, 2, 3])
precondition(CartShareBatch.mergeOverlappingProducts([unknownMouse, imaged]).first?.screenshotCrop == imaged.screenshotCrop)
precondition(CartShareBatch.mergeOverlappingProducts([imaged, repricedMouse]).first?.screenshotCrop == nil)
let oldRow = Data(#"{"name":"罗技鼠标","variant":"黑色","priceCents":4500,"platform":"京东"}"#.utf8)
let restored = try JSONDecoder().decode(CartScreenProduct.self, from: oldRow)
precondition(restored.screenshotCrop == nil && restored.priceCents == 4500)
let many = (1...15).map { index in
    CartScreenProduct(name: "耳机 \(index)", variant: "白色", platform: "京东",
                      priceCents: index == 15 ? nil : 4500, screenshotCrop: Data(repeating: 0xa9, count: CartScreenshotCrop.maxBytes))
}
let bounded = CartShareBatch(recognized: many)
precondition(bounded.products.count == many.count && bounded.products.last?.screenshotCrop != nil)
precondition(bounded.products.compactMap(\.screenshotCrop).reduce(0) { $0 + $1.count } <= CartScreenshotCrop.batchBytes)
let stripped = bounded.removingScreenshotCrops()
precondition(stripped.id == bounded.id && stripped.sharedAt == bounded.sharedAt)
precondition(stripped.products.map(\.priceCents) == bounded.products.map(\.priceCents))
precondition(stripped.products.allSatisfy { $0.screenshotCrop == nil })
print("多张分享截屏合并重叠商品、保留平台差异、价格冲突进入待核对")
