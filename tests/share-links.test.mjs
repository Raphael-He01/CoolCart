import assert from 'node:assert/strict'
import test from 'node:test'
import { isJdNavigationPage, readProductLink, readProductLinks } from '../src/lib/productImport.js'
import { findDuplicateProducts } from '../src/lib/duplicateProducts.js'

const mouse = 'https://item.jd.com/product/pWrkPb75a1pc2I1p5op2pw.html'
const pen = 'https://item.jd.com/product/H8PQOSYRfJLiKkhCt4fcZw.html'

test('京东购物车、搜索、登录和验证入口不能保存为商品链接', () => {
  for (const url of [
    'https://cart.jd.com/cart_index', 'https://search.jd.com/Search?keyword=mouse',
    'https://passport.jd.com/new/login.aspx', 'https://plogin.m.jd.com/login/login',
    'https://cfe.m.jd.com/privatedomain/risk_handler/03101900/',
  ]) {
    assert.equal(isJdNavigationPage(url), true)
    assert.equal(readProductLink(url), null)
  }
  for (const url of [mouse, 'https://item.m.jd.com/product/423478.html', 'https://detail.tmall.com/item.htm?id=100', 'https://example.com/product/42']) {
    assert.equal(isJdNavigationPage(url), false)
  }
})

test('京东公开商品页面标识保留大小写和规格，清除跟踪参数', () => {
  const product = readProductLink(mouse + '?utm_source=share&skuId=423478#details')
  assert.deepEqual(product, {
    url: mouse + '?skuId=423478', platform: '京东', itemId: null,
    skuId: '423478', pageToken: 'pWrkPb75a1pc2I1p5op2pw',
  })
  assert.equal(readProductLink(mouse.replace('item.jd.com', 'u.example.org')), null)
  assert.equal(readProductLink(mouse.replace('/product/', '/activity/')), null)
})

test('分享文案可含说明链接、中文标点和多个商品；只有一个商品时才直接选中', () => {
  const text = `说明 https://help.jd.com/\n鼠标：【${mouse}?utm_source=share】，再看 ${mouse}。`
  assert.equal(readProductLink(text).url, mouse)
  assert.deepEqual(readProductLinks(text + '\n' + pen).map(p => p.url), [mouse, pen])
  assert.equal(readProductLink(text + '\n' + pen), null)
  assert.equal(readProductLinks('https://item.m.jd.com/product/423478.html https://item.jd.com/423478.html').length, 1)
})

test('相同京东页面可找回原商品，不同页面分别入库；不同链接形式不能仅凭名称强制合并', () => {
  const original = { name: '耳机', link: mouse }
  assert.equal(findDuplicateProducts(original, [original]).exact, true)
  assert.deepEqual(findDuplicateProducts({ ...original, link: pen }, [original]).items, [])
  const alias = { ...original, link: 'https://item.jd.com/423478.html' }
  assert.deepEqual(findDuplicateProducts(alias, [original]), { exact: false, items: [original] })
})
