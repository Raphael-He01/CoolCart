import { importCapturedProductLink, importLinkedProduct, importNamedProduct, importScreenshot } from './linkedProduct.js'
import { readProductLink } from './productImport.js'
import { STATIC_WEB_DEMO } from './config.js'

export function importHandlers() {
  return window.location.protocol === 'coolcart:' ? window.webkit?.messageHandlers : null
}

export function hasCartLookup() {
  if (STATIC_WEB_DEMO) return false
  const handlers = importHandlers()
  return window.location.protocol !== 'coolcart:' || Boolean(handlers?.personalProductImport || handlers?.lookupCartProduct)
}

export async function requestProductImport(input) {
  if (STATIC_WEB_DEMO) throw new Error('公开演示可手填或粘贴分享链接。')
  const handlers = importHandlers()
  if (handlers?.personalProductImport) {
    const post = (path, body) => handlers.personalProductImport.postMessage({ path, body })
    const publicPages = handlers.publicProductPage || handlers.jdPublicProductPage
    const readPage = publicPages ? (product) => publicPages.postMessage(product.url) : undefined
    if (input.link) return importLinkedProduct(readProductLink(input.link), post, readPage)
    if (input.query) return importNamedProduct(input.query, post, readPage)
    if (input.cartProduct) return importCapturedProductLink(input.cartProduct, post, readPage)
    return importScreenshot(input.image, post, readPage)
  }
  if (input.link && handlers?.importProductLink) return handlers.importProductLink.postMessage(input.link)
  if (input.query && handlers?.importProductQuery) return handlers.importProductQuery.postMessage(input.query)
  if (input.image && handlers?.importProductImage) return handlers.importProductImage.postMessage(input.image)
  if (input.cartProduct && handlers?.lookupCartProduct) return handlers.lookupCartProduct.postMessage(input.cartProduct)
  if (window.location.protocol === 'coolcart:' && input.cartProduct) throw new Error('此 App 尚未连接商品查询服务。')

  const response = await fetch('/api/import-product', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(32000),
  })
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('这个网页未连接商品查询接口。请打开带后端服务的项目地址。')
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || '导入失败。')
  return result
}
