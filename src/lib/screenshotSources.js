import { productImageUrl, readProductLink, storefrontForLink } from './productImport.js'

function comparable(value) {
  return (value || '').normalize('NFKC').toLowerCase()
    .replace(/(^|[^a-z0-9])(viii|vii|vi|iv|v|iii|ii)(?=$|[^a-z0-9])/gu, (_, prefix, roman) =>
      prefix + ({ ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 })[roman])
}

function containsTerm(text, term) {
  const parts = comparable(term).match(/[a-z]+|\d+|[\p{Script=Han}]+/gu)
  if (!parts) return false
  let rest = comparable(text)
  for (const part of parts) {
    const pattern = /^[a-z]/u.test(part) ? '(?<![a-z])' + part + '(?![a-z])'
      : /^\d/u.test(part) ? '(?<!\\d)' + part + '(?!\\d)' : part
    const match = rest.match(new RegExp(pattern, 'u'))
    if (!match) return false
    if (part === parts.at(-1) && /^\d/u.test(part) && /^[a-z]/u.test(rest.slice(match.index + part.length))) return false
    rest = rest.slice(match.index + match[0].length)
  }
  return true
}

function containsModel(text, model) {
  const parts = comparable(model).match(/[a-z]+|\d+|[\p{Script=Han}]+/gu)
  if (!parts) return false
  // 型号必须连续出现，不能从别款标题的接口尺寸或重量中借用数字。
  const start = /^[a-z\d]/u.test(parts[0]) ? '(?<![a-z0-9])' : ''
  const end = /[a-z\d]$/u.test(parts.at(-1)) ? '(?![a-z0-9])' : ''
  return new RegExp(start + parts.join('[\\s._–—-]*') + end, 'u').test(comparable(text))
}

function brandMatches(title, brand) {
  if (containsTerm(title, brand)) return true
  const alias = brand?.match(/^([^()（）]+)[(（]([^()（）]+)[)）]$/u)
  return Boolean(alias && [alias[1], alias[2]].some((term) => containsTerm(title, term)))
}

export function hasDistinctiveName(product) {
  const term = product.searchName || product.name || ''
  const distinctive = term.replace(/[\s\p{P}\d]|京东|自营|旗舰店|耳机|有线|无线|入耳式|蓝牙|手机|鼠标|键盘|电脑|学生|办公|黑色|标准版|数码|商品/gu, '')
  return distinctive.length >= 6 && term.length >= 8
}

export function hasModelIdentity(product) {
  return product.brand?.length >= 2 && product.model?.length >= 2 && product.model !== product.brand
    && !/^\d+(?:[.．]\d+)?\s*(?:mm|cm|gb|tb|英寸|双球珠|毫[米升])/iu.test(product.model)
    && !/^(?:耳机|鼠标|手机|键盘|电脑|运动鞋|标准版|入耳式|蓝牙耳机|无线耳机|新款|\d+)$/u.test(product.model)
    && containsTerm(product.name, product.brand) && containsModel(product.name, product.model)
}

export function matchesScreenshot(product, title, requireVariant = true) {
  if (!title) return false
  if (hasModelIdentity(product) || (product.query && product.model && containsModel(product.name, product.model))) {
    if ((product.brand && !brandMatches(title, product.brand)) || !containsModel(title, product.model)) return false
    // M185 与 M186（M185）即使共享系列和品牌，也不能当作同一型号。
    const numbered = comparable(product.model).match(/([a-z]+|[\p{Script=Han}]+)\s*[- ]?(\d+)/u)
    if (numbered) {
      const family = new RegExp(numbered[1] + '\\s*[- ]?(\\d+)', 'gu')
      if ([...comparable(title).matchAll(family)].some((code) => code[1] !== numbered[2])) return false
    }
  } else if (!containsTerm(title, product.name)
    && !(product.searchName && hasDistinctiveName(product) && (!product.brand || brandMatches(title, product.brand))
      && containsTerm(title, product.searchName))) return false
  // 标题里出现新的版本或配件名时，不能把包含原型号的配件当作整件商品。
  const qualifiers = comparable(title).match(/(?<![a-z])(?:pro|max|plus|mini|ultra|lite|se|fe|dusk)(?![a-z])|适用于|适配|兼容|平替|保护套|保护壳|保护膜|解码器|解码耳放|鼠标脚贴|鼠标垫|脚贴|耳机套|耳罩|收纳盒|替换线|升级线|延长线|转接头|配件|套装|联名版|青春版|升级版|纪念版|二手|翻新/gu) || []
  const original = comparable(product.name + ' ' + product.variant)
  if (qualifiers.some((qualifier) => !original.includes(qualifier))) return false
  if (product.model && comparable(title).includes(comparable(product.model) + '+') && !original.includes('+')) return false
  return !requireVariant || !product.variant || containsTerm(title, product.variant)
}

export function publicReferenceUrl(raw) {
  if (typeof raw !== 'string') return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return ''
    const path = url.pathname
    if (url.hostname === 'watchmono.com' && /^\/e\/[\w-]+$/u.test(path)) return url.origin + path
    if (url.hostname === 'www.jd.com' && /^(?:\/(?:pinpai\d*|brand)\/[a-z\d]+|\/phb\/key_[a-z\d]+|\/chanpin\/\d+)\.html$/iu.test(path)) return url.origin + path
    if (url.hostname === 'm.ithome.com' && /^\/html\/\d+\.htm$/u.test(path)) return url.origin + path
    if (['digi.ithome.com', 'www.ithome.com'].includes(url.hostname)) {
      const id = path.match(/^\/(?:archiver\/)?(\d{1,2})\/(\d{3})\/(\d{3})\.htm$/u)
      if (id) return 'https://m.ithome.com/html/' + Number(id.slice(1).join('')) + '.htm'
    }
  } catch { /* 未识别的公开来源跳过。 */ }
  return ''
}

export function jdCatalogUrl(raw) {
  const url = publicReferenceUrl(raw)
  return /^https:\/\/www\.jd\.com\/chanpin\/\d+\.html$/u.test(url) ? url : ''
}

function unescapeText(text) {
  return text.replace(/&(amp|quot|apos|lt|gt|nbsp|#39|#34);/gu, (_, code) =>
    ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', '#39': "'", '#34': '"' })[code])
}

function attribute(tag, name) {
  const match = tag.match(new RegExp('\\s' + name + '\\s*=\\s*(["\\x27])([\\s\\S]*?)\\1', 'iu'))
  return match ? unescapeText(match[2]) : ''
}

function plain(fragment) {
  return unescapeText(fragment.replace(/<[^>]*>/gu, ' ')).replace(/\s+/gu, ' ').trim()
}

function cardField(body, name) {
  return plain(body.match(new RegExp('<span\\s+class=["\\x27]' + name + '["\\x27][^>]*>([\\s\\S]*?)</span>', 'iu'))?.[1] || '')
}

// 目录的公开价签与商品编号在同一张卡内。其他卡、促销文字和脚本中的价格不参与核价。
export function readJdCatalogPrice(html, link, product) {
  const id = link.itemId
  if (link.platform !== '京东' || !id || (link.skuId && link.skuId !== id)
    || typeof html !== 'string' || html.length > 1048576) return null
  const body = html.replace(/<!--[\s\S]*?-->|<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, '')
  const hasClass = (tag, name) => attribute(tag, 'class').split(/\s+/u).includes(name)
  const cards = [...body.matchAll(/<li\b[^>]*>/giu)].filter(([tag]) => hasClass(tag, 'gl-item') && attribute(tag, 'data-sku') === id)
  if (cards.length !== 1) return null
  const tail = body.slice(cards[0].index + cards[0][0].length)
  let depth = 1
  let card = ''
  for (const match of tail.matchAll(/<\/?li\b[^>]*>/giu)) {
    const [tag] = match
    if (tag.startsWith('</')) depth--
    else if (hasClass(tag, 'gl-item')) return null
    else depth++
    if (depth === 0) {
      card = tail.slice(0, match.index)
      break
    }
  }
  const names = [...card.matchAll(/(<div\b[^>]*>)\s*(<a\b[^>]*>)\s*<em\b[^>]*>([\s\S]*?)<\/em\s*>/giu)]
    .filter(([, block]) => hasClass(block, 'p-name'))
  if (names.length !== 1) return null
  const [, , anchor, title] = names[0]
  const href = attribute(anchor, 'href').replace(/^\/\//u, 'https://')
  if (href !== 'https://item.jd.com/' + id + '.html' || !matchesScreenshot(product, plain(title))) return null

  const prices = [...card.matchAll(/(<div\b[^>]*>)\s*(<strong\b[^>]*>)/giu)]
    .filter(([, block]) => hasClass(block, 'p-price'))
  if (prices.length !== 1 || !hasClass(prices[0][2], 'J_' + id)) return null
  const price = attribute(prices[0][2], 'data-price')
  return /^\d+(?:\.\d{1,2})?$/u.test(price) ? Number(price) : null
}

// 只读独立锚点。完整商品名、链接、原图必须来自同一购买卡或命名的商品链接。
export function readReferenceOffers(source, html, product) {
  if (!publicReferenceUrl(source) || typeof html !== 'string' || html.length > 1048576) return []
  const body = html.replace(/<!--[\s\S]*?-->|<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, '')
  const offers = []
  for (const match of body.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a\s*>/giu)) {
    const [, tag, inner] = match
    const href = attribute(tag, 'href').replace(/^\/\//u, 'https://')
    if (!/^https?:\/\//iu.test(href)) continue
    const parsed = readProductLink(href)
    let link = null
    try {
      if (parsed && new URL(href).hostname === new URL(parsed.url).hostname) link = parsed
    } catch { continue }
    const cardName = cardField(inner, 'card-name')
    const title = cardName || attribute(tag, 'title') || plain(inner)
    if (!matchesScreenshot(product, title) || title.length > 450) continue
    const storefront = link?.itemId || link?.pageToken ? storefrontForLink(link) : ''
    const badge = cardField(inner, 'mall-data')
    if (storefront && badge && storefront !== badge) continue
    const platform = storefront || badge
    if (!['京东', '淘宝', '天猫'].includes(platform)) continue
    const img = inner.match(/<img\b[^>]*>/iu)?.[0] || ''
    const imageUrl = ['data-no-referrer', 'data-lazy-img', 'data-original', 'src']
      .map((key) => productImageUrl(attribute(img, key), platform)).find(Boolean) || ''
    // 导购联盟的跳转地址只能用来核对卡片配图，不能作为最终购买链接或核价依据。
    if (!link?.itemId && !link?.pageToken && !(cardName && imageUrl)) continue
    offers.push({
      name: product.name, platform, link: link?.itemId || link?.pageToken ? link.url : '', imageUrl, price: null,
      details: title.replace(/[-–| ]*(?:tmall\.com天猫|京东商城)$/iu, '').slice(0, 160),
      matchSource: source.startsWith('https://www.jd.com/') ? 'merchant' : 'reference',
    })
  }
  return offers
}

export function pageImage(content, product, platform) {
  const main = content.split(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:相关推荐|商品推荐|为你推荐|猜你喜欢|看了又看|商品评价|用户评价|评论|晒单|商品问答)/u, 1)[0]
  const images = new Set()
  for (const match of main.matchAll(/!\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/gu)) {
    if (matchesScreenshot(product, match[1])) {
      const image = productImageUrl(match[2], platform)
      if (image) images.add(image)
    }
  }
  return images.size === 1 ? [...images][0] : ''
}

// 京东移动页公开输出当前商品的独立 JSON。推荐项和其他 SKU 也可带图，只认主 SKU 的第一张图。
export function readMobileJdProduct(html, link, product, { includeOffer = false } = {}) {
  if (typeof html !== 'string' || html.length > 1048576 || !link.itemId || (link.skuId && link.skuId !== link.itemId)) return null
  const records = [...html.matchAll(/(?:^|[;>\s])window\._itemOnly\s*=\s*\(\s*(\{[\s\S]*?\})\s*\)\s*;/gu)]
  if (records.length !== 1) return null
  let item
  try { item = JSON.parse(records[0][1]).item } catch { return null }
  if (String(item?.skuId) !== link.itemId || typeof item.skuName !== 'string' || !item.skuName.trim()
    || (product && !matchesScreenshot(product, item.skuName, !includeOffer))) return null
  const images = (html.match(/<img\b[^>]*>/giu) || []).filter((tag) => attribute(tag, 'id') === 'firstImg')
  const image = images.length === 1 ? productImageUrl(attribute(images[0], 'src'), '京东') : ''
  const path = item.image?.[0]
  const imageUrl = typeof path === 'string' && /^jfs\/[\w./-]+$/u.test(path) && image
    && new URL(image).pathname.split('!')[0].endsWith(path) ? image : ''
  return { name: product?.name || item.skuName.slice(0, 120), platform: '京东', link: link.url, imageUrl, details: item.skuName.slice(0, 160),
    price: null, matchSource: 'merchant', ...(includeOffer && mobileJdOffer(html, item)) }
}

function mobileJdOffer(html, item) {
  const options = Array.isArray(item.newColorSize) ? item.newColorSize.filter((row) => String(row?.skuId) === String(item.skuId)) : []
  const option = options.length === 1 ? options[0] : null
  const variant = [...new Set([option?.color, option?.size, option?.spec].filter((part) => typeof part === 'string' && part.trim()))].join(' · ')
  let shop = ''
  const records = [...html.matchAll(/(?:^|[;>\s])window\._itemInfo\s*=\s*\(\s*(\{[\s\S]*?\})\s*\)/gu)]
  if (records.length === 1) {
    try {
      const { stock } = JSON.parse(records[0][1].replace(/,\s*\}$/u, '}'))
      if (String(stock?.skuId) === String(item.skuId) && /^\d+$/u.test(item.venderID)) {
        const names = new Set([stock.D, stock.self_D].filter((seller) => String(seller?.venderId) === String(item.venderID))
          .map((seller) => seller.shopName).filter((name) => typeof name === 'string' && name.trim()))
        if (names.size === 1) [shop] = names
      }
    } catch { /* 公开页不提供店铺时，仍可展示商品。 */ }
  }
  return { shop, variant }
}
