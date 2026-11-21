import { productImageUrl, readProductLink, storefrontForLink } from './productImport.js'

export const EMPTY_DRAFT = { name: '', price: '', link: '', platform: '', variant: '', category: '', priceSource: '', imageUrl: '', details: '', matchSource: '' }

function sameLink(left, right) {
  if (!left || !right) return false
  const a = readProductLink(left)
  const b = readProductLink(right)
  if (a?.itemId && b?.itemId) {
    return a.platform === b.platform && a.itemId === b.itemId && a.skuId === b.skuId
  }
  if (a?.pageToken && b?.pageToken) {
    return a.platform === b.platform && a.pageToken === b.pageToken && a.skuId === b.skuId
  }
  return a && b ? a.url === b.url : left.trim() === right.trim()
}

function variantText(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
}

export function draftHasProductEvidence(draft) {
  return Boolean(draft.link || draft.imageUrl || draft.details || draft.cartImport
    || ['web', 'screenshot', 'screenshot_offer', 'screen_capture'].includes(draft.priceSource))
}

export function applyProductImport(current, result, { forDraft = false } = {}) {
  const listing = readProductLink(result.link)
  const platformFromLink = storefrontForLink(listing)
  const draftName = variantText(current.name).toLowerCase()
  const foundName = variantText(result.name).toLowerCase()
  const draftVariant = variantText(current.variant).toLowerCase()
  const sameName = draftName === foundName || (draftVariant
    && (foundName === draftName + ' ' + draftVariant || foundName === draftName + draftVariant))
  const matchesDraft = Boolean(draftName) && sameName && draftVariant === variantText(result.variant).toLowerCase()
  const confirmedFirstLink = forDraft && !current.link && Boolean(listing?.itemId || listing?.pageToken)
    && matchesDraft && (!current.platform || current.platform === platformFromLink)
  const same = sameLink(current.link, result.link) || confirmedFirstLink
    || (forDraft && !current.link && !result.link && matchesDraft)
  const previous = same ? current : EMPTY_DRAFT
  const variant = result.variant || previous.variant
  const changedVariant = variantText(variant) !== variantText(previous.variant)
  const observedPrice = ['screenshot', 'screenshot_offer', 'screen_capture'].includes(previous.priceSource)
  const keepPrice = same && Boolean(previous.price) && !changedVariant &&
    (previous.priceSource === 'manual' || !Object.hasOwn(result, 'price') || (result.price == null && observedPrice))
  // 没有识别出规格时，不能把这次的公开报价配到用户此前手填的规格上。
  const priceForVariant = !previous.variant || Boolean(result.variant)
  let price = ''
  if (keepPrice) price = previous.price
  else if (priceForVariant && result.price != null) price = String(result.price)
  const platform = platformFromLink || result.platform || previous.platform
  const hasListing = listing?.itemId || listing?.pageToken
  const oldInfo = changedVariant ? EMPTY_DRAFT : previous
  const source = result.matchSource ?? oldInfo.matchSource
  const info = result.details ?? oldInfo.details
  const knownSource = ['merchant', 'reference'].includes(source)
  const photo = productImageUrl(result.imageUrl ?? oldInfo.imageUrl, platform)
  const hasInfo = hasListing || (knownSource && Boolean(photo))
  const alternativeLink = readProductLink(result.alternative?.link)
  const alternativePlatform = storefrontForLink(alternativeLink)
  const alternative = !hasListing && (alternativeLink?.itemId || alternativeLink?.pageToken) &&
    alternativePlatform !== platform && result.alternative.platform === alternativePlatform
    ? { ...result.alternative, link: alternativeLink.url } : undefined
  return {
    alternative,
    cartImport: result.cartImport ?? previous.cartImport,
    cartReviewId: result.cartReviewId ?? previous.cartReviewId,
    captureOriginalName: result.captureOriginalName ?? previous.captureOriginalName,
    matchSource: hasInfo && knownSource ? source : '',
    imageUrl: hasInfo ? photo : '',
    details: hasInfo && typeof info === 'string' ? info.trim().slice(0, 300) : '',
    name: (confirmedFirstLink && previous.name) || result.name || previous.name,
    variant,
    category: (forDraft && same && previous.category) || result.category || previous.category,
    link: result.link || '',
    platform,
    price,
    priceSource: price ? (keepPrice ? previous.priceSource : result.priceSource) : '',
    priceLink: price ? result.link || '' : '',
  }
}

export function editProductDraft(current, fields, { correctTitle = false } = {}) {
  if (Object.hasOwn(fields, 'name') && !correctTitle && variantText(current.name)
    && variantText(current.name) !== variantText(fields.name) && draftHasProductEvidence(current)) {
    return { ...EMPTY_DRAFT, ...fields, needsNewPrice: Boolean(current.price) }
  }
  const next = { ...current, ...fields }
  if (correctTitle && Object.hasOwn(fields, 'name') && current.cartImport && current.name !== fields.name) {
    next.captureOriginalName = current.captureOriginalName || current.name
  }
  const changedVariant = Object.hasOwn(fields, 'variant') && variantText(current.variant) !== variantText(fields.variant)
  if (Object.hasOwn(fields, 'link') || Object.hasOwn(fields, 'name') || changedVariant) delete next.alternative
  if (changedVariant || (Object.hasOwn(fields, 'link') && !sameLink(current.link, fields.link))) {
    next.matchSource = ''
    next.imageUrl = ''
    next.details = ''
  }
  if (Object.hasOwn(fields, 'price')) return { ...next, priceLink: next.link, needsNewPrice: false }
  if (!current.price) return next
  const changedLink = Object.hasOwn(fields, 'link') && current.priceLink && !sameLink(current.priceLink, fields.link)
  const hasQuotedPrice = ['web', 'screenshot', 'screenshot_offer', 'screen_capture'].includes(current.priceSource)
  if (changedLink || (changedVariant && (hasQuotedPrice || (current.priceLink && current.variant)))) {
    return { ...next, price: '', priceSource: '', needsNewPrice: true, priceLink: '' }
  }
  return next
}

// 截图经常不带链接。等用户填完并离开输入框，再把当前报价与整条链接关联。
export function confirmDraftLink(draft) {
  if (draft.priceLink || !draft.price) return draft
  const link = readProductLink(draft.link)
  return link ? { ...draft, priceLink: link.url } : draft
}
