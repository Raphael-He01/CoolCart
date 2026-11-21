import { DEFAULT_SETTINGS, yuan } from './convert.js'

const DAY_MS = 24 * 60 * 60 * 1000
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const decimalYuan = new Intl.NumberFormat('en-US', {
  useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2,
})

export function beijingPaymentTime(timestamp) {
  if (!Number.isSafeInteger(timestamp)) return ''
  const shifted = new Date(timestamp + BEIJING_OFFSET_MS)
  return Number.isFinite(shifted.getTime()) ? shifted.toISOString().split('.')[0] : ''
}

function hasPaymentFields(payment) {
  return Number.isSafeInteger(payment.paidCents) && payment.paidCents >= 0
    && Number.isSafeInteger(payment.paidAt) && Number.isFinite(new Date(payment.paidAt).getTime())
    && (payment.source === 'demo' || payment.source === 'self_reported')
}

export function confirmPurchase(item, payment = {}) {
  if (item?.stage !== 'pending' || !payment || !hasPaymentFields(payment)) return item
  const { paidCents, paidAt, source } = payment
  return { ...item, stage: 'purchased', paidCents, paidAt, source }
}

const PAYMENT_STAGES = new Set(['final', 'approved', 'pending'])

export function canRegisterPayment(item) {
  return PAYMENT_STAGES.has(item?.stage)
}

export function registerPayment(item, payment, confirm = confirmPurchase) {
  if (!canRegisterPayment(item)) return item
  const purchased = confirm(item.stage === 'pending' ? item : { ...item, stage: 'pending' }, payment)
  return purchased?.stage === 'purchased' ? { ...purchased, beforePaymentStage: item.stage } : item
}

export function correctPayment(item, { paidCents, paidAt } = {}) {
  if (item?.stage !== 'purchased' || !hasPaymentFields(item) ||
    !hasPaymentFields({ paidCents, paidAt, source: item.source })) return item
  return { ...item, paidCents, paidAt }
}

export function withdrawPayment(item) {
  if (item?.stage !== 'purchased' || !hasPaymentFields(item)) return item
  const {
    paidCents: _cents, paidAt: _paidAt, source, beforePaymentStage,
    paymentReturnAt: _returnAt, purchaseFollowUp: _followUp, ...product
  } = item
  const stage = PAYMENT_STAGES.has(beforePaymentStage) ? beforePaymentStage : 'pending'
  return { ...product, stage, ...(source === 'demo' && { demo: true }) }
}

export function isLedgerEntry(item, { demo = false } = {}) {
  const source = demo ? 'demo' : 'self_reported'
  return item?.stage === 'purchased' && item.source === source && hasPaymentFields(item)
}

export function ledgerEntries(items, options) {
  return items.filter((item) => isLedgerEntry(item, options))
}

function beijingDayStart(nowMs) {
  return Math.floor((nowMs + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS
}

// 明细按支付时间倒序。当天最近一笔实付与北京日期均未变化时，整份账本的显示也相同。
export function ledgerDisplayTime(sortedEntries, nowMs) {
  const dayStart = beijingDayStart(nowMs)
  const latest = sortedEntries.find(({ paidAt }) => paidAt <= nowMs)
  return Math.max(dayStart, latest?.paidAt ?? dayStart)
}

export function spendingTotals(items, nowMs, options) {
  return totalsForEntries(ledgerEntries(items, options), nowMs)
}

export function totalsForEntries(entries, nowMs) {
  const beijingDate = new Date(nowMs + BEIJING_OFFSET_MS)
  const dayStart = beijingDayStart(nowMs)
  const daysSinceMonday = (beijingDate.getUTCDay() + 6) % 7
  const weekStart = dayStart - daysSinceMonday * DAY_MS
  const monthStart = dayStart - (beijingDate.getUTCDate() - 1) * DAY_MS
  let weekCents = 0
  let monthCents = 0

  for (const { paidCents, paidAt } of entries) {
    if (paidAt > nowMs) continue
    if (paidAt >= weekStart) weekCents += paidCents
    if (paidAt >= monthStart) monthCents += paidCents
  }
  return {
    weekCents: Number.isSafeInteger(weekCents) ? weekCents : null,
    monthCents: Number.isSafeInteger(monthCents) ? monthCents : null,
  }
}

export function yuanToCents(amount, enteredText) {
  if (!Number.isFinite(amount) || amount < 0) return null
  const decimal = decimalYuan.format(amount)
  if (enteredText !== undefined && decimalYuan.format(enteredText) !== decimal) return null
  const cents = Number(decimal.replace('.', ''))
  return Number.isSafeInteger(cents) ? cents : null
}

export function formatCents(cents) {
  const whole = yuan(Math.floor(cents / 100))
  const fraction = cents % 100
  return fraction ? whole + '.' + String(fraction).padStart(2, '0').replace(/0$/, '') : whole
}

export function budgetPreview(items, item, settings, nowMs, options, getTotals = spendingTotals) {
  const { monthCents } = getTotals(items, nowMs, options)
  return budgetProjection(monthCents, yuanToCents(item?.price), settings)
}

function budgetProjection(monthCents, candidateCents, settings) {
  const budgetCents = yuanToCents(settings?.monthlyBudget ?? DEFAULT_SETTINGS.monthlyBudget)
  const sum = monthCents !== null && candidateCents !== null ? monthCents + candidateCents : null
  const projectedCents = Number.isSafeInteger(sum) ? sum : null
  const excessCents = projectedCents === null || budgetCents === null ? null : Math.max(0, projectedCents - budgetCents)
  return { monthCents, candidateCents, budgetCents, projectedCents, excessCents }
}

const BUDGET_STAGES = new Set(['cooling', 'quiz', 'trial', 'final', 'approved', 'pending'])

function selectableBudgetItems(items) {
  const seen = new Set()
  const candidates = []
  for (const item of items) {
    if (!BUDGET_STAGES.has(item?.stage) || !item.id || seen.has(item.id)) continue
    const cents = yuanToCents(item.price)
    if (cents === null) continue
    seen.add(item.id)
    candidates.push({ item, cents })
  }
  return candidates
}

export function combinedBudgetPreview(items, selection, settings, nowMs, options, getTotals = spendingTotals) {
  const candidates = selectableBudgetItems(items)
  const selected = candidates.filter(({ item }) => selection.has(item.id))
  const sum = selected.reduce((total, { cents }) => total + cents, 0)
  const { monthCents } = getTotals(items, nowMs, options)
  return { candidates, count: selected.length, ...budgetProjection(monthCents, Number.isSafeInteger(sum) ? sum : null, settings) }
}
