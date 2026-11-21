import { CART_PLATFORMS, cartImportLabel } from './capturedCartItems.js'
import { productImageUrl, productQuery, readProductLink, storefrontForLink } from './productImport.js'
import { LOCK_CATEGORIES } from './rules.js'

const ACTIVE_STAGES = ['cooling', 'quiz', 'trial', 'final', 'approved', 'pending']

export function cartLinkInput(value) {
  const name = productQuery(value?.name)
  const { variant = '', platform = '', needsPrice = false } = value || {}
  if (!name || name.length > 120 || typeof variant !== 'string' || variant.length > 60
    || (variant.trim() && !productQuery('规格 ' + variant)) || (platform !== '' && !CART_PLATFORMS.includes(platform))
    || typeof needsPrice !== 'boolean') return null
  return { name, variant: variant.trim().replace(/\s+/gu, ' '), platform, ...(needsPrice && { needsPrice }) }
}

export function cartLookupInput(item) {
  const review = item.stage === 'cartReview'
  if ((!review && !ACTIVE_STAGES.includes(item.stage)) || item.link || !cartImportLabel(item)) return null
  const source = item.cartImport?.platform ?? item.platform
  return cartLinkInput({ name: item.name, variant: item.variant, platform: CART_PLATFORMS.includes(source) ? source : '',
    needsPrice: review && item.price == null })
}

function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function readOffers(result, platform) {
  const offers = new Map()
  for (const raw of Array.isArray(result?.offers) ? result.offers.slice(0, 4) : []) {
    const product = readProductLink(raw?.link)
    if ((!product?.itemId && !product?.pageToken) || storefrontForLink(product) !== platform) continue
    if (platform === '京东' && product.skuId && product.skuId !== product.itemId) continue
    const name = clean(raw.name, 160)
    if (!name) continue
    const price = raw.price
    const hasPrice = Number.isFinite(price) && price > 0 && price <= 10000000 && Number(price.toFixed(2)) === price
    offers.set(product.url, {
      link: product.url, platform, name, shop: clean(raw.shop, 80), variant: clean(raw.variant, 80),
      variantVerified: raw.variantVerified === true,
      imageUrl: productImageUrl(raw.imageUrl, platform), code: product.skuId || product.itemId || '',
      ...(hasPrice && { price }),
    })
  }
  return [...offers.values()]
}

function attachOffer(item, offer, method, category) {
  const review = item.stage === 'cartReview'
  const usePrice = review && item.price == null && offer.price != null && (offer.variantVerified || !item.variant)
  return {
    ...item, link: offer.link, imageUrl: item.imageUrl || offer.imageUrl, details: item.details || offer.name,
    ...(review && { matchSource: 'merchant', category: item.category || category }),
    ...(usePrice && { price: offer.price, priceSource: 'web' }),
    cartLinkLookup: { status: 'linked', method, platform: offer.platform, shop: offer.shop, variant: offer.variant },
  }
}

export function sameCartLookupInput(current, request) {
  return Boolean(current && request && current.name === request.name && current.variant === request.variant
    && current.platform === request.platform && current.needsPrice === request.needsPrice)
}

export function finishCartLinkLookup(item, request, result) {
  // Resolve only against the same unlinked item, including when storage replays this update.
  if (item.cartLinkLookup || !sameCartLookupInput(cartLookupInput(item), request)) return item
  if (!result) return { ...item, cartLinkLookup: { status: 'error' } }

  const offers = readOffers(result, request.platform || '京东')
  if (!offers.length) return { ...item, cartLinkLookup: { status: 'none' } }
  const category = LOCK_CATEGORIES.includes(result.category) ? result.category : ''
  const direct = offers.length === 1 && readProductLink(offers[0].link)
  if (result.automatic === true && result.offers.length === 1 && offers[0]?.variantVerified && request.variant
    && ((request.platform === '京东' && direct?.itemId) || (request.platform && direct?.skuId))) {
    return attachOffer(item, offers[0], 'automatic', category)
  }
  return { ...item, cartLinkLookup: { status: 'choices', offers, ...(category && { category }) } }
}

export function chooseCartLink(item, link) {
  const input = cartLookupInput(item)
  if (!input || item.cartLinkLookup?.status !== 'choices') return item
  const choice = readOffers(item.cartLinkLookup, input.platform || '京东').find((offer) => offer.link === link)
  return choice ? attachOffer(item, choice, 'selected', item.cartLinkLookup.category || '') : item
}
