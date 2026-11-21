import { importCapturedProductLink, importLinkedProduct, importNamedProduct, importScreenshot } from './linkedProduct.js'
import { readProductLink } from './productImport.js'
import { WEB_AI_DISABLED, postWebAi } from './config.js'

export function importHandlers() {
  return window.location.protocol === 'coolcart:' ? window.webkit?.messageHandlers : null
}

export function hasCartLookup() {
  if (WEB_AI_DISABLED) return false
  const handlers = importHandlers()
  return window.location.protocol !== 'coolcart:' || Boolean(handlers?.personalProductImport || handlers?.lookupCartProduct)
}

export async function requestProductImport(input) {
  if (WEB_AI_DISABLED) throw new Error('公开演示可手填或粘贴分享链接。')
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

  const response = await postWebAi('/api/import-product', input, AbortSignal.timeout(35000))
  if (!response.headers.get('content-type')?.includes('application/json')) {
    if (response.status === 413) throw new Error('上传的截图太大，请裁剪商品区域后重试。')
    if (response.status === 429) throw new Error('在线识别已达当前时段上限，请稍后重试。')
    throw new Error('识别服务暂不可用。已保留截图，请重试或手动填写。')
  }
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || '导入失败。')
  return result
}
