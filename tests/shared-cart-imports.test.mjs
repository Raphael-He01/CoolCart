import assert from 'node:assert/strict'
import test from 'node:test'
import { cartImportLabel } from '../src/lib/capturedCartItems.js'
import { cartLookupInput } from '../src/lib/cartProductLinks.js'
import { applyScreenShoppingBatch, applyShareInbox, readShareInbox } from '../src/lib/sharedCartImports.js'
import { loadState, saveState } from '../src/lib/storage.js'

const firstId = '66AFD773-1121-4BAB-ABCD-998877665544'
const nextId = '77AFD773-1121-4BAB-ABCD-998877665544'
const sharedAt = 1795276800000
const mouse = { name: '罗技 M185 鼠标', variant: '黑色灰边', platform: '京东', price: 45 }
const headset = { name: '水月雨 Blessing3 耳机', variant: '银色', platform: '京东', price: null }
const secondHeadset = { ...headset, price: 1999.63 }

function batch(id, items, timestamp = sharedAt) {
  return { id, sharedAt: timestamp, items: items.map((item, index) => ({ ...item, id: id + '-' + index })) }
}

function make(draft, id, settings, now) {
  return { ...draft, id, stage: 'cooling', createdAt: now, cooldownEndsAt: now + 10000 }
}

test('按分享时间启动冷静期，已出现的商品不重复加入，补到明确单价可晋级', () => {
  const queue = readShareInbox([
    batch(firstId, [mouse, headset]),
    batch(nextId, [mouse, secondHeadset], sharedAt + 2000),
  ])
  const { cart, summary } = applyShareInbox({ items: [], settings: {} }, queue, sharedAt + 60000, make)
  assert.deepEqual(summary, { added: 2, review: 0, skipped: 2 })
  const savedMouse = cart.items.find((item) => item.name === mouse.name)
  assert.equal(savedMouse.cooldownEndsAt, sharedAt + 10000)
  assert.equal(cartImportLabel(savedMouse), '京东 · 截屏分享')
  assert.deepEqual(cartLookupInput(savedMouse), { name: mouse.name, variant: mouse.variant, platform: '京东' })
  const savedHeadset = cart.items.find((item) => item.name === headset.name)
  assert.equal(savedHeadset.id, firstId + '-1')
  assert.equal(savedHeadset.stage, 'cooling')
  assert.equal(savedHeadset.price, 1999.63)
  assert.deepEqual(cart.shareReceipts, [firstId, nextId])
})

test('收件回执与正常商品一起保存，演示不消费，去掉商品后重复收到已处理的批次也不恢复', () => {
  const initialStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  try {
    const one = [batch(firstId, [mouse])]
    const read = applyShareInbox(loadState({ demo: false }), one, sharedAt, make).cart
    assert.equal(saveState(read, { demo: false }), true)
    const demo = loadState({ demo: true })
    assert.equal(demo.shareReceipts, undefined)
    assert.equal(saveState({ ...demo, shareReceipts: ['isolated'] }, { demo: true }), true)
    const emptied = { ...loadState({ demo: false }), items: [] }
    assert.equal(saveState(emptied, { demo: false }), true)
    const fromDisk = loadState({ demo: false })
    assert.deepEqual(fromDisk.shareReceipts, [firstId])
    const replay = applyShareInbox(fromDisk, one, sharedAt + 10, make)
    assert.strictEqual(replay.cart, fromDisk)
    assert.deepEqual(replay.cart.items, [])
    const fresh = applyShareInbox(fromDisk, [batch(nextId, [mouse])], sharedAt + 10, make)
    assert.deepEqual(fresh.cart.shareReceipts, [nextId])
    assert.equal(fresh.cart.items.length, 1)
  } finally {
    if (initialStorage) Object.defineProperty(globalThis, 'localStorage', initialStorage)
    else delete globalThis.localStorage
  }
})

test('屏幕共享回执随购物车保存，重载后重复返回不恢复已删除条目，各模式独立', () => {
  const initialStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  } })
  try {
    const completed = batch(firstId, [mouse])
    const { cart, summary } = applyScreenShoppingBatch(loadState({ demo: false }), completed, sharedAt, make)
    assert.deepEqual(summary, { added: 1, review: 0, skipped: 0, count: 1 })
    assert.equal(cartImportLabel(cart.items[0]), '京东 · 屏幕共享识别')
    assert.equal(saveState(cart, { demo: false }), true)
    const reloaded = loadState({ demo: false })
    assert.equal(reloaded.screenShoppingReceipt, firstId)
    assert.equal(reloaded.items.length, 1)
    assert.equal(saveState({ ...reloaded, items: [] }, { demo: false }), true)
    const emptied = loadState({ demo: false })
    const replay = applyScreenShoppingBatch(emptied, completed, sharedAt + 10, make)
    assert.equal(replay.summary, null)
    assert.strictEqual(replay.cart, emptied)
    assert.deepEqual(replay.cart.items, [])
    const freshDemo = loadState({ demo: true })
    assert.equal(freshDemo.screenShoppingReceipt, undefined)
    assert.equal(saveState({ ...freshDemo, screenShoppingReceipt: nextId }, { demo: true }), true)
    assert.equal(loadState({ demo: true }).screenShoppingReceipt, nextId)
    assert.equal(loadState({ demo: false }).screenShoppingReceipt, firstId)
  } finally {
    if (initialStorage) Object.defineProperty(globalThis, 'localStorage', initialStorage)
    else delete globalThis.localStorage
  }
})
