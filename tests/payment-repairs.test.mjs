import assert from 'node:assert/strict'
import test from 'node:test'
import {
  budgetPreview, confirmPurchase, correctPayment, registerPayment, spendingTotals, withdrawPayment,
} from '../src/lib/ledger.js'
import { cartReminderRequests } from '../src/lib/cartReminders.js'
import { monthlyUsageReview } from '../src/lib/monthlyUsageReview.js'
import {
  purchaseFollowUpState, reschedulePurchaseFollowUp, updatePurchaseFollowUp,
} from '../src/lib/purchaseFollowUp.js'

const day = 24 * 60 * 60 * 1000
const paidAt = Date.parse('2026-10-01T09:00:00+08:00')
const firstPayment = { paidCents: 2400, paidAt, source: 'self_reported' }
const item = { id: 'qa-item', stage: 'final', price: 24, purchaseReview: { reminder: '先等一等' } }
const enable = { type: 'enable' }
const originalAnswer = { type: 'answer', useCount: 0, reason: 'no' }
const reminderPlan = (product) => cartReminderRequests({
  items: [product], settings: { reminders: { followUp: true } },
})

test('已放行、购买前提醒和待确认均可主动登记实付，其他阶段不得登记', () => {
  for (const stage of ['final', 'approved', 'pending']) {
    const previous = { ...item, stage }
    const paid = registerPayment(previous, firstPayment)
    assert.equal(paid.stage, 'purchased')
    assert.equal(paid.beforePaymentStage, stage)
    assert.deepEqual(spendingTotals([paid], paidAt), { weekCents: 2400, monthCents: 2400 })
    assert.equal(confirmPurchase(paid, { ...firstPayment, paidCents: 1100 }), paid)
    const restored = withdrawPayment(paid)
    assert.deepEqual(restored, previous)
    assert.deepEqual(spendingTotals([restored], paidAt), { weekCents: 0, monthCents: 0 })
  }
  for (const stage of ['cooling', 'trial', 'cartReview', 'purchased', 'abandoned']) {
    const unavailable = { ...item, stage }
    assert.equal(registerPayment(unavailable, firstPayment), unavailable)
  }
  assert.equal(registerPayment(item, { ...firstPayment, paidCents: -1 }), item)
  assert.equal(confirmPurchase(item, firstPayment), item)
})

test('撤销旧版已购记录时不会遗留实付或回访，也保留演示数据标记', () => {
  const legacy = { ...item, ...firstPayment, stage: 'purchased', source: 'demo', paymentReturnAt: paidAt - 1 }
  const withFollowUp = updatePurchaseFollowUp(legacy, enable, paidAt, { demo: true })
  const restored = withdrawPayment(withFollowUp)
  assert.deepEqual(restored, { ...item, stage: 'pending', demo: true })
  assert.deepEqual(reminderPlan(restored), [])
})

test('修正金额立即更新周月支出和预算，改为零仍留下原购买记录', () => {
  const paid = registerPayment(item, firstPayment)
  const corrected = correctPayment(paid, { paidCents: 1234, paidAt })
  const refunded = correctPayment(corrected, { paidCents: 0, paidAt })
  assert.equal(corrected.source, 'self_reported')
  assert.deepEqual(spendingTotals([corrected], paidAt), { weekCents: 1234, monthCents: 1234 })
  assert.equal(budgetPreview([corrected], { price: 2 }, { monthlyBudget: 20 }, paidAt).projectedCents, 1434)
  assert.deepEqual(monthlyUsageReview([refunded], '2026-10', paidAt), {
    purchased: 1, reviewed: 0, paidCents: 0, unused: [],
  })
  assert.equal(correctPayment(paid, { paidCents: -100, paidAt }), paid)
})

test('修正购买时间重算回访和通知，原答案可作为草稿以便在新日期核对', () => {
  const paid = registerPayment(item, firstPayment)
  const originalDueAt = paidAt + 7 * day
  const enabled = updatePurchaseFollowUp(paid, enable, paidAt)
  const completed = updatePurchaseFollowUp(enabled, originalAnswer, originalDueAt)
  const newPaidAt = paidAt + 2 * day
  const newDueAt = newPaidAt + 7 * day
  const moved = reschedulePurchaseFollowUp(completed,
    correctPayment(completed, { paidCents: 2400, paidAt: newPaidAt }), originalDueAt)
  assert.deepEqual(purchaseFollowUpState(moved, originalDueAt), {
    status: 'scheduled', dueAt: newDueAt,
    draft: { useCount: 0, reason: 'no', answeredAt: originalDueAt },
  })
  assert.deepEqual(reminderPlan(moved), [{ itemId: item.id, kind: 'followUp', dueAt: newDueAt }])
  assert.equal(monthlyUsageReview([moved], '2026-10', newDueAt).reviewed, 0)
  assert.deepEqual(reminderPlan(withdrawPayment(moved)), [])
})

test('已完成回访可明确修正，同一笔实付不受重复旧提交或回访编辑影响', () => {
  const enabled = updatePurchaseFollowUp(registerPayment(item, firstPayment), enable, paidAt)
  const dueAt = paidAt + 7 * day
  const completed = updatePurchaseFollowUp(enabled, originalAnswer, dueAt)
  assert.equal(updatePurchaseFollowUp(completed, { ...originalAnswer, useCount: 3 }, dueAt + 1), completed)
  const action = { ...originalAnswer, type: 'correct', useCount: 3, reason: 'yes' }
  assert.equal(updatePurchaseFollowUp(enabled, action, dueAt + 1), enabled)
  const corrected = updatePurchaseFollowUp(completed, action, dueAt + 1)
  assert.equal(purchaseFollowUpState(corrected, dueAt + 1).answer.useCount, 3)
  assert.equal(corrected.paidCents, completed.paidCents)
  assert.equal(corrected.paidAt, completed.paidAt)
  assert.deepEqual(monthlyUsageReview([corrected], '2026-10', dueAt + 1).unused, [])
})
