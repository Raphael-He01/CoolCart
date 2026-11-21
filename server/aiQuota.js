import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'

const WINDOW_SECONDS = 3600
const TAKE_QUOTA = `
local globalCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local clientCount = tonumber(redis.call('GET', KEYS[2]) or '0')
if globalCount >= tonumber(ARGV[1]) or clientCount >= tonumber(ARGV[2]) then return 0 end
for _, key in ipairs(KEYS) do
  if redis.call('INCR', key) == 1 then redis.call('EXPIRE', key, ARGV[3]) end
end
return 1
`

export class AiQuotaError extends Error {
  constructor(status, message, retryAfter) {
    super(message)
    this.status = status
    this.retryAfter = retryAfter
  }
}

function hourlyLimit(raw, fallback) {
  const count = raw?.trim() ? Number(raw) : fallback
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid AI limit')
  return count
}

function clientAddress(req, env) {
  const forwarded = env.VERCEL === '1' ? req.headers?.['x-vercel-forwarded-for'] : null
  const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : ''
  return isIP(ip) ? ip : req.socket?.remoteAddress || 'unknown'
}

// Hosted functions share the same atomic budget. Vite's local handlers do not use this guard.
export async function requireHostedAiQuota(req, { env = process.env, request = fetch, now = Date.now() } = {}) {
  let allowed
  const second = Math.floor(now / 1000)
  const retryAfter = WINDOW_SECONDS - second % WINDOW_SECONDS

  try {
    const token = env.UPSTASH_REDIS_REST_TOKEN?.trim()
    const url = new URL(env.UPSTASH_REDIS_REST_URL)
    if (!token || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('Missing or invalid quota store configuration')
    }
    const total = hourlyLimit(env.COOLCART_AI_HOURLY_LIMIT, 200)
    const perClient = hourlyLimit(env.COOLCART_AI_PER_IP_HOURLY_LIMIT, 30)
    const client = createHmac('sha256', token).update(clientAddress(req, env)).digest('hex')
    const window = '{coolcart-ai}:' + Math.floor(second / WINDOW_SECONDS)
    const response = await request(url, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(['EVAL', TAKE_QUOTA, 2, window + ':all', window + ':' + client, total, perClient, retryAfter + 60]),
      signal: AbortSignal.timeout(2500),
    })
    if (!response.ok) throw new Error('Quota store unavailable')
    const reply = await response.json()
    allowed = reply.result
    if (allowed !== 0 && allowed !== 1) throw new Error('Invalid quota response')
  } catch {
    throw new AiQuotaError(503, '团队在线服务暂不可用，可继续手填商品和使用本地问答。')
  }

  if (!allowed) throw new AiQuotaError(429, '团队在线请求已达当前时段上限，请稍后再试。', retryAfter)
}
