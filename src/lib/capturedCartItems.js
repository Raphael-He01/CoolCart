import { findDuplicateProducts } from './duplicateProducts.js'
import { normalizeLockRules } from './rules.js'

export const CART_PLATFORMS = Object.freeze(['京东', '淘宝', '天猫'])
const METHODS = Object.freeze({ screenshot: '购物车截屏', screenSharing: '屏幕共享识别', shareSheet: '截屏分享' })
const MAX_CROP_LENGTH = 24 * 1024 // Base64 for the 18 KiB JPEG limit in CartScreenshotCrop.
const REVIEW_CROP_BUDGET = 256 * 1024

function readScreenshotCrop(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > MAX_CROP_LENGTH ||
      value.length % 4 !== 0 || !/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value)) return undefined
  try {
    return atob(value.slice(-8)).endsWith('\xff\xd9') ? value : undefined
  } catch {
    return undefined
  }
}

export function reviewScreenshotUrl(item) {
  const crop = item?.stage === 'cartReview' && readScreenshotCrop(item.screenshotCrop)
  return crop ? 'data:image/jpeg;base64,' + crop : ''
}

function validPrice(price) {
  return Number.isFinite(price) && price > 0 && price <= 10000000 && Number(price.toFixed(2)) === price ? price : null
}

function platformName(value) {
  return CART_PLATFORMS.includes(value) ? value : ''
}

export function cartImportLabel(item) {
  const capture = item?.cartImport
  if (capture && Object.hasOwn(METHODS, capture.method)) {
    return (platformName(capture.platform) || '平台待确认') + ' · ' + METHODS[capture.method]
  }
  if (item?.priceSource === 'screen_capture') return (platformName(item.platform) || '平台待确认') + ' · 购物车识别'
  return ''
}

function normalized(text) {
  return typeof text === 'string' ? text.normalize('NFKC').toLowerCase().replace(/\s+/gu, '') : ''
}

function sameCapture(item, draft) {
  if (!item.cartImport && item.priceSource !== 'screen_capture') return false
  return platformName(item.cartImport?.platform ?? item.platform) === draft.platform
    && [item.name, item.captureOriginalName].some((name) => normalized(name) === normalized(draft.name))
    && normalized(item.variant) === normalized(draft.variant)
}

export function requiresCaptureCategory(item, settings) {
  if (!item.cartImport || item.category) return false
  const { all, categories, thresholdYuan, categoryThresholdYuan } = normalizeLockRules(settings?.lockRules)
  const price = validPrice(item.price)
  return !all && categories.length > 0 && price !== null
    && (thresholdYuan === null || price <= thresholdYuan)
    && (categoryThresholdYuan === null || price > categoryThresholdYuan)
}

export function correctCapturedTitle(item, value, items) {
  const name = value.trim()
  if (!cartImportLabel(item) || !name || name.length > 120) return { error: '请输入 1 至 120 字的商品名称。' }
  if (item.name === name) return { item }
  const corrected = { ...item, name, captureOriginalName: item.captureOriginalName || item.name,
    ...(!item.link && { cartLinkLookup: undefined }) }
  const others = items.filter(({ id }) => id !== item.id)
  const prior = new Set(findDuplicateProducts(item, others).items.map(({ id }) => id))
  if (findDuplicateProducts(corrected, others).items.some(({ id }) => !prior.has(id))) {
    return { error: '更正后的名称可能与已有商品重复，请先核对商品列表。' }
  }
  return { item: corrected }
}

export function readCartItems(items) {
  if (!Array.isArray(items)) throw new Error('未能读取购物车识别结果，请重试。')
  return items.filter((item) => typeof item?.id === 'string' && item.id.trim() &&
    typeof item.name === 'string' && item.name.trim())
    .map(({ id, name, variant, platform, price, screenshotCrop }) => {
      const crop = readScreenshotCrop(screenshotCrop)
      return {
        id,
        name: name.trim().slice(0, 120),
        variant: typeof variant === 'string' ? variant.trim().slice(0, 60) : '',
        platform: typeof platform === 'string' ? platform.trim() : '',
        price: validPrice(price),
        ...(crop && { screenshotCrop: crop }),
      }
    })
}

export function importCapturedCart(items, rows, method, platformOverride, makeCartItem, settings) {
  if (!Object.hasOwn(METHODS, method)) throw new Error('未知的购物车识别来源。')
  const next = [...items]
  let inserted = 0
  let added = 0
  let review = 0
  let skipped = 0
  let filledCrop = false
  let cropSpace = REVIEW_CROP_BUDGET - items.reduce((length, item) =>
    length + (item.stage === 'cartReview' ? (readScreenshotCrop(item.screenshotCrop)?.length ?? 0) : 0), 0)
  for (const row of rows) {
    const id = row.newId || row.id
    const platform = platformName(platformOverride) || platformName(row.platform)
    const price = validPrice(row.price)
    const draft = {
      name: row.name, variant: row.variant || '', platform, price, link: '', category: '',
      priceSource: price === null ? '' : 'screen_capture', cartImport: { method, platform },
    }
    const crop = method === 'screenSharing' ? undefined : readScreenshotCrop(row.screenshotCrop)
    const exact = next.find((item) => item.id === id) || next.find((item) => sameCapture(item, draft))
    // 补读规格时，只有完全相同的单品局部图才能升级旧的无规格草稿。
    const previous = !exact && crop && draft.variant && price !== null
      ? next.filter((item) => item.stage === 'cartReview' && item.price == null && !item.variant
        && sameCapture(item, { ...draft, variant: '' }) && readScreenshotCrop(item.screenshotCrop) === crop) : []
    const recovered = previous.length === 1 ? previous[0] : undefined
    const existing = exact || recovered
    const matchesReview = existing?.stage === 'cartReview' && (existing === recovered || sameCapture(existing, draft))
    if (matchesReview && existing.cartLinkLookup?.status === 'linked') {
      Object.assign(draft, {
        link: existing.link, imageUrl: existing.imageUrl, details: existing.details, matchSource: existing.matchSource,
        category: existing.category || '', cartLinkLookup: existing.cartLinkLookup,
      })
    }
    const matches = !existing || (matchesReview && price !== null)
      ? findDuplicateProducts(draft, next.filter((item) => item.stage !== 'cartReview')).items : []
    // A suggested category may prefill the form, but the user still confirms
    // it before a category rule can allow the captured item to proceed.
    const categoryRequired = existing?.cartReviewReason === 'category'
      || requiresCaptureCategory({ ...draft, category: '' }, settings)
    const cropFits = crop && crop.length <= cropSpace
    if (existing && (!matchesReview || price === null || matches.length || categoryRequired)) {
      if (matchesReview && categoryRequired && price !== null && existing.price == null) {
        next[next.indexOf(existing)] = { ...existing, price, priceSource: draft.priceSource,
          cartReviewReason: matches.length ? 'duplicate' : 'category',
          ...(cropFits && { screenshotCrop: crop }) }
        if (cropFits) cropSpace += (readScreenshotCrop(existing.screenshotCrop)?.length ?? 0) - crop.length
        filledCrop = true
        skipped++
        continue
      }
      // An older review can gain a crop from a re-share of the same source and amount.
      if (matchesReview && existing.cartImport?.method === method && validPrice(existing.price) === price &&
          !readScreenshotCrop(existing.screenshotCrop) && cropFits) {
        next[next.indexOf(existing)] = { ...existing, screenshotCrop: crop }
        cropSpace -= crop.length
        filledCrop = true
      }
      skipped++
      continue
    }

    if (existing) {
      const promoted = makeCartItem({ ...draft, cartImport: existing.cartImport ?? draft.cartImport }, existing.id)
      const index = next.indexOf(existing)
      next[index] = { ...promoted, createdAt: existing.createdAt ?? promoted.createdAt }
      cropSpace += readScreenshotCrop(existing.screenshotCrop)?.length ?? 0
      if (index < inserted) {
        // The earlier, incomplete observation in this batch was a duplicate of this ready row.
        review--
        skipped++
      }
      added++
      continue
    }

    const item = makeCartItem(draft, id)
    const reason = matches.length ? 'duplicate' : price === null ? 'price' : categoryRequired ? 'category' : ''
    if (reason) {
      const waiting = { ...draft, id, createdAt: item.createdAt, demo: item.demo, stage: 'cartReview', cartReviewReason: reason }
      if (cropFits) {
        waiting.screenshotCrop = crop
        cropSpace -= crop.length
      }
      next.splice(inserted++, 0, waiting)
      review++
    } else {
      next.splice(inserted++, 0, item)
      added++
    }
  }
  return { items: added || review || filledCrop ? next : items, added, review, skipped }
}
