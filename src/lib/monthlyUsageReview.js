import { beijingPaymentTime, ledgerEntries } from './ledger.js'
import { purchaseFollowUpState } from './purchaseFollowUp.js'

export function beijingMonth(time) {
  return beijingPaymentTime(time).split('T')[0].slice(0, -3)
}

export function reviewMonths(items, now, options) {
  const months = new Set([beijingMonth(now)])
  for (const item of ledgerEntries(items, options)) {
    if (item.paidAt <= now) months.add(beijingMonth(item.paidAt))
  }
  return [...months].filter(Boolean).sort().reverse()
}

export function monthlyUsageReview(items, month, now, options) {
  let purchased = 0
  let reviewed = 0
  let paidCents = 0
  const unused = []
  for (const item of ledgerEntries(items, options)) {
    if (item.paidAt > now || beijingMonth(item.paidAt) !== month) continue
    purchased++
    paidCents += item.paidCents
    const answer = purchaseFollowUpState(item, now, options)?.answer
    if (!answer || answer.answeredAt > now) continue
    reviewed++
    if (answer.useCount === 0) unused.push(item)
  }
  unused.sort((a, b) => b.paidAt - a.paidAt)
  return { purchased, reviewed, paidCents: Number.isSafeInteger(paidCents) ? paidCents : null, unused }
}
