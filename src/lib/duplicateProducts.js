import { readProductLink } from './productImport.js'

function normalized(text) {
  return typeof text === 'string' ? text.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
}

function identity(item) {
  const product = readProductLink(item.link)
  const platform = product?.platform || item.platform
  return {
    name: normalized(item.name),
    variant: normalized(item.variant),
    platform: platform === '天猫' ? '淘宝' : platform,
    link: product?.url || item.link,
    itemId: product?.itemId,
    pageToken: product?.pageToken,
    skuId: product?.skuId,
    shortLink: Boolean(product && !product.itemId && !product.pageToken),
  }
}

function match(a, b) {
  if (a.platform && b.platform && a.platform !== b.platform) return null
  const differentLabels = a.variant && b.variant && a.variant !== b.variant
  if ((a.itemId && b.itemId) || (a.pageToken && b.pageToken)) {
    if (a.itemId !== b.itemId || a.pageToken !== b.pageToken) return null
    if (a.skuId && b.skuId) {
      if (a.skuId !== b.skuId) return null
      return differentLabels ? 'possible' : 'exact'
    }
    if (differentLabels) return null
    if (a.skuId || b.skuId) return 'possible'
    if (a.variant === b.variant && (a.variant || a.platform === '京东')) return 'exact'
    return 'possible'
  }
  if (differentLabels) return null
  if (a.link && a.link === b.link) return 'possible'
  if (a.platform && a.platform === b.platform && (a.shortLink || b.shortLink)) return 'possible'
  return a.name && a.name === b.name ? 'possible' : null
}

export function findDuplicateProducts(draft, items) {
  const candidate = identity(draft)
  const exact = []
  const possible = []
  for (const item of items) {
    const kind = match(candidate, identity(item))
    if (kind === 'exact') exact.push(item)
    if (kind === 'possible') possible.push(item)
  }
  return { exact: exact.length > 0, items: exact.length ? exact : possible }
}
