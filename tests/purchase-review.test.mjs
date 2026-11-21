import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { handlePurchaseReview } from '../api/purchase-review.js'
import { reviewPurchase } from '../src/lib/purchaseReview.js'

const review = {
  productType: '入耳式有线耳机',
  questions: ['你现在的耳机在哪个场景不能满足需求？', '你常用的设备有没有兼容的接口？'],
}
const reminder = { reminder: '你主要在通勤时使用，而且手机需要转接。付款前确认转接方式是否可用。' }
const product = {
  name: '水月雨星野 3', category: '数码', variant: '示例规格', price: 699,
  link: 'https://item.jd.com/10001.html', reasonDraft: '未提交草稿', paidCents: 12345,
}
const answers = ['通勤时原耳机经常掉。', '手机没有耳机孔，需要转接。']
const questionsInput = { phase: 'questions', product }
const reminderInput = { phase: 'reminder', product, questions: review.questions, answers }
const completion = (value) => ({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] })

test('请求使用同一 DeepSeek 文本桥协议，问题请求只发送商品，提醒持有两问及两答', async () => {
  for (const [input, expected] of [[questionsInput, review], [reminderInput, reminder]]) {
    const result = await reviewPurchase({ ...input, unrelated: '忽略我' }, async (path, body) => {
      assert.equal(path, '/chat/completions')
      assert.equal(body.model, 'deepseek-flash')
      assert.deepEqual(body.thinking, { type: 'disabled' })
      assert.deepEqual(body.response_format, { type: 'json_object' })
      assert.deepEqual(body.messages.map((message) => message.role), ['system', 'user'])
      assert.ok(Buffer.byteLength(body.messages[0].content) <= 4096)
      assert.ok(body.max_tokens <= 650)
      assert.equal(body.temperature, undefined)
      const sent = JSON.parse(body.messages[1].content)
      assert.deepEqual(sent.product, { name: product.name, category: product.category, variant: product.variant, price: product.price })
      assert.deepEqual(sent.answers, input.answers)
      assert.deepEqual(sent.questions, input.questions)
      assert.equal(sent.unrelated, undefined)
      return completion({ ...expected, purchaseUrl: 'https://example.com/fake' })
    })
    assert.deepEqual(result, expected)
  }
})

test('缺少任意一个答案时不调用模型；拒绝重复问题、正文网址和 HTML', async () => {
  for (const invalid of [['有原因', ' '], ['单个原因'], ['先写', '后'.repeat(501)]]) {
    await assert.rejects(reviewPurchase({ ...reminderInput, answers: invalid }, () => assert.fail('Unexpected model call')), /分别回答两个问题/)
  }
  for (const bad of [
    { ...review, questions: ['需要吗？', '需要吗?'] },
    { ...review, questions: ['设备适配吗？预算足够吗？', review.questions[1]] },
    { ...review, questions: ['请打开 https://example.com 吗？', review.questions[1]] },
    { ...review, productType: '<a>数码</a>' },
  ]) {
    await assert.rejects(reviewPurchase(questionsInput, async () => completion(bad)), /内容格式/)
  }
  for (const value of ['www.example.com 下单', '去 example.com 下单', '<a>去下单</a>', '[购买](/go)']) {
    await assert.rejects(reviewPurchase(reminderInput, async () => completion({ reminder: value })), /内容格式/)
  }
})

test('HTTP 处理器执行两个 DeepSeek 请求，无配置、坏请求、超时和限额有状态区分', async (t) => {
  const calls = []
  const mock = async (url, options) => {
    calls.push(url)
    assert.equal(url, 'https://api.deepseek.com/chat/completions')
    assert.equal(options.headers.Authorization, 'Bearer test')
    assert.equal(options.redirect, 'error')
    const data = JSON.parse(JSON.parse(options.body).messages[1].content)
    if (data.product.name === '超时') throw new DOMException('timed out', 'TimeoutError')
    if (data.product.name === '限额') return new Response(null, { status: 429 })
    return Response.json(completion(data.answers ? reminder : review))
  }
  const server = createServer((req, res) => {
    void handlePurchaseReview(req, res, req.url === '/missing' ? '' : 'test', mock)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}`
  const post = (payload, path = '/') => fetch(url + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  for (const [input, expected] of [[questionsInput, review], [reminderInput, reminder]]) {
    const response = await post(input)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.deepEqual(await response.json(), expected)
  }
  const chunked = new ReadableStream({
    start(controller) {
      controller.enqueue(' '.repeat(17000))
      controller.close()
    },
  })
  for (const [response, status] of [
    [await post(questionsInput, '/missing'), 503],
    [await post({ ...reminderInput, answers: [] }), 400],
    [await post({ ...questionsInput, padding: 'a'.repeat(17000) }), 413],
    [await fetch(url, { method: 'POST', body: chunked, duplex: 'half' }), 413],
    [await fetch(url), 405],
    [await post({ ...questionsInput, product: { name: '超时' } }), 504],
    [await post({ ...questionsInput, product: { name: '限额' } }), 503],
  ]) {
    assert.equal(response.status, status)
    assert.ok((await response.json()).message)
  }
  assert.equal(calls.length, 4)
})
