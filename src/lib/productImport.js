export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export function productQuery(value) {
  if (typeof value !== 'string' || value.length > 8192 || /https?:\/\//iu.test(value)) return ''
  const query = value.trim().replace(/\s+/gu, ' ')
  if (Array.from(query).some((letter) => letter.charCodeAt(0) < 32 || letter.charCodeAt(0) === 127)) return ''
  return query.length >= 2 && query.length <= 160 ? query : ''
}

const SHOPS = new Map([
  ['item.jd.com', '京东'],
  ['item.m.jd.com', '京东'],
  ['u.jd.com', '京东'],
  ['3.cn', '京东'],
  ['item.taobao.com', '淘宝'],
  ['detail.tmall.com', '淘宝'],
  ['detail.m.tmall.com', '淘宝'],
  ['h5.m.taobao.com', '淘宝'],
  ['m.tb.cn', '淘宝'],
  ['e.tb.cn', '淘宝'],
])
const SHARE_HOSTS = new Set(['u.jd.com', '3.cn', 'm.tb.cn', 'e.tb.cn'])

function parseShopUrl(raw) {
  try {
    const url = new URL(raw.replace(/[),.;]+$/, ''))
    const platform = SHOPS.get(url.hostname)
    if (!platform || url.username || url.password || url.port || url.href.length > 2048) return null
    url.protocol = 'https:'
    url.hash = ''
    const isShare = SHARE_HOSTS.has(url.hostname)
    const id = isShare ? null : platform === '京东'
      ? url.pathname.match(/^\/(?:product\/)?(\d+)\.html$/)?.[1]
      : /^(?:\/awp\/core)?\/item\.htm$/.test(url.pathname) ? url.searchParams.get('id') : null
    const itemId = /^\d+$/.test(id || '') ? id : null
    // 京东公开商品页还使用区分大小写的页面标识，不把它当成数字 SKU。
    const pageToken = url.hostname === 'item.jd.com' && url.pathname.match(/^\/product\/([A-Za-z0-9_-]{22})\.html$/)?.[1]
    if (!itemId && !pageToken && (!isShare || url.pathname === '/')) return null
    const sku = (itemId || pageToken) && url.searchParams.get('skuId')
    const skuId = /^\d+$/.test(sku || '') ? sku : null
    if (itemId || pageToken) {
      url.search = ''
      if (platform === '淘宝') url.searchParams.set('id', itemId)
      if (skuId) url.searchParams.set('skuId', skuId)
    }
    return { url: url.href, platform, itemId, skuId, ...(pageToken && !itemId ? { pageToken } : {}) }
  } catch {
    return null
  }
}

export function readProductLinks(input) {
  if (typeof input !== 'string') return []
  const found = new Map()
  for (const [raw] of input.matchAll(/https?:\/\/[^\s<>"'，。；）】》、！？（）【「」《》]+/gi)) {
    const product = parseShopUrl(raw)
    if (!product) continue
    const key = product.itemId ? [product.platform, product.itemId, product.skuId].join('|') : product.url
    if (!found.has(key)) found.set(key, product)
  }
  return [...found.values()]
}

export function readProductLink(input) {
  const products = readProductLinks(input)
  return products.length === 1 ? products[0] : null
}

export function storefrontForLink(product) {
  if (!product) return ''
  return new URL(product.url).hostname.endsWith('.tmall.com') ? '天猫' : product.platform
}

export function isJdNavigationPage(value) {
  try {
    const { hostname, pathname } = new URL(value)
    return ['cart.jd.com', 'search.jd.com', 'passport.jd.com', 'passport.m.jd.com', 'plogin.m.jd.com', 'verify.jd.com'].includes(hostname)
      || (hostname === 'cfe.m.jd.com' && /^\/privatedomain\/risk_handler(?:\/|$)/u.test(pathname))
  } catch {
    return false
  }
}

const IMAGE_HOSTS = {
  京东: /^(?:img\d*|m)\.360buyimg\.com$/i,
  淘宝: /^(?:img|gw|g-search\d*|picasso)\.alicdn\.com$/i,
}
const IMAGE_PATH = /\.(?:jpe?g|png|webp|avif)(?:$|[!_.])/i

// 只有对应平台的静态商品图片可进入草稿与本机记录。
export function productImageUrl(raw, platform) {
  if (typeof raw !== 'string' || raw.length > 2048) return ''
  try {
    const url = new URL(raw.startsWith('//') ? 'https:' + raw : raw)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return ''
    const allowed = platform === '天猫' ? IMAGE_HOSTS.淘宝 : Object.hasOwn(IMAGE_HOSTS, platform) && IMAGE_HOSTS[platform]
    if (!allowed || !allowed.test(url.hostname) || !IMAGE_PATH.test(url.pathname)) return ''
    url.hash = ''
    return url.href
  } catch {
    return ''
  }
}
