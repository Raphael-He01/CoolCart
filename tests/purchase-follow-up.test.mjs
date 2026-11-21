import assert from 'node:assert/strict'
import test from 'node:test'
import { confirmPurchase, spendingTotals } from '../src/lib/ledger.js'
import { duePurchaseFollowUps, latestRelatedFollowUp, purchaseFollowUpState, updatePurchaseFollowUp } from '../src/lib/purchaseFollowUp.js'

const paidAt = Date.parse('2026-11-24T22:15:00+08:00')
const week = 7 * 24 * 60 * 60 * 1000
const dueAt = paidAt + week
const receipt = {
  id: 'earphones', name: '通勤耳机', stage: 'purchased', category: '数码', source: 'self_reported',
  createdAt: paidAt - week, paidAt, paidCents: 39990, price: 429,
}
const optIn = { type: 'enable' }
const optOut = { type: 'cancel' }
const answer = { type: 'answer', useCount: 0, reason: 'no' }

test('已购须主动开启，付款满七天才到期，晚补记的旧记录从实付时刻计算', () => {
  assert.deepEqual(purchaseFollowUpState(receipt, dueAt), { status: 'disabled', dueAt })
  const enabled = updatePurchaseFollowUp(receipt, optIn, paidAt)
  assert.deepEqual(purchaseFollowUpState(enabled, dueAt - 1), { status: 'scheduled', dueAt })
  assert.deepEqual(purchaseFollowUpState(enabled, dueAt), { status: 'due', dueAt })
  assert.deepEqual(duePurchaseFollowUps([enabled, receipt], dueAt - 1), [])
  assert.deepEqual(duePurchaseFollowUps([enabled, receipt], dueAt), [enabled])
  assert.equal(updatePurchaseFollowUp(enabled, optIn, dueAt + 90000), enabled)
  assert.equal(purchaseFollowUpState(updatePurchaseFollowUp(receipt, optIn, dueAt + week), dueAt + week).status, 'due')
})

test('未付款、不完整付款、跨账本付款与无法计算日期均不进入回访', () => {
  for (const item of [null, { ...receipt, stage: 'pending' }, { ...receipt, paidAt: undefined },
    { ...receipt, paidCents: -1 }, { ...receipt, paidAt: 8.64e15 },
    { ...receipt, source: 'demo' }, { ...receipt, source: '' }]) {
    assert.equal(updatePurchaseFollowUp(item, optIn, dueAt), item)
    assert.equal(purchaseFollowUpState(item, dueAt), null)
  }
})

test('到期前和取消后拒绝反馈，已提交答案与原实付抵抗重复提交和重算', () => {
  const enabled = updatePurchaseFollowUp(receipt, optIn, paidAt)
  assert.equal(updatePurchaseFollowUp(enabled, answer, dueAt - 1), enabled)
  const canceled = updatePurchaseFollowUp(enabled, optOut, dueAt)
  assert.equal(purchaseFollowUpState(canceled, dueAt).status, 'disabled')
  assert.equal(updatePurchaseFollowUp(canceled, answer, dueAt), canceled)
  for (const input of [{ ...answer, useCount: -1 }, { ...answer, useCount: 1.5 }, { ...answer, useCount: '0' },
    { ...answer, useCount: NaN }, { ...answer, reason: 'constructor' }, { ...answer, reason: '' }]) {
    assert.equal(updatePurchaseFollowUp(enabled, input, dueAt), enabled)
  }
  const completed = updatePurchaseFollowUp(enabled, answer, dueAt)
  assert.deepEqual(completed, { ...receipt,
    purchaseFollowUp: { dueAt, answer: { useCount: 0, reason: 'no', answeredAt: dueAt } } })
  assert.equal(purchaseFollowUpState(completed, dueAt - 5000).status, 'completed')
  assert.deepEqual(duePurchaseFollowUps([completed], dueAt), [])
  assert.deepEqual(spendingTotals([completed], paidAt), spendingTotals([enabled], paidAt))
  assert.equal(updatePurchaseFollowUp(completed, { ...answer, useCount: 12 }, dueAt + 1), completed)
  assert.equal(updatePurchaseFollowUp(completed, optOut, dueAt + 1), completed)
  assert.equal(confirmPurchase(completed, { paidAt: dueAt, paidCents: 1, source: receipt.source }), completed)
})

test('演示账本十秒到期，同一设备的实际收据仍按七天计算', () => {
  const demo = { demo: true }
  const sandbox = updatePurchaseFollowUp({ ...receipt, source: 'demo' }, optIn, paidAt, demo)
  const present = updatePurchaseFollowUp(receipt, optIn, paidAt)
  const together = [sandbox, present]
  assert.equal(purchaseFollowUpState(sandbox, paidAt + 9999, demo).status, 'scheduled')
  assert.deepEqual(duePurchaseFollowUps(together, paidAt + 10000, demo), [sandbox])
  assert.deepEqual(duePurchaseFollowUps(together, paidAt + 10000), [])
  assert.deepEqual(duePurchaseFollowUps(together, dueAt), [present])
})

test('按最近回答时间选同类，明确品类优先，识别类型可补充分组', () => {
  function completed(id, category, type, offset, demo = false) {
    const item = { ...receipt, id, name: id, category, source: demo ? 'demo' : 'self_reported',
      purchaseReview: { productType: type } }
    return updatePurchaseFollowUp(updatePurchaseFollowUp(item, optIn, paidAt, { demo }), answer, dueAt + offset, { demo })
  }
  const ready = [
    completed('更早的数码', '数码', '', 1000),
    completed('最新的数码', '数码', '', 2000),
    completed('未来才答的数码', '数码', '', 5000),
    completed('已有匹配的另一品类', '数码', '入耳耳机', 3000),
    completed('学习用品', '学习', '入耳耳机', 4000),
    completed('演示用的数码', '数码', '', 4000, true),
    completed('自动导入耳机', '', '入耳耳机', 3500),
    completed('其他', '其他', '', 4000),
  ]
  const now = dueAt + 4100
  const current = { id: 'new', category: '数码' }
  assert.equal(latestRelatedFollowUp(ready, current, dueAt + 2500)?.name, '最新的数码')
  assert.equal(latestRelatedFollowUp(ready, current, now, { demo: true })?.name, '演示用的数码')
  assert.equal(latestRelatedFollowUp(ready, { ...current, purchaseReview: { productType: '入耳耳机' } }, now)?.name, '自动导入耳机')
  assert.equal(latestRelatedFollowUp(ready, { ...current, category: '其他' }, now), null)
  assert.equal(latestRelatedFollowUp(ready, { ...current, id: '最新的数码' }, dueAt + 2500)?.name, '更早的数码')
})
