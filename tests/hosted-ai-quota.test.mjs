import assert from 'node:assert/strict'
import test from 'node:test'
import hostedImport, { importProduct } from '../api/import-product.js'
import hostedReview, { handlePurchaseReview } from '../api/purchase-review.js'
import { AiQuotaError, requireHostedAiQuota } from '../server/aiQuota.js'
import { Readable } from 'node:stream'

const env = {
  VERCEL: '1',
  UPSTASH_REDIS_REST_URL: 'https://quota.example.invalid',
  UPSTASH_REDIS_REST_TOKEN: 'fixture',
  COOLCART_AI_HOURLY_LIMIT: '16',
  COOLCART_AI_PER_IP_HOURLY_LIMIT: '4',
}

const now = 3_615_000

test('团队端点共用按小时的全局与匿名客户端配额，配额存储不接收原始 IP', async () => {
  const commands = []
  const request = async (url, options) => {
    assert.equal(url.href, 'https://quota.example.invalid/')
    assert.equal(options.redirect, 'error')
    commands.push(JSON.parse(options.body))
    return { ok: true, json: async () => ({ result: commands.length === 3 ? 0 : 1 }) }
  }
  const first = { headers: { 'x-vercel-forwarded-for': '192.0.2.1' } }
  const second = { headers: { 'x-vercel-forwarded-for': '192.0.2.2' } }
  await requireHostedAiQuota(first, { env, now, request })
  await requireHostedAiQuota(second, { env, now, request })
  await assert.rejects(requireHostedAiQuota(first, { env, now, request }),
    (error) => error.status === 429 && error.retryAfter === 3585)
  const [command, , keys, globalKey, clientKey, total, perClient, ttl] = commands[0]
  assert.equal(command, 'EVAL')
  assert.equal(keys, 2)
  assert.equal(globalKey, commands[1][3])
  assert.equal(clientKey, commands[2][4])
  assert.notEqual(clientKey, commands[1][4])
  assert.ok(!clientKey.includes('192.0.2.1'))
  assert.deepEqual([total, perClient, ttl], [16, 4, 3645])
})

test('托管模式在配额配置错误或服务不可达时停止调用付费模型', async () => {
  await assert.rejects(requireHostedAiQuota({}, { env: {}, now, request: assert.fail }),
    (error) => error.status === 503)
  await assert.rejects(requireHostedAiQuota({}, {
    env, now, request: async () => ({ ok: true, json: async () => ({ result: 'unexpected' }) }),
  }), (error) => error.status === 503)
  const authorize = async () => { throw new AiQuotaError(429, '上限', 60) }
  await assert.rejects(importProduct({ query: '罗技 M185' }, { apiKey: 'fixture', request: assert.fail, authorize }),
    (error) => error.status === 429)
  await assert.rejects(importProduct({ image: 'invalid' }, { apiKey: 'fixture', request: assert.fail, authorize: assert.fail }),
    (error) => error.status === 400)

  const req = Readable.from([JSON.stringify({ phase: 'questions', product: { name: '鼠标' } })])
  req.method = 'POST'
  const headers = new Map()
  const res = { setHeader: (key, value) => headers.set(key, value), end: () => {} }
  await handlePurchaseReview(req, res, 'fixture', assert.fail, authorize)
  assert.equal(res.statusCode, 429)
  assert.equal(headers.get('Retry-After'), 60)
})

test('两个生产入口在配额存储断开时给出可安全回退的 503', async (context) => {
  const configured = { ...env, DEEPSEEK_API_KEY: 'test-provider-secret' }
  for (const [key, value] of Object.entries(configured)) {
    const original = process.env[key]
    process.env[key] = value
    context.after(() => {
      if (original === undefined) delete process.env[key]
      else process.env[key] = original
    })
  }
  const request = context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.hostname, 'quota.example.invalid')
    assert.ok(options.signal instanceof AbortSignal)
    throw new Error('quota backend internal traceback')
  })
  for (const [handler, body] of [
    [hostedImport, { query: '罗技 M185' }],
    [hostedReview, { phase: 'questions', product: { name: '鼠标' } }],
  ]) {
    const req = { method: 'POST', headers: {}, body }
    let message
    const res = { setHeader: () => {}, end: (result) => { message = JSON.parse(result).message } }
    await handler(req, res)
    assert.equal(res.statusCode, 503)
    assert.match(message, /手填/)
    assert.doesNotMatch(message, /secret|traceback/)
  }
  assert.equal(request.mock.callCount(), 2)
})
