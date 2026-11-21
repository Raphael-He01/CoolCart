import assert from 'node:assert/strict'
import test from 'node:test'
import { importScreenshot } from '../src/lib/linkedProduct.js'
import { matchesScreenshot, publicReferenceUrl } from '../src/lib/screenshotSources.js'

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQD3A0FDAAAAAElFTkSuQmCC'
const product = { name: '青芒 Wave3 有线耳机', brand: '青芒', model: 'Wave3', variant: '黑色', productCount: 1,
  platform: '京东', priceKind: 'offer', price: 1999.63, currency: 'CNY', priceEvidence: '到手价 ¥1,999.63' }
const title = product.name + ' 黑色'
const url = 'https://item.m.jd.com/product/32100876.html'
async function check(fields, { found = true, publicPrice = null } = {}) {
  const queries = []
  const post = async (path, body) => {
    if (path.includes('search')) {
      queries.push(body.query)
      return { results: found && body.query.endsWith('京东') ? [{ title, url }] : [] }
    }
    if (path.includes('fetch')) return { title, url, content: title + '\n售价：¥2190' }
    const reply = Array.isArray(body.messages[1].content) ? fields : {
      name: product.name, variant: '黑色', price: publicPrice, evidence: '售价：¥2190',
    }
    return { choices: [{ message: { content: JSON.stringify(reply) } }] }
  }
  return { result: await importScreenshot(image, post), queries }
}

test('移动京东同款可补链接；使用实际截图到手价，并与公开普通售价分开', async () => {
  const { result, queries } = await check(product, { publicPrice: 2190 })
  assert.ok(queries.some((q) => q.includes('site:item.jd.com')))
  assert.ok(queries.some((q) => q.endsWith('京东')))
  assert.deepEqual([result.link, result.price, result.priceSource], [url, 1999.63, 'screenshot_offer'])
  for (const priceEvidence of ['实付 ¥1999.63', '合计 ¥1999.63', '预计到手价 ¥1999.63', '省 ¥1999.63',
    '国家补贴 ¥1999.63', '到手价 ¥1999.63 至 ¥2299', '到手价 ¥1999.00']) {
    const { result: rejected } = await check({ ...product, priceEvidence }, { found: false })
    assert.deepEqual([rejected.price, rejected.priceSource, rejected.link], [null, null, ''], priceEvidence)
  }
})

test('无商城徽标的裸 ¥ 仅在同款中国商城主商品已核实后作截图价；外币及多件列表继续拒绝', async () => {
  const visual = { ...product, platform: null, priceKind: 'unit', price: 45, priceEvidence: '¥45.00' }
  const { result } = await check(visual)
  assert.deepEqual([result.link,result.price,result.priceSource], [url,45,'screenshot'])
  for (const [fields, options] of [[visual, { found: false }], [{ ...visual, currency: 'JPY' }, {}], [{ ...visual, price: null }, {}]]) {
    const { result: rejected } = await check(fields, options)
    assert.equal(rejected.price, null)
  }
  assert.equal((await check({ ...visual, productCount: 2 })).result, null)
})

test('明确京东目录支持品牌、排行及商品分类；同名 DUSK、旧代和组合装不得匹配', () => {
  for (const path of ['brand/652abc.html', 'phb/key_652abc.html', 'chanpin/12345.html']) {
    assert.equal(publicReferenceUrl('https://www.jd.com/' + path + '#1'), 'https://www.jd.com/' + path)
  }
  for (const name of ['青芒 Wave2 耳机 黑色','青芒 Wave3 DUSK 黑色','青芒 Wave3+解码器 黑色']) {
    assert.equal(matchesScreenshot(product, name), false)
  }
})
