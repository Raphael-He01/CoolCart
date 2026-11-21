import { MAX_IMAGE_BYTES, productQuery, readProductLink } from '../src/lib/productImport.js'
import { importCapturedProductLink, importCartScreenshot, importLinkedProduct, importNamedProduct, importScreenshot } from '../src/lib/linkedProduct.js'
import { cartLinkInput } from '../src/lib/cartProductLinks.js'
import { publicReferenceUrl } from '../src/lib/screenshotSources.js'
import { ScreenshotImageError, validateScreenshotDataUrl } from '../src/lib/screenshotImage.js'
import { AiQuotaError, requireHostedAiQuota } from '../server/aiQuota.js'

const MAX_BODY = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4096

class ImportError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function makePost(apiKey, request, signal) {
  return async function post(path, body) {
    const response = await request(`https://api.deepseek.com${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) {
      if ([401, 402, 429].includes(response.status)) {
        throw new ImportError(503, 'DeepSeek 服务暂不可用，请检查服务端密钥、额度或稍后重试。')
      }
      if (path === '/v1/tools/fetch' && [403, 404].includes(response.status)) return null
      throw new Error(`DeepSeek HTTP ${response.status}`)
    }
    return response.json()
  }
}

const MAX_PUBLIC_HTML_BYTES = 1024 * 1024

async function readPublicHtmlPage(link, request, signal) {
  const canonical = readProductLink(link.url)
  const jdPage = canonical?.url === link.url && (canonical.itemId || canonical.pageToken)
    && (new URL(canonical.url).origin === 'https://item.jd.com' || /^https:\/\/item\.m\.jd\.com\/product\/\d+\.html$/u.test(canonical.url))
  if (!jdPage && (!link.url || publicReferenceUrl(link.url) !== link.url)) return null
  const response = await request(link.url, {
    method: 'GET', redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer',
    headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN' },
    signal: AbortSignal.any([AbortSignal.timeout(5000), signal]),
  })
  const type = response.headers?.get('Content-Type') ?? ''
  if (!response.ok || !/^text\/html\b|^application\/xhtml\+xml\b/iu.test(type)
    || Number(response.headers.get('Content-Length')) > MAX_PUBLIC_HTML_BYTES) {
    await response.body?.cancel()
    return null
  }
  const reader = response.body?.getReader()
  if (!reader) return null
  const decoder = new TextDecoder(type.match(/charset=["']?([\w-]+)/iu)?.[1] ?? 'utf-8')
  let html = '', bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return html + decoder.decode()
      bytes += value.byteLength
      if (bytes > MAX_PUBLIC_HTML_BYTES) {
        await reader.cancel()
        return null
      }
      html += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}

export async function importProduct(input, { apiKey, request = fetch, readPublicHtml, authorize } = {}) {
  const image = input?.image
  const cartImage = input?.cartImage
  const link = readProductLink(input?.link)
  const query = productQuery(input?.query)
  const captured = cartLinkInput(input?.cartProduct)
  if ([image, cartImage, input?.link, input?.query, input?.cartProduct].filter((value) => value != null).length !== 1
    || (!image && cartImage == null && !link && !query && !captured)) {
    if (input?.cartProduct != null) throw new ImportError(400, '请单独提交要查找的购物车商品，并核对名称、规格和来源平台。')
    throw new ImportError(400, '请单独输入 2 至 160 字的商品名称或型号、上传一张截图，或粘贴支持的商品链接。')
  }
  if (!apiKey) {
    if (image || cartImage != null) validateScreenshotDataUrl(cartImage ?? image)
    throw new ImportError(503, '尚未配置 DeepSeek。你可以手动补填商品信息。')
  }
  if (!image && cartImage == null && authorize) await authorize()
  const signal = AbortSignal.timeout(26000)
  const post = makePost(apiKey, request, signal)
  const readPage = readPublicHtml ?? ((product) => readPublicHtmlPage(product, request, signal))
  if (link) return importLinkedProduct(link, post, readPage)
  if (query) return importNamedProduct(query, post, readPage)
  if (captured) return importCapturedProductLink(captured, post, readPage)
  if (cartImage != null) return { items: await importCartScreenshot(cartImage, post, authorize) }
  const result = await importScreenshot(image, post, readPage, authorize)
  if (!result) throw new ImportError(422, '请裁剪到只包含一件商品，并保留清晰的商品名称。')
  return result
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body
  }
  if (req.body) {
    if (Buffer.byteLength(req.body) > MAX_BODY) throw new ImportError(413, '截图太大，请裁剪后重试。')
    return decodeJson(req.body)
  }
  let length = 0
  const chunks = []
  for await (const chunk of req) {
    length += chunk.length
    if (length > MAX_BODY) throw new ImportError(413, '截图太大，请裁剪后重试。')
    chunks.push(chunk)
  }
  return decodeJson(Buffer.concat(chunks).toString('utf8'))
}

function decodeJson(body) {
  try {
    return JSON.parse(body)
  } catch {
    throw new ImportError(400, '识别请求格式不正确。')
  }
}

export async function handleProductImport(req, res, apiKey, authorize) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      throw new ImportError(405, '请使用 POST 导入商品。')
    }
    if (Number(req.headers['content-length']) > MAX_BODY) throw new ImportError(413, '截图太大，请裁剪后重试。')
    const item = await importProduct(await parseBody(req), { apiKey, authorize })
    res.end(JSON.stringify(item))
  } catch (error) {
    const known = error instanceof ImportError || error instanceof ScreenshotImageError || error instanceof AiQuotaError
    if (error instanceof AiQuotaError && error.retryAfter) res.setHeader('Retry-After', error.retryAfter)
    res.statusCode = known ? error.status : 502
    const message = known ? error.message : '识别或查价暂时失败，请重试或手动填写。'
    res.end(JSON.stringify({ message }))
  }
}

export default function handler(req, res) {
  return handleProductImport(req, res, process.env.DEEPSEEK_API_KEY, () => requireHostedAiQuota(req))
}
