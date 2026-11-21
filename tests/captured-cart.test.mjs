import assert from 'node:assert/strict'
import test from 'node:test'
import { CART_PLATFORMS, cartImportLabel, correctCapturedTitle, importCapturedCart, readCartItems,
  requiresCaptureCategory, reviewScreenshotUrl } from '../src/lib/capturedCartItems.js'
import { evaluateLock } from '../src/lib/rules.js'
import { cartLookupInput, finishCartLinkLookup } from '../src/lib/cartProductLinks.js'

const mouse = { id: 'ocr-ephemeral', newId: 'cart-mouse', name: '罗技 M185 鼠标', variant: '黑色', platform: '京东', price: 45 }
const pen = { id: 'pen', name: '速干中性笔', variant: '五支装', platform: '', price: null }
const makeItem = (draft, id) => ({ ...draft, id, demo: true, createdAt: 10, stage: 'cooling', cooldownStartedAt: 10, cooldownEndsAt: 20, lockReasons: ['全锁'] })
const batch = (items, rows, method = 'screenshot', platform = '') => importCapturedCart(items, rows, method, platform, makeItem)

test('批量入库无法绕过品类锁，已查到分类时重导仍须确认', () => {
  const settings = { lockRules: { all: false, categories: ['数码'] } }
  const make = (draft, id) => ({ ...draft, id, stage: evaluateLock(draft, settings).locked ? 'cooling' : 'approved' })
  for (const method of ['screenshot', 'shareSheet', 'screenSharing']) {
    const first = importCapturedCart([], [mouse], method, '', make, settings)
    assert.equal(first.added, 0)
    assert.equal(first.review, 1)
    const [pending] = first.items
    assert.equal(pending.stage, 'cartReview')
    assert.equal(pending.cartReviewReason, 'category')
    assert.equal(pending.price, 45)
    assert.equal(requiresCaptureCategory(pending, settings), true)
    const verified = finishCartLinkLookup(pending, cartLookupInput(pending), {
      automatic: true, category: '数码', offers: [{
        link: 'https://item.jd.com/423478.html', name: mouse.name, variant: mouse.variant, variantVerified: true,
      }],
    })
    assert.equal(verified.category, '数码')
    assert.equal(verified.stage, 'cartReview')
    assert.equal(importCapturedCart([verified], [mouse], method, '', make, settings).items[0].stage, 'cartReview')
    assert.equal(make(verified, pending.id).stage, 'cooling')
    assert.equal(make({ ...verified, category: '生活' }, pending.id).stage, 'approved')
  }
  for (const lockRules of [
    { all: true, categories: ['数码'] },
    { all: false, categories: ['数码'], thresholdYuan: 40 },
    { all: false, categories: ['数码'], categoryThresholdYuan: 45 },
  ]) assert.equal(importCapturedCart([], [mouse], 'screenshot', '', make, { lockRules }).added, 1)
})

test('已入库 OCR 名称更正保留记录与原始去重依据，待查链接按新名称重试', () => {
  const [imported] = batch([], [{ ...mouse, name: '罗技 M185 昆标' }]).items
  const prior = { ...imported, cartLinkLookup: { status: 'none' }, stage: 'purchased', paidCents: 4000 }
  const { item } = correctCapturedTitle(prior, mouse.name, [prior])
  assert.equal(item.captureOriginalName, prior.name)
  assert.equal(item.name, mouse.name)
  assert.equal(item.id, prior.id)
  assert.equal(item.price, prior.price)
  assert.equal(item.stage, 'purchased')
  assert.equal(item.paidCents, 4000)
  assert.equal(item.cooldownEndsAt, prior.cooldownEndsAt)
  assert.deepEqual(item.cartImport, prior.cartImport)
  assert.equal(item.cartLinkLookup, undefined)
  assert.equal(batch([item], [{ ...mouse, id: 'rescan', newId: 'rescan', name: prior.name }]).skipped, 1)
  assert.ok(correctCapturedTitle(prior, mouse.name, [prior, { ...imported, id: 'same', name: mouse.name }]).error)
})

function thumbnail(bytes = 120) {
  const data = Buffer.alloc(bytes, 0xb3)
  data.set([0xff, 0xd8, 0xff])
  data.set([0xff, 0xd9], bytes - 2)
  return data.toString('base64')
}

test('一批按画面顺序自动加入，缺价保留草稿，不产生冷静或放行时间', () => {
  const result = batch([], [mouse, pen])
  assert.deepEqual([result.added, result.review, result.skipped], [1, 1, 0])
  const [ready, waiting] = result.items
  assert.equal(ready.id, 'cart-mouse')
  assert.equal(ready.priceSource, 'screen_capture')
  assert.equal(ready.stage, 'cooling')
  assert.equal(cartImportLabel(ready), '京东 · 购物车截屏')
  assert.deepEqual(waiting, { id: 'pen', demo: true, createdAt: 10, name: pen.name, variant: pen.variant, platform: '',
    price: null, priceSource: '', link: '', category: '', stage: 'cartReview', cartReviewReason: 'price',
    cartImport: { method: 'screenshot', platform: '' } })
  assert.deepEqual(CART_PLATFORMS, ['京东', '淘宝', '天猫'])
  assert.equal(cartImportLabel({ ...waiting, cartImport: { platform: '', method: 'screenSharing' } }), '平台待确认 · 屏幕共享识别')
  assert.equal(cartImportLabel({ source: 'self_reported' }), '')
})

test('重选、跨方法重放和旧购物车识别记录都不覆盖原价、冷静期及付款', () => {
  const first = batch([], [mouse]).items[0]
  const oldPayment = { ...first, id: 'legacy', stage: 'purchased', source: 'self_reported', paidCents: 4000, paidAt: 50 }
  delete oldPayment.cartImport
  const newRead = { ...mouse, id: 'new-capture-id', newId: 'new-cart-id', name: '罗技ｍ１８５鼠标', price: 69 }
  for (const existing of [first, oldPayment]) {
    const items = [existing]
    const result = batch(items, [newRead], 'screenSharing')
    assert.deepEqual([result.added, result.review, result.skipped], [0, 0, 1])
    assert.strictEqual(result.items, items)
    assert.equal(result.items[0].price, 45)
  }
  assert.equal(cartImportLabel(oldPayment), '京东 · 购物车识别')
})

test('同名旧手填或多规格候选只待核对，明示不同规格／平台分别新增', () => {
  const manual = { id: 'old', name: mouse.name, platform: '京东', variant: '黑色', stage: 'pending', approvedAt: 57 }
  const white = { ...mouse, newId: 'white', variant: '白色' }
  const tb = { ...mouse, newId: 'tb', platform: '淘宝' }
  const result = batch([manual], [mouse, white, tb])
  assert.deepEqual([result.added, result.review, result.skipped], [2, 1, 0])
  assert.equal(result.items[0].cartReviewReason, 'duplicate')
  assert.strictEqual(result.items[3], manual)
  const again = batch(result.items, [{ ...mouse, newId: 'fresh-id' }])
  assert.strictEqual(again.items, result.items)
  const ambiguous = batch(result.items, [{ ...mouse, newId: 'without-variant', variant: '' }])
  assert.equal(ambiguous.items[0].cartReviewReason, 'duplicate')
})

test('新识别补齐价款后晋级沿用原 id、来源、添加时间；有同款冲突时不晋级', () => {
  const waiting = { ...batch([], [pen], 'screenSharing', '天猫').items[0], createdAt: 2 }
  const priced = { ...pen, newId: 'new-read', platform: '天猫', price: 12.80 }
  const promoted = batch([waiting], [priced]).items[0]
  assert.equal(promoted.id, 'pen')
  assert.equal(promoted.stage, 'cooling')
  assert.equal(promoted.price, 12.8)
  assert.equal(promoted.createdAt, 2)
  assert.equal(promoted.cooldownStartedAt, 10)
  assert.equal(cartImportLabel(promoted), '天猫 · 屏幕共享识别')
  const mixed = batch([], [pen, { ...pen, newId: 'same-batch', price: 12.8 }])
  assert.deepEqual([mixed.items.length, mixed.added, mixed.review, mixed.skipped], [1, 1, 0, 1])
  const other = { id: 'manual', name: pen.name, platform: '天猫', variant: pen.variant, stage: 'approved' }
  const rows = [waiting, other]
  assert.strictEqual(batch(rows, [priced]).items, rows)
})

test('价格异常不入账或冒充手填，取消识别／无候选维持旧状态', () => {
  for (const bad of [0, -1, 2.345, 10000000.01, '99']) {
    const [row] = readCartItems([{ ...mouse, price: bad }])
    assert.equal(row.price, null)
    assert.equal(batch([], [row]).items[0].cartReviewReason, 'price')
  }
  const rows = [makeItem(mouse, 'existing')]
  assert.strictEqual(batch(rows, []).items, rows)
})

test('只为待核对的截屏商品保留局部图，补齐单价后释放', () => {
  const crop = thumbnail()
  const [ready, waiting] = batch([], readCartItems([
    { ...mouse, screenshotCrop: crop }, { ...pen, screenshotCrop: crop },
  ])).items
  assert.equal(ready.screenshotCrop, undefined)
  assert.equal(reviewScreenshotUrl(ready), '')
  assert.equal(waiting.screenshotCrop, crop)
  assert.equal(reviewScreenshotUrl(waiting), 'data:image/jpeg;base64,' + crop)
  assert.equal(batch([], [{ ...pen, screenshotCrop: crop }], 'screenSharing').items[0].screenshotCrop, undefined)
  const promoted = batch([waiting], [{ ...pen, price: 32, screenshotCrop: crop }]).items[0]
  assert.equal(promoted.id, waiting.id)
  assert.equal(promoted.stage, 'cooling')
  assert.equal(promoted.screenshotCrop, undefined)
  assert.equal(reviewScreenshotUrl(promoted), '')
})

test('同一局部图补读规格和单价后升级旧草稿，另一张图单独保留', () => {
  const crop = thumbnail()
  const [old] = batch([], [{ ...mouse, variant: '', price: null, screenshotCrop: crop }]).items
  const recovered = { ...mouse, id: 'fresh-read', newId: 'fresh-cart', screenshotCrop: crop }
  const result = batch([old], [recovered])
  assert.equal(result.items.length, 1)
  assert.deepEqual([result.items[0].id, result.items[0].variant, result.items[0].price, result.items[0].stage],
    [old.id, mouse.variant, 45, 'cooling'])
  const different = batch([old], [{ ...recovered, screenshotCrop: thumbnail(125) }])
  assert.equal(different.items.length, 2)
  assert.strictEqual(different.items[1], old)
})

test('再次识别到购物车标价时仍保留已核对资料，并按同一购买页检查已有商品', () => {
  const draft = batch([], [pen]).items[0]
  const link = 'https://detail.tmall.com/item.htm?id=8001&skuId=901'
  const waiting = { ...draft, link, price: 30, priceSource: 'web', category: '学习', matchSource: 'merchant',
    details: '官方店同款中性笔', cartLinkLookup: { status: 'linked' } }
  const promoted = batch([waiting], [{ ...pen, price: 32 }]).items[0]
  assert.deepEqual([promoted.link, promoted.details, promoted.category, promoted.price, promoted.priceSource],
    [link, waiting.details, '学习', 32, 'screen_capture'])
  const duplicate = { id: 'already-saved', link, name: '其他标题', variant: draft.variant, stage: 'cooling' }
  const items = [waiting, duplicate]
  assert.strictEqual(batch(items, [{ ...pen, price: 32 }]).items, items)
})

test('重新分享补齐旧待核对条目的局部图，其他来源和重放不会改写', () => {
  const waiting = batch([], [pen], 'shareSheet').items[0]
  const crop = thumbnail()
  const read = { ...pen, id: 'new-scan', screenshotCrop: crop }
  const ignored = batch([waiting], [read], 'screenshot')
  assert.strictEqual(ignored.items[0], waiting)
  const result = batch([waiting], [read], 'shareSheet')
  assert.deepEqual([result.added, result.review, result.skipped], [0, 0, 1])
  assert.deepEqual(result.items[0], { ...waiting, screenshotCrop: crop })
  const repeated = batch(result.items, [{ ...read, screenshotCrop: thumbnail(128) }], 'shareSheet')
  assert.strictEqual(repeated.items, result.items)
})

test('无效、超大或超预算的局部图不阻止文字导入', () => {
  const invalid = ['https://example.com/product.jpg', 'data:image/jpeg;base64,' + thumbnail(), '/9j/' + '0'.repeat(60),
    '/9j/' + 'A'.repeat(10) + '=\n', thumbnail(18 * 1024 + 1)]
  for (const value of invalid) {
    const [row] = readCartItems([{ ...pen, screenshotCrop: value }])
    assert.equal(row.screenshotCrop, undefined)
    assert.equal(batch([], [{ ...pen, screenshotCrop: value }]).items[0].stage, 'cartReview')
  }
  const max = thumbnail(18 * 1024)
  const rows = Array.from({ length: 20 }, (_, index) => ({ ...pen, id: 'row' + index, name: '商品 ' + index, screenshotCrop: max }))
  const result = batch([], rows)
  assert.equal(result.items.length, rows.length)
  assert.equal(result.items.filter((item) => item.screenshotCrop).length, 10)
  assert.equal(result.review, rows.length)
})
