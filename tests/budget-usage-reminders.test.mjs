import assert from 'node:assert/strict'
import test from 'node:test'
import { cartReminderRequests, itemForReminder } from '../src/lib/cartReminders.js'
import { peekDuringCooldown } from '../src/lib/cartItems.js'
import { combinedBudgetPreview } from '../src/lib/ledger.js'
import { monthlyUsageReview, reviewMonths } from '../src/lib/monthlyUsageReview.js'
import { updatePurchaseFollowUp } from '../src/lib/purchaseFollowUp.js'

const monthChange = Date.parse('2026-12-01T00:00:00+08:00')
const week = 7 * 24 * 60 * 60 * 1000
const settings = { monthlyBudget: 1000 }

function paid(id, paidAt, paidCents) {
  return { id, stage: 'purchased', source: 'self_reported', paidAt, paidCents }
}

function replyTo(item, useCount, answeredAt, options) {
  const enabled = updatePurchaseFollowUp(item, { type: 'enable' }, item.paidAt, options)
  return updatePurchaseFollowUp(enabled, { type: 'answer', useCount, reason: 'no' }, answeredAt, options)
}

test('预算预演按分合计，只计仍待购买的已核价商品和本月真实支出', () => {
  const a = { id: 'a', price: 199, stage: 'cooling' }
  const b = { id: 'b', price: 99, stage: 'pending' }
  const items = [a, b, { ...a }, paid('previous-month', monthChange - 1, 4400),
    paid('paid', monthChange, 78000), { ...paid('demo', monthChange, 90000), source: 'demo' },
    { ...a, id: 'inactive', stage: 'abandoned' }, { ...a, id: 'unpriced', price: null },
    { ...a, id: 'uncertain', stage: 'cartReview' }]
  const selection = new Set(items.map((item) => item.id))
  const result = combinedBudgetPreview(items, selection, settings, monthChange)
  assert.deepEqual(result, {
    candidates: [{ item: a, cents: 19900 }, { item: b, cents: 9900 }],
    count: 2, monthCents: 78000, candidateCents: 29800, budgetCents: 100000,
    projectedCents: 107800, excessCents: 7800,
  })
  const updated = [a, paid('b', monthChange, 9855), ...items.slice(2)]
  const revised = combinedBudgetPreview(updated, selection, settings, monthChange)
  assert.equal(revised.count, 1)
  assert.equal(revised.projectedCents, 107755)
  assert.equal(combinedBudgetPreview(items, new Set(), settings, monthChange).candidateCents, 0)
  assert.equal(combinedBudgetPreview(items, selection, settings, monthChange, { demo: true }).monthCents, 90000)
})

test('预算预演金额按分舍入，并且安全处理超出精确计算范围的合计', () => {
  const amounts = (prices) => prices.map((price, index) => ({ id: String(index), price, stage: 'approved' }))
  const selection = new Set(['0', '1'])
  assert.equal(combinedBudgetPreview(amounts([0.1, 0.2]), selection, settings, monthChange).candidateCents, 30)
  const veryLarge = combinedBudgetPreview(amounts([60_000_000_000_000, 60_000_000_000_000]), selection, settings, monthChange)
  assert.equal(veryLarge.count, 2)
  assert.equal(veryLarge.candidateCents, null)
  assert.equal(veryLarge.projectedCents, null)
  assert.equal(veryLarge.excessCents, null)
})

test('使用复盘按北京付款月归档跨月回答，只有已填写的零次才计入清单', () => {
  const now = monthChange + week
  const zero = replyTo(paid('零次', monthChange - 1, 19900), 0, now - 1)
  const used = replyTo(paid('有使用', monthChange - 2, 9900), 3, now - 2)
  const unanswered = updatePurchaseFollowUp(paid('待回访', monthChange - 3, 1300), { type: 'enable' }, now)
  const futureAnswer = replyTo(paid('未来回访', monthChange - 4, 1800), 0, now + 1)
  const december = paid('本月实付', monthChange, 78000)
  const demo = replyTo({ ...paid('演示零次', monthChange - week, 1200), source: 'demo' }, 0, monthChange, { demo: true })
  const items = [zero, used, unanswered, futureAnswer, december, demo, paid('未来付款', now + 1, 1)]
  assert.deepEqual(reviewMonths(items, now), ['2026-12', '2026-11'])
  assert.deepEqual(monthlyUsageReview(items, '2026-11', now), {
    purchased: 4, reviewed: 2, paidCents: 32900, unused: [zero],
  })
  assert.deepEqual(monthlyUsageReview(items, '2026-12', now), {
    purchased: 1, reviewed: 0, paidCents: 78000, unused: [],
  })
  assert.deepEqual(monthlyUsageReview(items, '2026-11', now, { demo: true }), {
    purchased: 1, reviewed: 1, paidCents: 1200, unused: [demo],
  })
  assert.deepEqual(reviewMonths([], now), ['2026-12'])
})

test('提醒按偏好和有效商品状态排期，偷看会改期，过期目标会复核', () => {
  const cooling = { id: 'cooling', stage: 'cooling', cooldownEndsAt: monthChange }
  const receipt = updatePurchaseFollowUp(paid('bought', monthChange - week + 3000, 7800), { type: 'enable' }, monthChange)
  const preferences = { cooldown: true, followUp: true }
  const cart = (items, reminders = preferences) => ({ items, settings: { reminders } })
  const data = cart([cooling, receipt, { ...cooling, id: 'demo', demo: true }, { ...cooling, id: 'broken/item' }])
  const [cooldown, followUp] = cartReminderRequests(data)
  assert.deepEqual(cartReminderRequests(data), [
    { itemId: 'cooling', kind: 'cooldown', dueAt: monthChange },
    { itemId: 'bought', kind: 'followUp', dueAt: monthChange + 3000 },
  ])
  assert.deepEqual(cartReminderRequests(cart(data.items, {})), [])
  assert.deepEqual(cartReminderRequests(cart(data.items, { followUp: true })), [followUp])
  assert.deepEqual(cartReminderRequests(cart(data.items, { cooldown: true })), [cooldown])
  assert.equal(itemForReminder(data, cooldown, monthChange - 1), null)
  assert.equal(itemForReminder(data, cooldown, monthChange), cooling)
  assert.equal(itemForReminder(data, followUp, monthChange + 3000), receipt)
  assert.equal(itemForReminder(data, { ...followUp, kind: 'cooldown' }, monthChange + 3000), null)

  const extended = peekDuringCooldown(cooling, monthChange - 1)
  const rescheduled = cart([extended, receipt])
  const [newCooldown] = cartReminderRequests(rescheduled)
  assert.equal(newCooldown.dueAt, extended.cooldownEndsAt)
  assert.ok(newCooldown.dueAt > cooldown.dueAt)
  assert.equal(itemForReminder(rescheduled, cooldown, extended.cooldownEndsAt), null)
  assert.equal(itemForReminder(rescheduled, newCooldown, extended.cooldownEndsAt), extended)
  assert.deepEqual(cartReminderRequests(cart([{ ...cooling, stage: 'quiz' }, receipt])), [followUp])
  assert.deepEqual(cartReminderRequests(cart([updatePurchaseFollowUp(receipt, { type: 'cancel' }, monthChange)])), [])
  const finished = replyTo(receipt, 0, followUp.dueAt)
  assert.deepEqual(cartReminderRequests(cart([finished])), [])
  assert.equal(itemForReminder(cart([finished]), followUp, followUp.dueAt), null)
})
