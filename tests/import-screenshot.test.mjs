import assert from 'node:assert/strict'
import test from 'node:test'
import { importProduct } from '../api/import-product.js'
import { importScreenshot } from '../src/lib/linkedProduct.js'
import { MAX_IMAGE_BYTES } from '../src/lib/productImport.js'
import { detectScreenshotMime, screenshotFileError, validateScreenshotDataUrl } from '../src/lib/screenshotImage.js'

// 三种格式均为程序生成的 1×1 像素图，模型响应与商品页均来自测试内存。
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQD3A0FDAAAAAElFTkSuQmCC'
const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCLAGVxf//Z'
const webp = 'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA='
const image = 'data:image/png;base64,' + png
const product = { productCount: 1, name: '校园降噪耳机', variant: '雾蓝色 · 标准版', platform: null, price: 399, currency: 'CNY', priceKind: 'unit', priceEvidence: '单价 ￥399.00' }
const link = 'https://item.taobao.com/item.htm?id=134&skuId=159'
const title = product.name + ' ' + product.variant
const row = { url: link, title }
const page = { url: link, title, content: title + '\n单价：¥380' }
const quoted = { name: product.name, variant: product.variant, price: 380, evidence: '单价：¥380' }

async function run({ visual = product, results = [], fetched = page, details = quoted } = {}) {
  const calls = []
  let query
  const post = async (path, body) => {
    calls.push(path)
    if (path === '/v1/tools/search') {
      query = body.query
      return { results }
    }
    if (path === '/v1/tools/fetch') return fetched
    assert.equal(path, '/chat/completions')
    const user = body.messages[1]
    if (Array.isArray(user.content)) {
      assert.equal(body.temperature, 0)
      assert.equal(user.role, 'user')
      assert.equal(user.content.length, 2)
      assert.equal(user.content[0].type, 'text')
      assert.deepEqual(user.content[1], { type: 'image_url', image_url: { url: image } })
    } else assert.equal(Object.hasOwn(body, 'temperature'), false)
    const response = Array.isArray(user.content) ? visual : details
    return { choices: [{ message: { content: JSON.stringify(response) } }] }
  }
  const result = await importScreenshot(image, post)
  return { result, calls, query }
}

test('三种真实文件签名和文件边界均核对，缺 MIME 可识别，错 MIME、扩展名或截断会拒绝', () => {
  for (const [encoded, type, suffix] of [[png, 'image/png', 'png'], [jpeg, 'image/jpeg', 'jpg'], [webp, 'image/webp', 'webp']]) {
    const bytes = Buffer.from(encoded, 'base64')
    assert.equal(detectScreenshotMime(bytes), type)
    assert.equal(screenshotFileError(bytes, '', '截图.' + suffix), '')
    assert.equal(screenshotFileError(bytes, 'application/octet-stream', '截图'), '')
    assert.notEqual(screenshotFileError(bytes, 'image/gif', '截图.' + suffix), '')
    assert.notEqual(screenshotFileError(bytes, type, '截图.pdf'), '')
    assert.notEqual(screenshotFileError(bytes.subarray(0, -5), type), '')
    validateScreenshotDataUrl('data:' + type + ';base64,' + encoded)
  }
})

test('伪图片、超 20 MiB、混合输入均在请求上游前拒绝，真实图片没有凭证报告 503', async () => {
  const requests = []
  const request = (target) => { requests.push(target); throw new Error('unexpected network') }
  const tooBig = 'data:image/png;base64,' + Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64')
  for (const [input, status] of [
    [{ image: 'data:image/png;base64,YQ==' }, 400], [{ image: 'data:image/jpeg;base64,' + png }, 400],
    [{ image: tooBig }, 413], [{ image, link }, 400],
  ]) await assert.rejects(importProduct(input, { apiKey: 'stub', request }), { status })
  await assert.rejects(importProduct({image}, {request}), {status:503})
  assert.deepEqual(requests, [])
})

test('20 MiB 完整 JPEG（含边界）可原图直连，超一个字节在请求上游前返回 413', async () => {
  const original = Buffer.from(jpeg, 'base64')
  // 合法的 APP15 元数据段不改变像素，构造准确可复现的文件大小。
  const atLimit = Buffer.alloc(20 * 1024 * 1024)
  original.copy(atLimit, 0, 0, 2)
  for (let offset = 2, remaining = atLimit.length - original.length; remaining > 0;) {
    let segment = Math.min(65537, remaining)
    if (remaining > segment && remaining - segment < 4) segment -= 4
    atLimit.writeUInt16BE(0xffef, offset)
    atLimit.writeUInt16BE(segment - 2, offset + 2)
    offset += segment
    remaining -= segment
  }
  original.copy(atLimit, atLimit.length - original.length + 2, 2)
  const image = 'data:image/jpeg;base64,' + atLimit.toString('base64')
  const calls = []
  const request = async (url, init) => {
    calls.push(url)
    assert.equal(JSON.parse(init.body).messages[1].content[1].image_url.url, image)
    return Response.json({ choices: [{ message: { content: JSON.stringify(product) } }] })
  }
  assert.equal(screenshotFileError(atLimit, 'image/jpeg', '边界.jpeg'), '')
  assert.equal((await importProduct({ image }, { apiKey: 'test', request })).name, product.name)
  const oversize = Buffer.concat([atLimit, Buffer.alloc(1)])
  assert.match(screenshotFileError(oversize, 'image/jpeg'), /20 MB/u)
  await assert.rejects(importProduct({ image: 'data:image/jpeg;base64,' + oversize.toString('base64') }, { apiKey: 'test', request }), { status: 413 })
  assert.equal(calls.length, 1)
})

test('单品原图价可用，缺价、券价、区间、非人民币或证据不一致均保留可编辑空价格', async () => {
  const { result, calls } = await run()
  assert.equal(result.price, 399)
  assert.equal(result.priceSource, 'screenshot')
  assert.equal(result.link, '')
  assert.deepEqual(calls, ['/chat/completions'])
  for (const changes of [
    { price: null }, { price: 398 }, { priceEvidence: '' }, { priceEvidence: '单价 ¥399 起' },
    { priceEvidence: '优惠券后 ¥399' }, { priceEvidence: '¥399—¥499' }, { priceEvidence: '总计 ¥399' },
    { priceEvidence: '推荐同款 ¥399' }, { priceKind: 'total' }, { priceEvidence: '399 美元' },
    { currency: 'JPY', priceEvidence: '¥399' }, { priceEvidence: '¥399' }, { priceEvidence: 'HK$399' }, { priceEvidence: '399' },
  ]) {
    const { result: option } = await run({ visual: { ...product, ...changes } })
    assert.equal(option.price, null, JSON.stringify(changes))
    assert.equal(option.priceSource, null)
    assert.equal(option.name, product.name)
  }
})

test('空图、多件图不生成单件草稿，缺规格时保留原图信息', async () => {
  for (const changes of [{ productCount: 2 }, { productCount: 0 }, { name: '' }]) {
    const { result, calls } = await run({ visual: { ...product, ...changes } })
    assert.equal(result, null)
    assert.equal(calls.length, 1)
  }
  const { result, calls } = await run({ visual: { ...product, variant: '', platform: '淘宝' } })
  assert.equal(result.priceSource, 'screenshot')
  assert.equal(result.link, '')
  assert.equal(calls.length, 1)
})

test('天猫单品卡可保留商城和独立标价；缺价与结算合计保留空价', async () => {
  const single = { ...product, variant: '', platform: '天猫', price: 78.5, priceEvidence: '78.50 元' }
  for (const [changes, expected] of [
    [{}, 78.5],
    [{ price: null, priceKind: null, currency: null, priceEvidence: '' }, null],
    [{ priceKind: 'total' }, null],
    [{ priceKind: 'unit', priceEvidence: '订单合计：78.50 元' }, null],
  ]) {
    const { result, calls } = await run({ visual: { ...single, ...changes } })
    assert.equal(result.platform, '天猫')
    assert.equal(result.variant, '')
    assert.equal(result.price, expected)
    assert.equal(result.priceSource, expected === null ? null : 'screenshot')
    assert.deepEqual(calls, ['/chat/completions'])
  }
})

test('天猫徽标只补天猫详情页，拦截相同编号的淘宝页与跳转并兼容旧淘宝记录', async () => {
  const visual = { ...product, platform: '天猫' }
  for (const host of ['detail.tmall.com', 'detail.m.tmall.com']) {
    const url = link.replace('item.taobao.com', host)
    const resultRow = { ...row, url }
    const resultPage = { ...page, url }
    const verified = await run({ visual, results: [row, resultRow], fetched: resultPage })
    assert.match(verified.query, /site:detail\.tmall\.com OR site:detail\.m\.tmall\.com$/u)
    assert.ok(!verified.query.includes('taobao.com'))
    assert.equal(verified.result.platform, '天猫')
    assert.equal(verified.result.link, url)
    assert.equal(verified.result.priceSource, 'web')
    const legacy = await run({ visual: { ...visual, platform: '淘宝' }, results: [resultRow], fetched: resultPage })
    assert.equal(legacy.result.link, url)
    assert.equal(legacy.result.platform, '淘宝')
    for (const options of [{ results: [row] }, { results: [resultRow], fetched: page }]) {
      const rejected = await run({ visual, ...options })
      assert.equal(rejected.result.link, '')
      assert.equal(rejected.result.priceSource, 'screenshot')
    }
  }
})

test('搜索结果不是核价证据；同平台、同款、同规格且实页有可靠单价才优先用 web', async () => {
  const visual = { ...product, platform: '淘宝' }
  const { result } = await run({ visual, results: [row] })
  assert.equal(result.price, 380)
  assert.equal(result.priceSource, 'web')
  assert.equal(result.link, link)
  const other = { ...row, url: link.replace('159', '160') }
  for (const changes of [
    { results: [row, other] },
    { results: [{ ...row, url: 'https://item.jd.com/134.html' }] },
    { fetched: { ...page, url: other.url } },
    { fetched: { ...page, title: product.name + ' 红色 · 标准版' } },
    { details: { ...quoted, variant: '红色' } },
  ]) {
    const { result: uncertain } = await run({ visual, results: [row], ...changes })
    assert.equal(uncertain.price, 399)
    assert.equal(uncertain.priceSource, 'screenshot')
    assert.equal(uncertain.link, '')
  }
  const { result: recommendation } = await run({ visual, results: [row], fetched: { ...page, content: title + '\n看了又看\n其他耳机 ¥380' }, details: { ...quoted, evidence: '其他耳机 ¥380' } })
  assert.equal(recommendation.priceSource, 'screenshot')
  assert.equal(recommendation.link, link)
})
