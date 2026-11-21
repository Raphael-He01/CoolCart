import assert from 'node:assert/strict'
import test from 'node:test'
import { importProduct } from '../api/import-product.js'
import { cartLookupInput, chooseCartLink, finishCartLinkLookup } from '../src/lib/cartProductLinks.js'
import { importCapturedProductLink } from '../src/lib/linkedProduct.js'

const name = '罗技 M185 无线昆标'
const variant = '黑色灰边'
const input = { name, variant, platform: '京东' }
const title = '罗技（Logitech）M185 无线鼠标 黑色灰边'
const shop = '罗技京东自营旗舰店'
const sku = '423478'
const desktop = 'https://item.jd.com/' + sku + '.html'
const mobile = 'https://item.m.jd.com/product/' + sku + '.html'
const other = 'https://item.jd.com/423479.html'
const asset = 'jfs/t1/42/m185.jpg'
const image = 'https://m.360buyimg.com/mobilecms/s750x750_' + asset

function jdPage(id = sku, heading = title, seller = shop, vendorId = '19876') {
  const item = { skuId: id, skuName: heading, venderID: '19876', image: [asset],
    newColorSize: [{ skuId: id, color: variant }, { skuId: '12345', color: '红色' }] }
  const stock = { skuId: id, D: { venderId: vendorId, shopName: seller } }
  return '<script>window._itemOnly = (' + JSON.stringify({ item }) + ');'
    + 'window._itemInfo = (' + JSON.stringify({ stock }) + ')</script><img id="firstImg" src="' + image + '">'
}

function searchFixture(rows, pages = {}, fetched = {}) {
  return {
    async post(path, body) {
      if (path.endsWith('/search')) return { results: rows }
      if (path.endsWith('/fetch')) {
        if (fetched[body.url] instanceof Error) throw fetched[body.url]
        return fetched[body.url] || null
      }
      assert.equal(body.messages[1].content, name)
      return { choices: [{ message: { content: JSON.stringify({ brand: '罗技', model: 'M185' }) } }] }
    },
    async readPage({ url }) { return pages[url] ?? null },
  }
}

test('购物车模式按来源搜索，从京东主 SKU 核对规格、主图与店铺，去除推广参数', async () => {
  const fixture = searchFixture([
    { title, url: desktop + '?utm_source=test' },
    { title, url: mobile },
    { title: '罗技 M186 (M185) 鼠标 黑色灰边', url: other },
    { title, url: 'https://detail.tmall.com/item.htm?id=42' },
  ], { [mobile]: jdPage() })
  const calls = []
  const checked = await importProduct({ cartProduct: input }, { apiKey: 'test-key', readPublicHtml: fixture.readPage,
    async request(url, options) {
      const { pathname } = new URL(url)
      const body = JSON.parse(options.body)
      calls.push([pathname, body])
      return Response.json(await fixture.post(pathname, body))
    },
  })
  assert.equal(checked.automatic, true)
  assert.deepEqual(checked.offers, [{ link: mobile, name: title, shop, imageUrl: image, variantVerified: true, variant }])
  assert.equal(calls.filter(([path, body]) => path.endsWith('/search') && /M185 黑色灰边/u.test(body.query)).length, 2)
})

test('缺规格或来源只能建议；页面规格不明、跨平台、变体混排和登录页都不能自动关联', async () => {
  for (const row of [{ ...input, variant: '' }, { ...input, platform: '' }]) {
    const { post, readPage } = searchFixture([{ title, url: desktop }], { [mobile]: jdPage() })
    const result = await importCapturedProductLink(row, post, readPage)
    assert.equal(result.automatic, false)
    assert.equal(result.offers[0]?.link, mobile)
  }
  const mix = '罗技 M185 黑色灰边/蓝边'
  const { post, readPage } = searchFixture([{ title: mix, url: desktop }], { [mobile]: jdPage(sku, mix) })
  assert.equal((await importCapturedProductLink(input, post, readPage)).automatic, false)
  assert.deepEqual((await importCapturedProductLink({ ...input, platform: '天猫' }, post, readPage)).offers, [])

  const bad = searchFixture([{ title, url: desktop }], { [mobile]: jdPage('999') }, {
    [desktop]: { title: '欢迎登录', url: desktop, content: title },
  })
  assert.deepEqual((await importCapturedProductLink(input, bad.post, bad.readPage)).offers, [])
})

test('两个核实的京东购买页由用户选择，无法核实第二页时也不自动关联第一条', async () => {
  const otherMobile = other.replace('item.jd.com/', 'item.m.jd.com/product/')
  const fixture = searchFixture([{ title, url: desktop }, { title, url: other }], {
    [mobile]: jdPage(), [otherMobile]: jdPage('423479', title, '另一家店'),
  })
  const result = await importCapturedProductLink(input, fixture.post, fixture.readPage)
  assert.equal(result.automatic, false)
  assert.deepEqual(result.offers.map(({ shop }) => shop), [shop, '另一家店'])

  const partial = searchFixture([{ title, url: desktop }, { title, url: other }], { [mobile]: jdPage() })
  const checked = await importCapturedProductLink(input, partial.post, partial.readPage)
  assert.deepEqual([checked.automatic, checked.offers.length], [false, 1])

  const partialSearch = await importCapturedProductLink(input, (path, body) => {
    if (body?.query?.endsWith('site:item.jd.com')) throw new Error('search interrupted')
    return partial.post(path, body)
  }, partial.readPage)
  assert.deepEqual([partialSearch.automatic, partialSearch.offers[0].link], [false, mobile])
})

test('淘宝与天猫各用来源商城，只有核对商品页和显式规格编号后才能自动关联', async () => {
  const tb = 'https://item.taobao.com/item.htm?id=42&skuId=55'
  const tm = 'https://detail.tmall.com/item.htm?id=42'
  const rows = [{ title, url: tb }, { title, url: tm }]
  const pages = {
    [tb]: { title, url: tb, content: title + '\n店铺：罗技官方店' },
    [tm]: { title, url: tm, content: title + '\n商家：罗技旗舰店' },
  }
  const { post } = searchFixture(rows, {}, pages)
  const taobao = await importCapturedProductLink({ ...input, platform: '淘宝' }, post)
  assert.deepEqual([taobao.automatic, taobao.offers.map(({ link }) => link)], [true, [tb]])
  const tmall = await importCapturedProductLink({ ...input, platform: '天猫' }, post)
  assert.deepEqual([tmall.automatic, tmall.offers.map(({ link }) => link)], [false, [tm]])
  const redirect = searchFixture(rows, {}, { [tb]: { ...pages[tb], url: tm } })
  assert.deepEqual((await importCapturedProductLink({ ...input, platform: '淘宝' }, redirect.post)).offers, [])
})

test('商品查询坏输入和缺服务配置在访问上游之前返回，详情服务故障允许重试', async () => {
  const request = () => { assert.fail('must not call upstream') }
  await assert.rejects(importProduct({ cartProduct: input, query: name }, { apiKey: 'test-key', request }), { status: 400 })
  await assert.rejects(importProduct({ cartProduct: { ...input, platform: null } }, { apiKey: 'test-key', request }), { status: 400 })
  await assert.rejects(importProduct({ cartProduct: { ...input, variant: 'https://example.org' } }, { apiKey: 'test-key', request }), { status: 400 })
  await assert.rejects(importProduct({ cartProduct: input }, { request }), { status: 503 })

  const failed = searchFixture([{ title, url: desktop }], {}, { [desktop]: new Error('查找超时') })
  await assert.rejects(importCapturedProductLink(input, failed.post), /查找超时/u)
})

test('自动与手选只补链接资料，保留原始单价、来源和冷静期；晚到结果不覆盖手填或支付状态', () => {
  const original = {
    id: 'screen-cart-1', ...input, link: '', price: 45, priceSource: 'screen_capture',
    stage: 'cooling', cooldownEndsAt: 12345, cartImport: { platform: '京东', method: 'screenshot' },
  }
  const request = cartLookupInput(original)
  const offer = { name: title, link: mobile, shop, imageUrl: image, variant, price: 199, variantVerified: true }
  const result = { automatic: true, offers: [offer] }
  const automatic = finishCartLinkLookup(original, request, result)
  assert.deepEqual(automatic, { ...original, link: mobile, details: title, imageUrl: image,
    cartLinkLookup: { status: 'linked', method: 'automatic', platform: '京东', shop, variant } })

  const unknown = { ...original, platform: '', cartImport: { ...original.cartImport, platform: '' } }
  const unconfirmed = finishCartLinkLookup(unknown, cartLookupInput(unknown), result)
  assert.equal(unconfirmed.cartLinkLookup.status, 'choices')
  assert.strictEqual(chooseCartLink(unconfirmed, other), unconfirmed)
  const selected = chooseCartLink(JSON.parse(JSON.stringify(unconfirmed)), mobile)
  assert.deepEqual([selected.link, selected.price, selected.platform, selected.cartImport.platform, selected.cartLinkLookup.method],
    [mobile, 45, '', '', 'selected'])

  for (const record of [{ ...original, link: other }, { ...original, stage: 'purchased' },
    { ...original, stage: 'abandoned' }, { ...original, variant: '蓝色' }]) {
    assert.strictEqual(finishCartLinkLookup(record, request, result), record)
  }
  const active = finishCartLinkLookup({ ...original, stage: 'quiz' }, request, result)
  assert.deepEqual([active.stage, active.link], ['quiz', mobile])
  assert.deepEqual(cartLookupInput({ ...original, stage: 'cartReview' }), request)
  assert.equal(finishCartLinkLookup(original, request, null).cartLinkLookup.status, 'error')
})

test('待核对项目缺价时查询已核实的京东目录单价；相邻型号与规格不能借价', async () => {
  const catalog = 'https://www.jd.com/chanpin/1001.html'
  const card = (id, heading, price) => `<li class="gl-item" data-sku="${id}">
    <div class="p-price"><strong class="J_${id}" data-price="${price}"><em></em><i></i></strong></div>
    <div class="p-name"><a href="//item.jd.com/${id}.html"><em>${heading}</em></a></div>
  </li>`
  const fixture = searchFixture([{ title, url: desktop }], { [mobile]: jdPage() })
  const post = (path, body) => body?.query?.endsWith('site:www.jd.com')
    ? { results: [{ url: catalog }] }
    : fixture.post(path, body)
  const query = { ...input, needsPrice: true }
  async function recover(heading) {
    const html = card('423479', title, 21) + card(sku, heading, 45)
    return importCapturedProductLink(query, post, ({ url }) => url === catalog ? html : fixture.readPage({ url }))
  }
  const matched = await recover(title)
  assert.deepEqual([matched.automatic, matched.offers[0].price], [true, 45])
  const wrong = await recover(title.replace(variant, '白色'))
  assert.equal(wrong.offers[0].price, undefined)
})

test('多个购物车条目独立补齐资料，保留原价和冷静期，缺价项待确认后入库', () => {
  const priced = { id: 'ready', ...input, stage: 'cooling', price: 39, priceSource: 'screen_capture',
    cooldownEndsAt: 98765, cartImport: { method: 'screenshot', platform: '京东' }, link: '' }
  const review = { id: 'review', ...input, stage: 'cartReview', price: null,
    cartImport: { method: 'shareSheet', platform: '京东' }, link: '' }
  const offer = { name: title, link: mobile, shop, imageUrl: image, variant, price: 45, variantVerified: true }
  const result = { automatic: true, offers: [offer], category: '数码' }
  const [first, second] = [priced, review].map((item) => finishCartLinkLookup(item, cartLookupInput(item), result))
  assert.deepEqual([first.price, first.priceSource, first.cooldownEndsAt, first.link], [39, 'screen_capture', 98765, mobile])
  assert.deepEqual([second.price, second.priceSource, second.link, second.imageUrl, second.category, second.stage],
    [45, 'web', mobile, image, '数码', 'cartReview'])
  assert.equal(second.cooldownEndsAt, undefined)
  assert.equal(second.cartImport.method, 'shareSheet')
  assert.strictEqual(finishCartLinkLookup(second, cartLookupInput(review), result), second)

  const mismatched = finishCartLinkLookup(review, cartLookupInput(review), {
    automatic: false, offers: [{ ...offer, variantVerified: false }],
  })
  assert.equal(mismatched.cartLinkLookup.status, 'choices')
  assert.equal(chooseCartLink(mismatched, mobile).price, null)
})
