import assert from 'node:assert/strict'
import test from 'node:test'
import { findDuplicateProducts } from '../src/lib/duplicateProducts.js'
import { readProductLink } from '../src/lib/productImport.js'

const taobao = 'https://item.taobao.com/item.htm?id=123'
const jd = 'https://item.jd.com/456.html'
const sku = '90071992547409931'

function product(link, variant = '', name = '耳机') {
  return { link, variant, name }
}

test('包含天猫徽标的无链接截图能提示已有的同名同规格天猫商品', () => {
  const previous = product('https://detail.tmall.com/item.htm?id=957', '标准版')
  const screenshot = { ...product('', '标准版'), platform: '天猫' }
  assert.deepEqual(findDuplicateProducts(screenshot, [previous]), { exact: false, items: [previous] })
})

test('京东、淘宝保留显式规格编号，去掉跟踪参数；短链不给出商品或规格编号', () => {
  for (const [base, sep] of [[jd, '?'], [taobao, '&']]) {
    const link = readProductLink(`分享 ${base}${sep}spm=ad&skuId=${sku}#detail`)
    assert.equal(link.url, `${base}${sep}skuId=${sku}`)
    assert.equal(link.skuId, sku)
  }
  const short = readProductLink('https://u.jd.com/123.html?skuId=789')
  assert.equal(short.itemId, null)
  assert.equal(short.skuId, null)
})

test('相同编号可找回只填过一次文字规格的商品，不同编号保留为独立商品', () => {
  for (const [base, sep] of [[jd, '?'], [taobao, '&']]) {
    const url = `${base}${sep}skuId=${sku}`
    const old = product(url, '黑色')
    assert.deepEqual(findDuplicateProducts(product(url), [old]), { exact: true, items: [old] })
    assert.deepEqual(findDuplicateProducts(product(url, '白色'), [old]), { exact: false, items: [old] })
    assert.deepEqual(findDuplicateProducts(product(`${base}${sep}skuId=22`, '黑色'), [old]).items, [])
    assert.deepEqual(findDuplicateProducts(product(base, '黑色'), [old]), { exact: false, items: [old] })
  }
})

test('相同商品缺规格时可选任一候选，精确编号只列出对应记录', () => {
  const a = product(taobao + '&skuId=101')
  const b = product(taobao + '&skuId=202')
  const records = [a, b, product('https://m.tb.cn/share')]
  assert.deepEqual(findDuplicateProducts(product(taobao), records), { exact: false, items: records })
  assert.deepEqual(findDuplicateProducts(a, records), { exact: true, items: [a] })
  assert.deepEqual(findDuplicateProducts(product('https://item.taobao.com/item.htm?id=124'), [a]).items, [])
})

test('短链及同名手填记录只建议人工选择，平台和已知规格冲突时分开', () => {
  const original = product(taobao, '黑色')
  const short = product('https://e.tb.cn/abc', '黑色')
  assert.deepEqual(findDuplicateProducts(short, [original]), { exact: false, items: [original] })
  assert.deepEqual(findDuplicateProducts(product('https://m.tb.cn/xyz'), [short]), { exact: false, items: [short] })
  assert.deepEqual(findDuplicateProducts(product('', '黑色'), [original]), { exact: false, items: [original] })
  assert.deepEqual(findDuplicateProducts(product('https://u.jd.com/abc', '黑色'), [original]).items, [])
  assert.deepEqual(findDuplicateProducts(product('https://e.tb.cn/abc', '白色'), [original]).items, [])
})
