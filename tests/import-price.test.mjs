import assert from 'node:assert/strict'
import test from 'node:test'
import { importProduct } from '../api/import-product.js'
import { importLinkedProduct } from '../src/lib/linkedProduct.js'
import { readProductLink } from '../src/lib/productImport.js'

const url = 'https://item.taobao.com/item.htm?id=10001&skuId=10002'
const name = '罗技 M185 无线鼠标'
const variant = '黑色灰边'
const heading = '罗技（Logitech）M185鼠标 无线鼠标 办公鼠标 黑色灰边 带无线2.4G接收器'
const title = heading + '【行情 报价 价格 评测】-京东'
const page = (content) => ({ title, content, url })
const details = (price, evidence, fields) => ({ name, variant, price, evidence, ...fields })

// 提供商响应全部在进程内生成。用商品页的文本结构检验归属，不发网络请求。
async function run({ input = { link: url }, fetched = null, results = [], extracted = [] }) {
  const responses = [...extracted]
  const request = async (target) => {
    const path = new URL(target).pathname
    let value
    if (path === '/v1/tools/fetch') value = fetched
    else if (path === '/v1/tools/search') value = { results }
    else if (path === '/chat/completions') {
      assert.ok(responses.length, 'unexpected model call')
      value = { choices: [{ message: { content: JSON.stringify(responses.shift()) } }] }
    } else throw new Error('Unexpected upstream path')
    return { ok: true, json: async () => value }
  }
  const result = await importProduct(input, { apiKey: 'synthetic-test-value', request })
  assert.equal(responses.length, 0)
  return result
}

test('推荐区后的主商品购买卡可核对分行金额，推荐商品的报价不能借给本品', async () => {
  const fetched = page(['看了又看', '罗技 M196 无线鼠标 ¥54.89', heading + ' 收藏', '¥', '45.00', '登录查看到手价'].join('\n'))
  const main = await run({ fetched, extracted: [details(45, '¥\n45.00')] })
  assert.equal(main.price, 45)
  assert.equal(main.priceSource, 'web')
  const separateAction = await run({ fetched: page(fetched.content.replace(' 收藏', '\n收藏')), extracted: [details(45, '¥45.00')] })
  assert.equal(separateAction.price, 45)
  const longPage = await run({ fetched: page('商品说明\n'.repeat(4000) + fetched.content), extracted: [details(45, '¥45.00')] })
  assert.equal(longPage.price, 45)
  const recommendation = await run({ fetched, extracted: [details(54.89, '罗技 M196 无线鼠标 ¥54.89')] })
  assert.equal(recommendation.price, null)
  assert.equal(recommendation.priceSource, null)
})

test('主商品旁的普通售价有效；缺证据、错误规格、券后价和区间价均返回空价', async () => {
  const valid = await run({ fetched: page(heading + '\n单价：¥45'), extracted: [details(45, '单价：¥45')] })
  assert.equal(valid.price, 45)
  for (const label of ['售价', '当前单价']) {
    const evidence = label + '：¥399.90'
    const priced = await run({ fetched: page(heading + '\n' + evidence), extracted: [details(399.90, evidence)] })
    assert.equal(priced.price, 399.90)
  }
  for (const [body, evidence] of [
    ['罗技 M196 白色\n单价：¥40', '单价：¥40'],
    [heading.replace('黑色灰边', '白色') + '\n¥40', '¥40'],
    [heading + '\n券后价 ¥40', '券后价 ¥40'],
    [heading + '\n券后售价\n¥\n40', '¥ 40'],
    [heading + '\n¥40～¥60', '¥40～¥60'],
    [heading + '\n¥\n40\n至\n¥60', '¥40'],
    [heading + '\n¥40', '¥41'],
    [heading + '\n猜你喜欢\n' + heading + '\n¥40', '¥40'],
  ]) {
    const result = await run({ fetched: page(body), extracted: [details(40, evidence)] })
    assert.equal(result.price, null, body)
    assert.equal(result.priceSource, null)
  }
})

test('分行优惠、结算、区间及相邻冲突 SKU 报价均留空，明确同一 SKU 的规格行可核价', async () => {
  for (const body of [
    heading + '\n¥399\n新人专享价', heading + '\n¥399\n待支付金额',
    heading + '\n¥399\n—\n¥459', 'SKU: 10003\n' + heading + '\n¥399',
  ]) {
    const result = await run({ fetched: page(body), extracted: [details(399, '¥399')] })
    assert.deepEqual([result.price, result.priceSource], [null, null], body)
  }
  const correct = 'SKU: 10002 | 黑色灰边 | ¥399'
  const another = 'SKU: 10003 | 黑色灰边 | ¥359'
  for (const [evidence, price, expected] of [[correct, 399, 399], [another, 359, null]]) {
    const result = await run({ fetched: page(correct + '\n' + another), extracted: [details(price, evidence)] })
    assert.equal(result.price, expected)
  }
})

test('传入 SKU 不能代替上游规格证据：同名同色普通价须来自精确详情 URL', async () => {
  const content = heading + '\n¥399'
  const quote = details(399, '¥399')
  const unknown = await run({ fetched: { title, content }, extracted: [quote] })
  assert.deepEqual([unknown.price, unknown.priceSource, unknown.variant], [null, null, variant])
  const direct = await run({ fetched: { title, content, url }, extracted: [quote] })
  assert.deepEqual([direct.price, direct.priceSource], [399, 'web'])
  const evidence = 'SKU: 10002 | 黑色灰边 | ¥399'
  const row = await run({ fetched: { title, content: evidence }, extracted: [details(399, evidence)] })
  assert.deepEqual([row.price, row.priceSource], [399, 'web'])
})

test('短链保留分享入口；只有同平台确定的商品详情落地网址才采信正文', async () => {
  const share = 'https://m.tb.cn/h.fixture'
  const fetched = page(heading + '\n¥45')
  for (const target of [undefined, share, 'https://example.com/redirect', 'https://item.jd.com/423478.html']) {
    const result = await run({ input: { link: share }, fetched: { ...fetched, url: target } })
    assert.deepEqual([result.link, result.name, result.price, result.priceSource], [share, '', null, null])
  }
  const result = await run({ input: { link: share }, fetched: { ...fetched, url }, extracted: [details(45, '¥45')] })
  assert.deepEqual([result.link, result.name, result.price, result.priceSource], [share, name, 45, 'web'])
})

test('搜索回退须匹配平台、商品、规格编号及已读规格文本', async () => {
  const first = page(heading)
  const quoted = { ...page(heading + '\n售价：¥45'), url }
  const known = details(null, '')
  for (const [input, wrong] of [
    [url, url.replace('10002', '10003')],
    [url, url.replace('10001', '10004')],
    [url, url.split('&')[0]],
    [url.split('&')[0], url],
    [url, 'https://item.jd.com/10001.html?skuId=10002'],
  ]) {
    const result = await run({ input: { link: input }, fetched: first, results: [{ ...quoted, url: wrong }], extracted: [known] })
    assert.equal(result.price, null)
  }
  const different = await run({ fetched: first, results: [quoted], extracted: [known, details(45, '售价：¥45', { variant: '白色' })] })
  assert.equal(different.price, null)
  assert.equal(different.variant, variant)
  const same = await run({ fetched: first, results: [quoted], extracted: [known, details(45, '售价：¥45')] })
  assert.equal(same.price, 45)
  const redirected = await run({ fetched: { ...quoted, url: url.replace('10002', '10003') } })
  assert.equal(redirected.price, null)
})

test('截图搜索命中异规格页面时保留截图标价；缺价继续交给用户补填', async () => {
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQD3A0FDAAAAAElFTkSuQmCC'
  const result = await run({
    input: { image },
    fetched: page('罗技 M185 无线鼠标 白色\n单价：¥45'),
    results: [{ title: name, url }],
    extracted: [{ productCount: 1, name, variant, price: 55, priceKind: 'unit', currency: 'CNY', priceEvidence: '单价 ¥55', platform: '淘宝' }, details(45, '单价：¥45', { variant: '白色' })],
  })
  assert.equal(result.price, 55)
  assert.equal(result.priceSource, 'screenshot')
  assert.equal(result.link, '')
  const missing = await run({ input: { image }, extracted: [{ productCount: 1, name, variant, price: null, platform: '淘宝' }] })
  assert.equal(missing.price, null)
  assert.equal(missing.priceSource, null)
})

const jdToken = 'https://item.jd.com/product/pWrkPb75a1pc2I1p5op2pw.html'
// 按已核对的主卡层级构造的小型测试 HTML，不是平台原文或在线报价记录。
const jdHtml = `<html><head><title>${title}</title><link rel="canonical" href="//item.jd.com/423478.html"/></head><body>
  <aside>看了又看：罗技 M196 ￥54.89</aside>
  <div class="itemInfo-wrap"><div class="information-wrap"><div class="infomation"><div class="sku-name">
    <span class="sku-name-title"><img src="thumb.png"/>${heading}</span><span class="collect follow J-follow" data-id="423478"><i></i>收藏</span>
  </div><div class="price-seo"><div class="price-box"><div class="symbol">&yen;</div><div class="value">45.00</div></div>
    <div class="arrow-box" style="display:none"><div class="text">登录查看到手价</div></div>
  </div></div></div></div></body></html>`

test('网页和原生端共享主卡解析；DeepSeek 只收到已核对标题，价格取自该卡', async () => {
  async function post(path, body) {
    assert.equal(path, '/chat/completions')
    assert.equal(body.messages[1].content, heading)
    return { choices: [{ message: { content: JSON.stringify({ name, variant, price: 99999 }) } }] }
  }
  const link = readProductLink(jdToken)
  const expected = await importLinkedProduct(link, post, async () => jdHtml)
  assert.deepEqual(expected, { name, variant, price: 45, platform: '京东', link: jdToken, priceSource: 'web',
    details: heading, imageUrl: '', matchSource: 'merchant' })
  const request = async (target, options) => {
    if (target === jdToken) {
      assert.equal(options.method, 'GET')
      assert.equal(options.credentials, 'omit')
      assert.equal(options.redirect, 'manual')
      assert.equal(new Headers(options.headers).has('Authorization'), false)
      assert.equal(new Headers(options.headers).has('Cookie'), false)
      return new Response(jdHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    assert.match(target, /^https:\/\/api\.deepseek\.com\//u)
    return Response.json(await post(new URL(target).pathname, JSON.parse(options.body)))
  }
  assert.deepEqual(await importProduct({ link: jdToken }, { apiKey: 'test-key', request }), expected)
})

test('主卡身份冲突、假卡、重复卡、非精确价和登录页面不产生公开报价', async () => {
  for (const [link, html] of [
    ['https://item.jd.com/12345.html', jdHtml],
    [jdToken + '?skuId=12345', jdHtml],
    [jdToken, jdHtml.replace('data-id="423478"', 'data-id="12345"')],
    [jdToken, jdHtml.replace(heading + '</span>', '另一商品</span>')],
    [jdToken, jdHtml.replace('class="itemInfo-wrap"', 'class="recommendations"')],
    [jdToken, jdHtml.replace('45.00', '39 至 45')],
    [jdToken, jdHtml.replace('登录查看到手价', '优惠券后价')],
    [jdToken, jdHtml.replace('</body>', '<div class="price-seo"></div></body>')],
    [jdToken, '<script>' + jdHtml + '</script>'],
  ]) {
    const paths = []
    const post = async (path) => {
      paths.push(path)
      return path === '/v1/tools/search' ? { results: [] } : { title: '京东-欢迎登录', content: '请登录' }
    }
    const result = await importLinkedProduct(readProductLink(link), post, async () => html)
    assert.equal(result.price, null)
    assert.equal(result.name, '')
    assert.ok(!paths.includes('/chat/completions'))
  }
})

test('京东公开 GET 拒绝重定向与超过上限的响应，缺密钥不产生任何请求', async () => {
  const fallback = () => Response.json({ title: '安全验证', content: '请完成验证码' })
  for (const response of [
    new Response('', { status: 302, headers: { location: 'https://example.org/' } }),
    new Response(jdHtml, { headers: { 'content-type': 'text/html', 'content-length': String(1024 * 1024 + 1) } }),
    new Response(' '.repeat(1024 * 1024) + jdHtml, { headers: { 'content-type': 'text/html' } }),
  ]) {
    const result = await importProduct({ link: jdToken }, { apiKey: 'test', request: async (target) => {
      if (target === jdToken) return response
      assert.equal(target, 'https://api.deepseek.com/v1/tools/fetch')
      return fallback()
    } })
    assert.equal(result.price, null)
  }
  let called = false
  await assert.rejects(importProduct({ link: jdToken }, { request: () => { called = true } }), { status: 503 })
  assert.equal(called, false)
})

test('名称查询实际调用模型与商城搜索；默认京东，只用复核后的主卡单价', async () => {
  const query = '罗技 M185 黑色灰边'
  const calls = []
  const request = async (url, options) => {
    const path = new URL(url).pathname
    const body = JSON.parse(options.body)
    calls.push({ path, query: body.query })
    if (path === '/chat/completions') return Response.json({ choices: [{ message: { content: JSON.stringify({
      name: '罗技 M185', brand: '罗技', model: 'M185', variant, category: '数码', price: 1,
    }) } }] })
    if (path === '/v1/tools/search') return Response.json({ results: [{ url: jdToken, title: heading, snippet: '¥1' }] })
    throw new Error('unexpected request')
  }
  const result = await importProduct({ query }, { apiKey: 'test', request, readPublicHtml: async ({ url }) => url === jdToken ? jdHtml : null })
  assert.equal(calls[0].path, '/chat/completions')
  assert.ok(calls.some((call) => call.query?.includes('site:item.jd.com')))
  assert.deepEqual([result.link,result.price,result.priceSource,result.platform,result.category], [jdToken,45,'web','京东','数码'])
  for (const input of [{ query: 'x' }, { query: jdToken }, { query, link: jdToken }]) {
    await assert.rejects(importProduct(input, { apiKey: 'test', request }), { status: 400 })
  }
  await assert.rejects(importProduct({ query }), { status: 503 })
})

const jdSku = 'https://item.jd.com/423478.html'
const jdMobile = 'https://item.m.jd.com/product/423478.html'
const catalogs = ['https://www.jd.com/chanpin/11.html', 'https://www.jd.com/chanpin/12.html']
const mainRow = (price = '45.00', id = '423478', title = heading) => `
  <li class="gl-item" data-sku="${id}">
    <ul><li>同系列规格</li></ul>
    <div class="p-price"><strong class="J_${id}" data-price="${price}"><em></em><i></i></strong></div>
    <div class="p-name p-name-type-2"><a href="//item.jd.com/${id}.html"><em>${title}</em></a></div>
  </li>`

async function checkJdCatalog(input, pages) {
  const opened = []
  const post = async (path, body) => {
    if (path === '/chat/completions') return { choices: [{ message: { content: JSON.stringify({
      name: '罗技 M185', brand: '罗技', model: 'M185', variant, price: 1,
    }) } }] }
    if (path === '/v1/tools/fetch') return { title: '京东-欢迎登录', content: '请先登录', url: jdSku }
    if (body.query.endsWith('site:www.jd.com')) {
      return { results: catalogs.map((url) => ({ url, snippet: '低至 ¥1' })) }
    }
    return { results: [{ title: heading, url: jdSku, snippet: '¥1' }] }
  }
  const result = await importProduct(input, {
    apiKey: 'test',
    request: async (url, options) => Response.json(await post(new URL(url).pathname, JSON.parse(options.body))),
    readPublicHtml: async ({ url }) => {
      opened.push(url)
      if (url === jdMobile) return `<script>window._itemOnly = (${JSON.stringify({ item: { skuId: '423478', skuName: heading } })});</script>`
      return pages[catalogs.indexOf(url)] || null
    },
  })
  assert.ok(opened.includes(jdMobile))
  assert.ok(opened.includes(catalogs[0]))
  return result
}

test('京东详情缺价时，按同一 SKU 从公开目录取价，名称和原链接入口均可补齐', async () => {
  for (const input of [{ query: '罗技 M185 黑色灰边' }, { link: jdSku }]) {
    const result = await checkJdCatalog(input, [mainRow() + mainRow('2.00', '423479'), mainRow()])
    assert.deepEqual([result.link, result.price, result.priceSource, result.platform], [jdSku, 45, 'web', '京东'])
  }
})

test('京东目录的异 SKU、异规格与冲突报价继续保留为待核价', async () => {
  for (const pages of [
    [mainRow('4?', '423478') + mainRow('39.00', '423479')],
    [mainRow('45.00', '423478', heading.replace('黑色灰边', '白色'))],
    [mainRow().replace('J_423478', 'J_423479')],
    [mainRow().replace('/423478.html', '/423479.html')],
    ['<script>' + mainRow() + '</script>'],
    [mainRow(), mainRow('49.00')],
  ]) {
    const result = await checkJdCatalog({ query: '罗技 M185 黑色灰边' }, pages)
    assert.deepEqual([result.link, result.price, result.priceSource], [jdSku, null, null])
  }
})
