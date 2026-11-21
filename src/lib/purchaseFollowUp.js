import { isLedgerEntry } from './ledger.js'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const DEMO_WAIT_MS = 10000

export const FOLLOW_UP_REASONS = Object.freeze({
  yes: '仍然成立',
  partial: '部分成立',
  no: '已经不成立',
  unsure: '还说不准',
})

function validTime(time) {
  return Number.isSafeInteger(time) && Number.isFinite(new Date(time).getTime())
}

function validResponse(response) {
  return Number.isSafeInteger(response?.useCount) && response.useCount >= 0 &&
    typeof response.reason === 'string' && Object.hasOwn(FOLLOW_UP_REASONS, response.reason)
}

export function purchaseFollowUpState(item, now, { demo = false } = {}) {
  if (!isLedgerEntry(item, { demo })) return null
  const dueAt = item.paidAt + (demo ? DEMO_WAIT_MS : WEEK_MS)
  if (!validTime(dueAt)) return null
  const stored = item.purchaseFollowUp
  if (stored?.dueAt !== dueAt) return { status: 'disabled', dueAt }
  const answer = stored.answer
  if (validResponse(answer) && validTime(answer.answeredAt) && answer.answeredAt >= dueAt) {
    return { status: 'completed', dueAt, answer }
  }
  return { status: now >= dueAt ? 'due' : 'scheduled', dueAt, ...(validResponse(answer) && { draft: answer }) }
}

export function reschedulePurchaseFollowUp(previous, item, now, options) {
  const before = purchaseFollowUpState(previous, now, options)
  if (!before || before.status === 'disabled' || previous.paidAt === item.paidAt) return item
  const after = purchaseFollowUpState(item, now, options)
  if (!after) return { ...item, purchaseFollowUp: undefined }
  const answer = before.answer || before.draft
  return { ...item, purchaseFollowUp: { dueAt: after.dueAt, ...(answer && { answer }) } }
}

export function updatePurchaseFollowUp(item, action, now, options) {
  const followUp = purchaseFollowUpState(item, now, options)
  if (!followUp || (followUp.status === 'completed' && action?.type !== 'correct')) return item
  switch (action?.type) {
    case 'enable':
      return followUp.status === 'disabled' ? { ...item, purchaseFollowUp: { dueAt: followUp.dueAt } } : item
    case 'cancel':
      return followUp.status === 'disabled' ? item : { ...item, purchaseFollowUp: undefined }
    case 'answer':
    case 'correct':
      if (followUp.status !== (action.type === 'correct' ? 'completed' : 'due') ||
        !validTime(now) || now < followUp.dueAt || !validResponse(action)) return item
      return {
        ...item,
        purchaseFollowUp: {
          dueAt: followUp.dueAt,
          answer: { useCount: action.useCount, reason: action.reason, answeredAt: now },
        },
      }
    default:
      return item
  }
}

export function duePurchaseFollowUps(items, now, options) {
  return items.filter((item) => item?.purchaseFollowUp && purchaseFollowUpState(item, now, options)?.status === 'due')
}

function category(value) {
  if (typeof value !== 'string') return ''
  const key = value.normalize('NFKC').trim().toLowerCase()
  return ['其他', '未分类', '未知'].includes(key) ? '' : key
}

export function latestRelatedFollowUp(items, item, now, options) {
  const selected = category(item.category)
  const recognized = category(item.purchaseReview?.productType)
  if (!selected && !recognized) return null

  let latest = null
  for (const entry of items) {
    if (entry?.id === item.id || !entry?.purchaseFollowUp?.answer) continue
    const previousCategory = category(entry.category)
    // When both users' selected categories are present, use those. Otherwise compare recognized types.
    const matches = selected && previousCategory
      ? selected === previousCategory
      : recognized && recognized === category(entry.purchaseReview?.productType)
    if (!matches) continue
    const followUp = purchaseFollowUpState(entry, now, options)
    if (followUp?.status !== 'completed' || followUp.answer.answeredAt > now) continue
    if (!latest || followUp.answer.answeredAt > latest.answer.answeredAt) {
      latest = { name: entry.name, answer: followUp.answer }
    }
  }
  return latest
}
