import { importCapturedCart, readCartItems } from './capturedCartItems.js'

export const SHARE_INBOX_EVENT = 'coolcart:share-inbox'
const BATCH_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu

export function readShareInbox(batches) {
  if (!Array.isArray(batches)) throw new Error('截屏分享结果无效。')
  return batches.map((batch) => {
    if (typeof batch?.id !== 'string' || !BATCH_ID.test(batch.id) || !Number.isSafeInteger(batch.sharedAt) || batch.sharedAt <= 0) {
      throw new Error('截屏分享批次无效。')
    }
    return { ...batch, items: readCartItems(batch.items) }
  })
}

export function applyShareInbox(cart, batches, now, makeCartItem) {
  const queued = new Set(batches.map(({ id }) => id))
  const receipts = new Set((cart.shareReceipts ?? []).filter((id) => queued.has(id)))
  let items = cart.items
  let observed = 0
  let received = false
  for (const batch of batches) {
    if (receipts.has(batch.id)) continue
    const sharedAt = Math.min(now, batch.sharedAt)
    const result = importCapturedCart(items, batch.items, 'shareSheet', '',
      (draft, id) => makeCartItem(draft, id, cart.settings, sharedAt), cart.settings)
    items = result.items
    observed += batch.items.length
    receipts.add(batch.id)
    received = true
  }
  const previous = new Map(cart.items.map((item) => [item.id, item.stage]))
  const added = items.filter((item) => item.stage !== 'cartReview' && (!previous.has(item.id) || previous.get(item.id) === 'cartReview')).length
  const review = items.filter((item) => item.stage === 'cartReview' && !previous.has(item.id)).length
  return {
    cart: received ? { ...cart, items, shareReceipts: [...receipts] } : cart,
    summary: { added, review, skipped: observed - added - review },
  }
}

export function applyScreenShoppingBatch(cart, batch, now, makeCartItem) {
  if (cart.screenShoppingReceipt === batch.id) return { cart, summary: null }
  const completedAt = Math.min(now, batch.sharedAt)
  const { items, added, review, skipped } = importCapturedCart(cart.items, batch.items, 'screenSharing', '',
    (draft, id) => makeCartItem(draft, id, cart.settings, completedAt), cart.settings)
  return { cart: { ...cart, items, screenShoppingReceipt: batch.id },
    summary: { added, review, skipped, count: batch.items.length } }
}
