import assert from 'node:assert/strict'
import test from 'node:test'
import { applyProductImport, confirmDraftLink, editProductDraft, EMPTY_DRAFT } from '../src/lib/importDraft.js'

const link = 'https://item.taobao.com/item.htm?id=60001&skuId=201'
const mobile = 'https://h5.m.taobao.com/awp/core/item.htm?skuId=201&id=60001&spm=share'
const otherSku = 'https://item.taobao.com/item.htm?id=60001&skuId=202'
const quote = { name: '便携耳机', variant: '深蓝 256G', platform: '淘宝', link, price: 399.9, priceSource: 'web' }

test('无链接的截图可先补链；改成另一规格时会重新核价', () => {
  const screenshot = applyProductImport(EMPTY_DRAFT, { ...quote, link: '', priceSource: 'screenshot' })
  const completed = confirmDraftLink(editProductDraft(screenshot, { link }))
  assert.equal(completed.priceSource, 'screenshot')
  assert.equal(completed.price, '399.9')
  assert.equal(editProductDraft(completed, { link: mobile }).price, '399.9')
  assert.equal(editProductDraft(completed, { link: otherSku }).price, '')
})

test('规格、商品或 SKU 改变后必须重填单价，等价链接和空格保留报价', () => {
  for (const priceSource of ['web', 'screenshot_offer']) {
    const draft = applyProductImport(EMPTY_DRAFT, { ...quote, priceSource })
    assert.equal(editProductDraft(draft, { link: mobile }).priceSource, priceSource)
    assert.equal(editProductDraft(draft, { variant: ' 深蓝   256G ' }).price, '399.9')
    for (const update of [{ link: otherSku }, { link: '' }, { variant: '白色 512G' }]) {
      const changed = editProductDraft(draft, update)
      assert.equal(changed.price, '')
      assert.equal(changed.priceSource, '')
      assert.equal(changed.needsNewPrice, true)
      const confirmed = editProductDraft(changed, { price: '409.80', priceSource: 'manual' })
      assert.equal(confirmed.price, '409.80')
      assert.equal(confirmed.priceSource, 'manual')
      assert.equal(confirmed.needsNewPrice, false)
    }
  }
})

test('同一商品查价失败后保留人工核对的信息，新商品使用自己的空草稿', () => {
  let draft = applyProductImport(EMPTY_DRAFT, { link, platform: '淘宝' })
  draft = editProductDraft(draft, { name: '我填的商品名', variant: '白色', category: '数码' })
  draft = editProductDraft(draft, { price: '368.80', priceSource: 'manual' })
  const retry = applyProductImport(draft, { link: mobile, platform: '淘宝' })
  for (const key of ['name', 'variant', 'category', 'price', 'priceSource']) assert.equal(retry[key], draft[key])
  const other = applyProductImport(retry, { link: otherSku, platform: '淘宝' })
  for (const key of ['name', 'variant', 'category', 'price', 'priceSource']) assert.equal(other[key], '')
})

test('重试报价不会冒充手填价或沿用另一规格的证据', () => {
  const draft = applyProductImport(EMPTY_DRAFT, quote)
  const edited = editProductDraft(draft, { price: '388.00', priceSource: 'manual' })
  assert.equal(applyProductImport(edited, quote).priceSource, 'manual')
  assert.equal(applyProductImport(edited, quote).price, '388.00')
  const unknown = applyProductImport(draft, { ...quote, variant: '' })
  assert.equal(unknown.price, '')
  assert.equal(unknown.variant, draft.variant)
  const missing = applyProductImport(draft, { ...quote, price: null, priceSource: null })
  assert.equal(missing.price, '')
  assert.equal(missing.priceSource, '')
})

test('同款重查无公开价时保留截图价格，换规格需要重新核价', () => {
  const draft = applyProductImport(EMPTY_DRAFT, { ...quote, priceSource: 'screenshot_offer' })
  const noPrice = { ...quote, price: null, priceSource: null }
  const retry = applyProductImport(draft, { ...noPrice, link: mobile })
  assert.deepEqual([retry.price, retry.priceSource], ['399.9', 'screenshot_offer'])
  assert.equal(applyProductImport(draft, { ...noPrice, variant: '白色' }).price, '')
  assert.equal(applyProductImport(draft, { ...noPrice, link: otherSku }).price, '')
})

test('商品主图、商品资料和来源随同款保存，改规格或购买链接后清除', () => {
  const imageUrl = 'https://img.alicdn.com/bao/uploaded/i4/123/earphones.jpg'
  const info = { ...quote, imageUrl, details: '可换插头', matchSource: 'reference', price: null, priceSource: null }
  const draft = applyProductImport(EMPTY_DRAFT, info)
  for (const key of ['imageUrl', 'details', 'matchSource']) assert.equal(draft[key], info[key])
  const retry = applyProductImport(draft, { link: mobile, platform: '淘宝' })
  assert.equal(retry.imageUrl, imageUrl)
  assert.equal(editProductDraft(retry, { price: '99', priceSource: 'manual' }).imageUrl, imageUrl)
  for (const fields of [{ link: otherSku }, { variant: '白色' }]) {
    const changed = editProductDraft(retry, fields)
    for (const key of ['imageUrl', 'details', 'matchSource']) assert.equal(changed[key], '')
  }
  assert.equal(applyProductImport(draft, { ...quote, link: otherSku }).imageUrl, '')
  for (const url of ['https://img.alicdn.com.bad.example/item.jpg','http://img.alicdn.com/item.jpg','https://img10.360buyimg.com/item.jpg','data:image/webp;base64,AA']) {
    assert.equal(applyProductImport(EMPTY_DRAFT, { ...info, imageUrl: url }).imageUrl, '')
  }
})

test('其他平台同款由用户选择，不会覆盖截图或继承原商城价格', () => {
  const alternative = { name: quote.name, link: 'https://item.jd.com/10011.html', platform: '京东', price: null }
  const draft = applyProductImport(EMPTY_DRAFT, { ...quote, link: '', priceSource: 'screenshot', alternative })
  assert.equal(draft.link, '')
  assert.equal(draft.alternative.link, alternative.link)
  assert.equal(draft.priceSource, 'screenshot')
  assert.equal(editProductDraft(draft, { name: '另一件' }).alternative, undefined)
  const switched = applyProductImport(draft, draft.alternative)
  assert.equal(switched.platform, '京东')
  assert.equal(switched.price, '')
  assert.equal(switched.alternative, undefined)
})

test('同款图片已识别、购买页待确认时，独立展示图片来源', () => {
  const imageUrl = 'https://img.alicdn.com/products/photo.webp'
  const draft = applyProductImport(EMPTY_DRAFT, { ...quote, link: '', imageUrl, matchSource: 'reference' })
  assert.equal(draft.link, '')
  assert.equal(draft.imageUrl, imageUrl)
  assert.equal(applyProductImport(EMPTY_DRAFT, { ...quote, link: '', imageUrl }).imageUrl, '')
})

test('首次补到已填同款链接时保留手填价与品类，其他商品、规格或平台不继承', () => {
  const manual = { ...EMPTY_DRAFT, name: quote.name, variant: quote.variant, platform: '淘宝',
    price: '399.90', priceSource: 'manual', category: '数码' }
  const lookup = { ...quote, price: null, priceSource: null, category: '生活' }
  const same = applyProductImport(manual, lookup, { forDraft: true })
  assert.deepEqual([same.price, same.priceSource, same.category, same.link], ['399.90', 'manual', '数码', link])
  const nameWithVariant = applyProductImport(manual, { ...lookup, name: quote.name + ' ' + quote.variant }, { forDraft: true })
  assert.deepEqual([nameWithVariant.name, nameWithVariant.price, nameWithVariant.category], [quote.name, '399.90', '数码'])
  for (const offer of [
    { ...lookup, variant: '白色' }, { ...lookup, variant: '' }, { ...lookup, name: '别的耳机' },
    { ...lookup, link: 'https://item.jd.com/123456.html' },
  ]) assert.equal(applyProductImport(manual, offer, { forDraft: true }).price, '')
  assert.equal(applyProductImport(manual, lookup).price, '')
})

test('改为另一商品清除旧购买依据，显式纠字保留同一商品数据', () => {
  const draft = applyProductImport(EMPTY_DRAFT, { ...quote, matchSource: 'merchant', details: '旧商品',
    imageUrl: 'https://img.alicdn.com/item.jpg', cartImport: { method: 'screenshot', platform: '淘宝' }, cartReviewId: 'review' })
  const renamed = editProductDraft(draft, { name: '无线键盘' })
  for (const key of ['variant', 'link', 'imageUrl', 'details', 'price', 'matchSource', 'priceSource']) {
    assert.equal(renamed[key], '')
  }
  assert.equal(renamed.cartReviewId, undefined)
  assert.equal(renamed.needsNewPrice, true)
  const corrected = editProductDraft(draft, { name: '便携式耳机' }, { correctTitle: true })
  for (const key of ['variant', 'link', 'imageUrl', 'details', 'price', 'matchSource', 'priceSource', 'cartReviewId']) {
    assert.equal(corrected[key], draft[key])
  }
  assert.equal(corrected.captureOriginalName, quote.name)
})
