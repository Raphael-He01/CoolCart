import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { itemMealEstimate } from '../../src/lib/convert.js'
import { beijingPaymentTime, budgetPreview, confirmPurchase, spendingTotals } from '../../src/lib/ledger.js'
import { removeCartItem, updateCartItem } from '../../src/lib/cartItems.js'
import { evaluateLock } from '../../src/lib/rules.js'
import { loadState, saveState } from '../../src/lib/storage.js'

const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'))
const settings = { lockRules: cases.ruleSettings, monthlyBudget: cases.budgetYuan }
const now = Date.parse(cases.now)
const demo = { demo: true }
const oldPayment = { ...cases.oldPayment, paidAt: Date.parse(cases.oldPayment.paidAt) }
const payment = { ...cases.repeatConfirmation, paidAt: Date.parse(cases.repeatConfirmation.paidAt) }

test('类别或严格大于阈值命中，返回每条命中理由', () => {
  const results = cases.rules.map((item) => evaluateLock(item, settings))
  assert.deepEqual(results.map(({ locked }) => locked), cases.rules.map(({ expected }) => expected))
  assert.deepEqual(results.map(({ reasons }) => reasons), [
    ['品类：数码'], [], ['单价高于 ¥100'], ['品类：数码', '单价高于 ¥100'],
    ['品类：数码', '单价高于 ¥100'],
  ])
  assert.equal(evaluateLock({ price: 100.01 }, settings).locked, true)
  assert.equal(evaluateLock({ price: 100 }, settings).locked, false)
  assert.equal(evaluateLock({ price: null }, settings).locked, false)
  assert.deepEqual(evaluateLock({ category: '数码', price: 399 }, {
    lockRules: { ...cases.ruleSettings, all: true },
  }).reasons, ['全锁已开启', '品类：数码', '单价高于 ¥100'])
  assert.equal(evaluateLock({}, {}).locked, true)
})

test('价格规则关闭、阈值为零、价格未知分别处理', () => {
  const lockRules = { all: false, categories: [], thresholdYuan: null }
  assert.equal(evaluateLock({ price: 399 }, { lockRules }).locked, false)
  const zero = { lockRules: { ...lockRules, thresholdYuan: 0 } }
  assert.equal(evaluateLock({ price: 0.01 }, zero).locked, true)
  assert.equal(evaluateLock({ price: 0 }, zero).locked, false)
  assert.equal(evaluateLock({ price: null }, zero).locked, false)
})

test('品类门槛要求品类与价格同时命中，独立规则仍可另外命中', () => {
  const lockRules = cases.combinedRuleSettings
  const results = cases.combinedRules.map((item) => evaluateLock(item, { lockRules }))
  assert.deepEqual(results.map(({ locked }) => locked), cases.combinedRules.map(({ expected }) => expected))
  assert.deepEqual(results[2].reasons, ['品类：数码，且单价高于 ¥80'])
  const independent = { lockRules: { ...lockRules, thresholdYuan: 100 } }
  assert.deepEqual(evaluateLock({ category: '生活', price: 200 }, independent).reasons, ['单价高于 ¥100'])
  assert.deepEqual(evaluateLock({ category: '数码', price: 200 }, independent).reasons, [
    '品类：数码，且单价高于 ¥80', '单价高于 ¥100',
  ])
  assert.equal(evaluateLock({ category: '数码', price: 0 }, {
    lockRules: { ...lockRules, categoryThresholdYuan: 0 },
  }).locked, false)
})

test('标价只预览；有效的自报实付更新待确认商品，重复确认保持原值', () => {
  const pending = { id: 'headphones', stage: 'pending', price: payment.price, priceSource: 'manual' }
  const before = [oldPayment, pending]
  assert.deepEqual(spendingTotals(before, now, demo), { weekCents: 0, monthCents: 78000 })
  assert.deepEqual(budgetPreview(before, pending, settings, now, demo), {
    monthCents: 78000,
    candidateCents: 39900,
    budgetCents: 100000,
    projectedCents: cases.expected.previewBeforePaymentYuan * 100,
    excessCents: cases.expected.excessPreviewYuan * 100,
  })
  assert.equal(pending.stage, 'pending')
  const purchased = confirmPurchase(pending, payment)
  assert.equal(purchased.stage, 'purchased')
  assert.equal(purchased.paidCents, 36900)
  assert.equal(purchased.price, 399)
  assert.equal(purchased.priceSource, 'manual')
  assert.equal(confirmPurchase(purchased, { ...payment, paidAt: now, paidCents: 1 }), purchased)
  const { weekCents, monthCents } = cases.expected
  assert.deepEqual(spendingTotals([oldPayment, purchased], now, demo), { weekCents, monthCents })
  const unknown = budgetPreview(before, { price: null }, settings, now, demo)
  assert.equal(unknown.candidateCents, null)
  assert.equal(unknown.excessCents, null)
})

test('同一笔候选商品重复预览，按分区分刚好用完和超额，本月实付不变', () => {
  const items = Object.freeze([Object.freeze({ ...oldPayment })])
  for (const [price, projectedCents, excessCents] of [
    [219.99, 99999, 0], [220, 100000, 0], [220.01, 100001, 1],
  ]) {
    for (const stage of ['final', 'approved']) {
      const candidate = Object.freeze({ price, stage })
      const preview = budgetPreview([...items, candidate], candidate, settings, now, demo)
      assert.equal(preview.monthCents, 78000)
      assert.equal(preview.projectedCents, projectedCents)
      assert.equal(preview.excessCents, excessCents)
    }
  }
})

test('旧表单、放行重试和移除确认框都不能改掉最新实付', () => {
  const final = { id: 'earphones', stage: 'final', price: 399 }
  const approved = { ...final, stage: 'approved' }
  const pending = { ...final, stage: 'pending' }
  const [paid] = updateCartItem([pending], pending, (item) => confirmPurchase(item, payment))
  assert.equal(paid.paidCents, 36900)
  assert.equal(paid.price, 399)
  const afterRetry = updateCartItem([paid], final, { stage: 'approved' })
  const afterDoubleSubmit = updateCartItem(afterRetry, pending, { paidCents: 1 })
  assert.deepEqual(removeCartItem(afterDoubleSubmit, approved), [paid])
  assert.deepEqual(removeCartItem([pending], approved), [pending])
  assert.deepEqual(removeCartItem([paid], paid), [paid])
  assert.deepEqual(spendingTotals([oldPayment, ...afterDoubleSubmit], now, demo), {
    weekCents: 36900, monthCents: 114900,
  })
})

test('同一阶段仍可使用最新商品字段更新或移除，其他商品保留', () => {
  const shown = { id: 'earphones', stage: 'approved', price: 399 }
  const latest = { ...shown, link: 'https://example.com/product' }
  const other = { ...shown, id: 'bag' }
  assert.deepEqual(updateCartItem([other, latest], shown, { stage: 'pending' }),
    [other, { ...latest, stage: 'pending' }])
  for (const stage of ['approved', 'abandoned']) {
    const removable = { ...latest, stage }
    assert.deepEqual(removeCartItem([other, removable], removable), [other])
  }
})

test('无效确认无副作用，只有有效的已确认实付按模式入账', () => {
  const pending = { stage: 'pending', price: 399 }
  for (const fields of [
    { ...payment, paidCents: -1 }, { ...payment, paidCents: 1.1 }, { ...payment, paidCents: '10' },
    { ...payment, paidAt: cases.now }, { ...payment, paidAt: Infinity },
    { ...payment, source: 'web' }, {},
  ]) {
    assert.equal(confirmPurchase(pending, fields), pending)
  }
  const approved = { stage: 'approved', price: 399 }
  assert.equal(confirmPurchase(approved, payment), approved)
  const reported = confirmPurchase(pending, { ...payment, source: 'self_reported', paidCents: 1 })
  const free = confirmPurchase(pending, { ...payment, source: 'self_reported', paidCents: 0 })
  assert.equal(free.stage, 'purchased')
  const items = [
    payment, reported, free,
    { ...payment, stage: 'approved' }, { ...payment, stage: 'abandoned' }, { ...payment, stage: 'pending' },
    { stage: 'purchased', price: 399 }, { ...reported, paidAt: now + 1 },
  ]
  assert.deepEqual(spendingTotals(items, now, demo), { weekCents: 36900, monthCents: 36900 })
  assert.deepEqual(spendingTotals(items, now, { demo: false }), { weekCents: 1, monthCents: 1 })
})

test('按北京时间独立划分周与月，两种边界均含起点', () => {
  for (const row of cases.boundaryCases) {
    const paidAt = Date.parse(row.payment)
    assert.deepEqual(spendingTotals([{ ...payment, paidAt }], Date.parse(row.now), demo), {
      weekCents: row.belongsToWeek ? payment.paidCents : 0,
      monthCents: row.belongsToMonth ? payment.paidCents : 0,
    })
  }
  const start = Date.parse('2026-06-01T00:00:00+08:00')
  assert.deepEqual(spendingTotals([
    { ...payment, paidAt: start },
    { ...payment, paidAt: start - 1 },
  ], start, demo), { weekCents: 36900, monthCents: 36900 })
})

test('返程时间按北京时间跨日预填，待确认记录未入账', () => {
  const paymentReturnAt = Date.parse('2026-11-30T16:00:06.123Z')
  const pending = { stage: 'pending', paymentReturnAt }
  assert.equal(beijingPaymentTime(paymentReturnAt), '2026-12-01T00:00:06')
  assert.equal(beijingPaymentTime(undefined), '')
  assert.deepEqual(spendingTotals([pending], paymentReturnAt, demo), { weekCents: 0, monthCents: 0 })
  const purchased = confirmPurchase(pending, { ...payment, paidAt: paymentReturnAt })
  assert.equal(purchased.paidAt, paymentReturnAt)
})

test('零点前后一毫秒逐笔入账，周与月各自重置，演示账独立', () => {
  const transitions = [
    { midnight: '2026-11-23', weekAtStart: 234, monthAtStart: 357 }, // 周一
    { midnight: '2026-12-01', weekAtStart: 357, monthAtStart: 234 }, // 周二，月初
    { midnight: '2027-02-01', weekAtStart: 234, monthAtStart: 234 }, // 周一，月初
  ]
  for (const { midnight, weekAtStart, monthAtStart } of transitions) {
    const start = Date.parse(midnight + 'T00:00:00+08:00')
    const items = [
      { ...payment, source: 'self_reported', paidAt: start - 1, paidCents: 123 },
      { ...payment, source: 'self_reported', paidAt: start, paidCents: 234 },
      { ...payment, source: 'self_reported', paidAt: start + 1, paidCents: 345 },
      { ...payment, source: 'demo', paidAt: start, paidCents: 789 },
    ]
    const normal = { demo: false }
    assert.deepEqual(spendingTotals(items, start - 1, normal), { weekCents: 123, monthCents: 123 })
    assert.deepEqual(spendingTotals(items, start, normal), { weekCents: weekAtStart, monthCents: monthAtStart })
    assert.deepEqual(spendingTotals(items, start + 1, normal), {
      weekCents: weekAtStart + 345, monthCents: monthAtStart + 345,
    })
    assert.equal(budgetPreview(items, { price: 1 }, settings, start, normal).projectedCents, monthAtStart + 100)
    assert.deepEqual(spendingTotals(items, start - 1, demo), { weekCents: 0, monthCents: 0 })
    assert.deepEqual(spendingTotals(items, start, demo), { weekCents: 789, monthCents: 789 })
  }
})

function mockCartStorage(t) {
  const store = new Map()
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    },
  })
  t.after(() => {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
    else delete globalThis.localStorage
  })
  return store
}

test('修改锁定规则和餐费后，旧商品保留答题依据、放弃前的阶段及截止时间', (t) => {
  const store = mockCartStorage(t)
  const normal = { demo: false }
  const original = {
    id: 'headphones', price: 399, stage: 'abandoned', prevStage: 'trial', abandonedAt: now,
    cooldownEndsAt: now - 1000, peeks: 1, penaltyMs: 600000, lockReasons: ['全锁已开启'],
    quizAnswer: { count: 25, mealPrice: 15 }, reasonDraft: '通勤时使用',
  }
  store.set('coolcart.v1', JSON.stringify({ items: [original], settings: { mealPrice: 15 } }))
  const cart = loadState(normal)
  const changed = { ...cart.settings, mealPrice: 30, lockRules: { all: false } }
  assert.equal(saveState({ ...cart, settings: changed }, normal), true)
  const reloaded = loadState(normal)
  assert.deepEqual(reloaded.items, [original])
  assert.deepEqual(itemMealEstimate(reloaded.items[0], reloaded.settings), { mealPrice: 15, meals: 27 })
  const newItem = { price: 399 }
  assert.equal(evaluateLock(newItem, reloaded.settings).locked, false)
  assert.deepEqual(itemMealEstimate(newItem, reloaded.settings), { mealPrice: 30, meals: 13 })
})

test('旧记录与阶段完整保留，演示存储和默认配置互不影响，刷新后账本不重复', (t) => {
  const v1 = {
    items: [
      { id: 'a', stage: 'cooling', cooldownEndsAt: now + 48 },
      { id: 'b', stage: 'abandoned', prevStage: 'trial', abandonedAt: now - 1, cooldownEndsAt: now - 5 },
      { id: 'c', stage: 'approved', price: 399 },
      { id: 'd', stage: 'purchased', price: 399 },
    ],
    settings: { monthlyBudget: 1234, mealPrice: 12 },
  }
  const store = mockCartStorage(t)
  store.set('coolcart.v1', JSON.stringify(v1))
  const normal = { demo: false }
  const migrated = loadState(normal)
  assert.deepEqual(migrated.items, v1.items)
  assert.equal(migrated.settings.monthlyBudget, 1234)
  assert.equal(migrated.settings.mealPrice, 12)
  assert.deepEqual(migrated.settings.lockRules, {
    all: true, categories: [], thresholdYuan: null, categoryThresholdYuan: null,
  })
  assert.equal(spendingTotals(migrated.items, now, normal).monthCents, 0)
  assert.deepEqual(loadState(demo).items, [])
  saveState({ items: [oldPayment, payment], settings }, demo)
  const refreshed = loadState(demo)
  assert.deepEqual(refreshed.settings.lockRules, cases.ruleSettings)
  const combinedSettings = { ...settings, lockRules: cases.combinedRuleSettings }
  saveState({ ...refreshed, settings: combinedSettings }, demo)
  assert.deepEqual(loadState(demo).settings.lockRules, cases.combinedRuleSettings)
  assert.equal(confirmPurchase(refreshed.items[1], { ...payment, paidCents: 0 }), refreshed.items[1])
  assert.equal(spendingTotals(refreshed.items, now, demo).monthCents, cases.expected.monthCents)
  assert.deepEqual(loadState(normal), migrated)
  saveState({ items: [], settings: {} }, demo)
  assert.equal(store.get('coolcart.v1'), JSON.stringify(v1))

  const reported = confirmPurchase({ id: 'e', stage: 'pending', price: 399 }, {
    ...payment, source: 'self_reported',
  })
  saveState({ ...migrated, items: [...migrated.items, reported] }, normal)
  const afterReload = loadState(normal)
  assert.deepEqual(afterReload.items.slice(0, -1), v1.items)
  assert.equal(confirmPurchase(afterReload.items.at(-1), payment), afterReload.items.at(-1))
  assert.deepEqual(spendingTotals(afterReload.items, now, normal), { weekCents: 36900, monthCents: 36900 })
  assert.deepEqual(loadState(demo).items, [])

  // 从组长旧版升级：两个模式原先共用一个键，演示商品可能带两种标记。
  const demoDraft = { ...v1.items[1], id: 'demo-draft', demo: true, reasonDraft: '通勤路上需要降噪。' }
  const mixed = { ...v1, items: [...v1.items, demoDraft, oldPayment] }
  store.delete('coolcart.v1.demo')
  store.set('coolcart.v1', JSON.stringify(mixed))
  const recovered = loadState(demo)
  assert.deepEqual(recovered.items, [demoDraft, oldPayment])
  assert.notEqual(recovered.settings.monthlyBudget, v1.settings.monthlyBudget)
  saveState(recovered, demo)
  assert.deepEqual(loadState(demo), recovered)
  saveState({ ...recovered, items: [] }, demo)
  assert.deepEqual(loadState(demo).items, [])
  assert.deepEqual(JSON.parse(store.get('coolcart.v1')), v1)
  assert.deepEqual(loadState(normal), migrated)
})

test('回退到共享清单版和独立演示清单版后，再升级保留各自的增删与撤销', (t) => {
  const store = mockCartStorage(t)
  const normal = { demo: false }
  const personal = { id: 'normal', stage: 'approved' }
  const removed = { id: 'removed', demo: true }
  const kept = { id: 'demo', demo: true, stage: 'abandoned', prevStage: 'trial', reasonDraft: '通勤' }
  // 已在 2.1 删除 removed，又新增 kept。普通入口也能完成迁移。
  store.set('coolcart.v1', JSON.stringify({ items: [personal, removed], settings: {} }))
  store.set('coolcart.v1.demo', JSON.stringify({ items: [kept], settings }))
  assert.equal(saveState(loadState(normal), normal), true)
  const shared = JSON.parse(store.get('coolcart.v1'))
  assert.deepEqual(shared.items, [personal, kept])
  const restored = { ...kept, stage: 'trial', prevStage: null }
  const added = { id: 'new', demo: true, stage: 'cooling' }
  store.set('coolcart.v1', JSON.stringify({ ...shared, items: [personal, restored, added] }))
  assert.deepEqual(loadState(demo).items, [restored, added])
  assert.deepEqual(loadState(demo).settings.lockRules, settings.lockRules)
  assert.equal(saveState(loadState(demo), demo), true)
  // 回到 2.1 后在独立演示清单清空，再升级不能从旧快照中恢复商品。
  store.set('coolcart.v1.demo', JSON.stringify({ items: [], settings }))
  assert.equal(saveState(loadState(normal), normal), true)
  assert.deepEqual(loadState(demo).items, [])
  assert.deepEqual(JSON.parse(store.get('coolcart.v1')).items, [personal])
})

test('演示快照写入失败时还原共享清单，释放空间后同一操作可重试', (t) => {
  const store = mockCartStorage(t)
  const normal = { demo: false }
  const personal = { id: 'normal', stage: 'approved' }
  const next = { items: [{ id: 'demo', demo: true, stage: 'cooling' }], settings }
  assert.equal(saveState({ items: [personal], settings }, normal), true)
  const before = new Map(store)
  const write = localStorage.setItem
  localStorage.setItem = (key, value) => {
    if (key === 'coolcart.v1.demo') throw new Error('QuotaExceededError')
    write(key, value)
  }
  assert.equal(saveState(next, demo), false)
  assert.deepEqual(store, before)
  localStorage.setItem = write
  assert.equal(saveState(next, demo), true)
  assert.deepEqual(loadState(demo).items, next.items)
  assert.deepEqual(loadState(normal).items, [personal])
})
