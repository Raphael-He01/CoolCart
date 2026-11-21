import assert from 'node:assert/strict'
import test from 'node:test'
import { budgetPreview, formatCents, ledgerDisplayTime, spendingTotals, yuanToCents } from '../src/lib/ledger.js'

const midnight = Date.parse('2026-12-01T00:00:00+08:00')
const purchase = (paidCents, paidAt = midnight) => ({ stage: 'purchased', source: 'self_reported', paidCents, paidAt })

test('账本显示只在北京日期或已到达的付款时刻变化，支持设备时间回拨', () => {
  const entries = [purchase(1, midnight + 10), purchase(2, midnight - 1)]
  assert.equal(ledgerDisplayTime(entries, midnight - 1), midnight - 1)
  assert.equal(ledgerDisplayTime(entries, midnight), midnight)
  assert.equal(ledgerDisplayTime(entries, midnight + 9), midnight)
  assert.equal(ledgerDisplayTime(entries, midnight + 60_000), midnight + 10)
  assert.equal(ledgerDisplayTime(entries, midnight - 2), midnight - 86_400_000)
})

test('超范围旧预算不显示默认预算；未设置预算继续使用默认值', () => {
  const items = [purchase(11)]
  const current = budgetPreview(items, { price: 1.09 }, { monthlyBudget: 1e14 }, midnight)
  assert.equal(current.budgetCents, null)
  assert.equal(current.excessCents, null)
  assert.equal(current.projectedCents, 120)
  assert.equal(budgetPreview(items, { price: 1.09 }, {}, midnight).budgetCents, 200000)
})

test('安全整数分的明细和金额不会丢失末位', () => {
  assert.equal(yuanToCents(90_071_992_547_409.9), 9_007_199_254_740_990)
  assert.equal(yuanToCents(Number('75000000000000.01'), '75000000000000.01'), null)
  assert.equal(yuanToCents(75, '007.5e1'), 7500)
  assert.equal(formatCents(Number.MAX_SAFE_INTEGER), '¥90,071,992,547,409.91')
  assert.deepEqual([0, 1, 9, 10, 99, 100, 110].map(formatCents), ['¥0', '¥0.01', '¥0.09', '¥0.1', '¥0.99', '¥1', '¥1.1'])
})

test('单项受支持、合计或买后预计超出整分范围时，独立保留可计算的指标', () => {
  const max = Number.MAX_SAFE_INTEGER
  const items = [purchase(max, midnight - 1), purchase(1)]
  assert.deepEqual(spendingTotals(items, midnight), { weekCents: null, monthCents: 1 })
  const projection = budgetPreview([purchase(max)], { price: 0.01 }, {}, midnight)
  assert.equal(projection.monthCents, max)
  assert.equal(projection.projectedCents, null)
  assert.equal(projection.excessCents, null)
})
