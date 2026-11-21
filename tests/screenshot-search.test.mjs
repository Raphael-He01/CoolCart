import assert from 'node:assert/strict'
import test from 'node:test'
import { importScreenshot } from '../src/lib/linkedProduct.js'
import { matchesScreenshot, pageImage, publicReferenceUrl, readMobileJdProduct, readReferenceOffers } from '../src/lib/screenshotSources.js'

const visual = { name: '林舟 D37 无线鼠标', brand: '林舟', model: 'D37', productCount: 1, variant: '',
  platform: '天猫', category: '数码', price: 58, currency: 'CNY', priceKind: 'unit', priceEvidence: '58 元' }
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQD3A0FDAAAAAElFTkSuQmCC'
const shop = 'https://detail.tmall.com/item.htm?id=180001'
const picture = 'https://img.alicdn.com/bao/uploaded/d37.jpg'
const media = 'https://watchmono.com/e/test-mouse'
const archive = 'https://digi.ithome.com/archiver/1/001/023.htm'
const mobile = 'https://m.ithome.com/html/1001023.htm'
const direct = '<a href="' + shop + '">林舟 D37 无线鼠标</a>'
const guide = '<a href="https://m.tb.cn/example"><span class="card-name">林舟 D37 无线鼠标</span><span class="mall-data">天猫</span><img data-no-referrer="' + picture + '"></a>'
const jd = { url: 'https://item.jd.com/10023.html', itemId: '10023', platform: '京东' }
const asset = 'jfs/t1/3/mouse.jpg'
const first = 'https://m.360buyimg.com/mobilecms/s750x750_' + asset + '!q80.dpg'

function jdHtml({ code = '10023', name = visual.name, path = asset, src = first } = {}) {
  return '<script>window._itemOnly = (' + JSON.stringify({ item: { skuId: code, skuName: name, image: [path] } })
    + ');</script><img src="' + src + '" id="firstImg">'
}

async function importWith(fields, resultRows, pages, fetched = null) {
  const post = async (path, body) => {
    if (path.includes('search')) return { results: resultRows }
    if (path.includes('fetch')) return fetched
    return { choices: [{ message: { content: JSON.stringify(Array.isArray(body.messages[1].content) ? fields : {}) } }] }
  }
  return importScreenshot(image, post, async ({ url }) => pages[url] || '')
}

test('无规格时按连续品牌型号匹配；拒绝同系列其他代、接口数字、配件与不同版本', () => {
  for (const title of ['林舟 D370 鼠标', '林舟 D38（D37）鼠标', '林舟 D38 重量37克', '林舟 D37 Pro 鼠标',
    '林舟 D37S 鼠标', '林舟 D37 鼠标脚贴', '林舟 D37/ D38 鼠标']) assert.equal(matchesScreenshot(visual, title), false, title)
  const earbuds = { ...visual, brand: '星河', model: '鸣弦3', name: '星河鸣弦3 耳机' }
  assert.equal(matchesScreenshot(earbuds, '星河 鸣弦 III 入耳式耳机'), true)
  assert.equal(matchesScreenshot(earbuds, '星河 鸣弦2 耳机 3.5mm 接口'), false)
  assert.equal(matchesScreenshot(visual, '林舟 D-37 无线鼠标'), true)
})

test('相同商品的独立来源可核对天猫直链与图片，短链本身不能用作购买链接', async () => {
  assert.equal(publicReferenceUrl(archive), mobile)
  assert.equal(publicReferenceUrl('https://watchmono.com.example/e/test'), '')
  const guides = readReferenceOffers(mobile, guide, visual)
  assert.equal(guides[0].link, '')
  const rows = [{ url: archive }, { url: media }]
  const found = await importWith(visual, rows, { [mobile]: guide, [media]: direct })
  assert.deepEqual([found.link,found.imageUrl,found.matchSource,found.price,found.priceSource,found.category],
    [shop,picture,'reference',58,'screenshot','数码'])
  const imageOnly = await importWith(visual, rows, { [mobile]: guide })
  assert.deepEqual([imageOnly.link,imageOnly.imageUrl,imageOnly.matchSource], ['',picture,'reference'])
  const conflict = await importWith(visual, rows, { [mobile]: guide, [media]: direct + direct.replace('180001', '180002') })
  assert.equal(conflict.link, '')
  const fake = '<a href="data:text/html,' + shop + '">林舟 D37</a>'
  assert.deepEqual(readReferenceOffers(media, fake, visual), [])
})

test('主图绑定当前 SKU；其他规格图、页内推荐图和不一致的图片不采用', () => {
  assert.equal(readMobileJdProduct(jdHtml(), jd, visual).imageUrl, first)
  assert.equal(readMobileJdProduct(jdHtml({ code: '10024' }), jd, visual), null)
  assert.equal(readMobileJdProduct(jdHtml({ name: '林舟 D38 鼠标' }), jd, visual), null)
  assert.equal(readMobileJdProduct(jdHtml({ path: 'jfs/t1/3/other.jpg' }), jd, visual).imageUrl, '')
  assert.equal(pageImage('![主图](' + picture + ')\n## 相关推荐\n![林舟 D37 无线鼠标](' + picture + ')', visual, '天猫'), '')
  assert.equal(pageImage('![林舟 D37 鼠标脚贴](' + picture + ')', visual, '天猫'), '')
  assert.equal(pageImage('![林舟 D37 鼠标](' + picture + ')', visual, '天猫'), picture)
})

test('无平台图可确定唯一商城；其他商城同款只给备选，同系列和多卖家保持未定', async () => {
  const rows = [{ title: visual.name, url: jd.url },
    { title: visual.name, url: 'https://item.m.jd.com/product/10023.html' }, { title: '林舟 D38 (D37) 鼠标', url: 'https://item.jd.com/10028.html' }]
  const files = { 'https://item.m.jd.com/product/10023.html': jdHtml() }
  const unknown = await importWith({ ...visual, platform: null, price: null }, rows, files)
  assert.deepEqual([unknown.platform,unknown.link,unknown.imageUrl,unknown.price,unknown.matchSource], ['京东',jd.url,first,null,'merchant'])
  const other = await importWith(visual, rows, files)
  assert.deepEqual([other.platform,other.link,other.price,Boolean(other.alternative?.link),other.alternative?.price], ['天猫','',58,true,null])
  const ambiguous = await importWith({ ...visual, platform: null }, [...rows, { ...rows[0], url: 'https://item.jd.com/10024.html' }], files)
  assert.equal(ambiguous.link, '')
  const seen = await importWith({ ...visual, platform: null, visibleUrl: jd.url }, [], files)
  assert.equal(seen.link, jd.url)
})
