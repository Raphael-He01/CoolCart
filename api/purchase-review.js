import { ReviewInputError, reviewPurchase } from '../src/lib/purchaseReview.js'
import { AiQuotaError, requireHostedAiQuota } from '../server/aiQuota.js'

const MAX_BODY = 16 * 1024

class ReviewServiceError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    if (Buffer.byteLength(JSON.stringify(req.body)) <= MAX_BODY) return req.body
    throw new ReviewServiceError(413, '问答内容过长。')
  }
  if (req.body != null && typeof req.body !== 'string' && !Buffer.isBuffer(req.body)) {
    throw new ReviewInputError('问答请求格式不正确。')
  }
  let length = 0
  const chunks = []
  const stream = req.body == null ? req.iterator({ destroyOnReturn: false }) : [req.body]
  for await (const chunk of stream) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += data.length
    if (length > MAX_BODY) throw new ReviewServiceError(413, '问答内容过长。')
    chunks.push(data)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ReviewInputError('问答请求格式不正确。')
  }
}

export async function handlePurchaseReview(req, res, apiKey, request = fetch, authorize) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      throw new ReviewServiceError(405, '请使用 POST 发起购买问答。')
    }
    if (Number(req.headers?.['content-length']) > MAX_BODY) throw new ReviewServiceError(413, '问答内容过长。')
    const input = await readBody(req)
    const result = await reviewPurchase(input, async (path, body) => {
      if (!apiKey?.trim()) throw new ReviewServiceError(503, '服务端尚未配置 DeepSeek。')
      if (authorize) await authorize()
      const response = await request(`https://api.deepseek.com${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        redirect: 'manual',
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
      })
      if ([401, 402, 429].includes(response.status)) {
        throw new ReviewServiceError(503, 'DeepSeek 暂不可用，请检查服务端密钥或额度，或稍后重试。')
      }
      if (!response.ok) throw new Error('DeepSeek 问答请求失败。')
      return response.json()
    })
    res.end(JSON.stringify(result))
  } catch (error) {
    if (error instanceof AiQuotaError && error.retryAfter) res.setHeader('Retry-After', error.retryAfter)
    const status = error instanceof ReviewServiceError || error instanceof AiQuotaError ? error.status
      : error instanceof ReviewInputError ? 400
        : error?.name === 'TimeoutError' ? 504 : 502
    res.statusCode = status
    const message = status === 504 ? 'DeepSeek 问答超时。'
      : status === 502 ? '暂时无法取得 DeepSeek 问答。' : error.message
    res.end(JSON.stringify({ message }))
  }
}

export default function handler(req, res) {
  return handlePurchaseReview(req, res, process.env.DEEPSEEK_API_KEY, fetch, () => requireHostedAiQuota(req))
}
