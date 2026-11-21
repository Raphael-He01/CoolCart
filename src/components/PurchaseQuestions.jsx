import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { reviewPurchase } from '../lib/purchaseReview.js'
import { STATIC_WEB_DEMO } from '../lib/config.js'

async function requestReview(input, signal) {
  if (STATIC_WEB_DEMO) throw new Error('公开演示使用内置问答。')
  if (window.location.protocol === 'coolcart:') {
    const handlers = window.webkit?.messageHandlers
    if (!handlers?.personalProductImport && !handlers?.purchaseReview) throw new Error('离线版未配置 DeepSeek')
    if (signal.aborted) throw signal.reason
    const request = handlers.personalProductImport
      ? reviewPurchase(input, (path, body) => handlers.personalProductImport.postMessage({ path, body }))
      : handlers.purchaseReview.postMessage(input)
    // WebKit 的桥接请求不接受 AbortSignal。页面仍须在超时后允许继续。
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }
  const response = await fetch('/api/purchase-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) throw new Error('DeepSeek 暂时不可用')
  return response.json()
}

function productForReview({ name, category, variant, price }) {
  return { name, category: category || '', variant: variant || '', ...(Number.isFinite(price) && { price }) }
}

const offlineQuestions = [
  '你准备在什么具体场景使用它，手头的东西能解决同样的问题吗？',
  '这笔开销会挤掉哪项更重要的支出，你打算怎么安排？',
]

function hasQuestions(review) {
  return Array.isArray(review?.questions) && review.questions.length === 2
}

function answersFor(item) {
  const answers = item.purchaseReview?.answers
  return [String(answers?.[0] ?? (item.reasonDraft || item.reason || '')).slice(0, 500),
    String(answers?.[1] ?? '').slice(0, 500)]
}

export default function PurchaseQuestions({ item, onUpdate }) {
  const loaded = hasQuestions(item.purchaseReview)
  const review = loaded ? item.purchaseReview : { questions: offlineQuestions, productType: item.category || '', questionsSource: 'offline' }
  const draft = answersFor(item)
  const pendingQuestions = useRef(null)
  const pinned = useRef(false)
  const reminderRequest = useRef(null)
  const composing = useRef(-1)
  const [composition, setComposition] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const startQuestions = useEffectEvent(async () => {
    const product = productForReview(item)
    let questions, productType, questionsSource
    try {
      ({ questions, productType } = await requestReview({ phase: 'questions', product }, AbortSignal.timeout(20000)))
      if (!hasQuestions({ questions }) || !questions.every((question) => typeof question === 'string' && question.trim())) {
        throw new Error('DeepSeek 未返回两个问题')
      }
      questionsSource = 'deepseek'
    } catch {
      questions = offlineQuestions
      productType = item.category || ''
      questionsSource = 'offline'
    }
    return { questions, productType, questionsSource }
  })

  const saveQuestions = useEffectEvent((result) => {
    if (pinned.current) return
    onUpdate((latest) => hasQuestions(latest.purchaseReview) ? {} : {
      purchaseReview: { ...result, answers: answersFor(latest) },
    })
  })

  useEffect(() => {
    if (loaded) return
    // StrictMode 重新执行 effect 时复用当前请求。
    pendingQuestions.current ??= startQuestions()
    let active = true
    pendingQuestions.current.then((result) => { if (active) saveQuestions(result) })
    return () => { active = false }
  }, [loaded])

  useEffect(() => () => reminderRequest.current?.abort(), [])

  function retryQuestions() {
    pendingQuestions.current = null
    pinned.current = false
    onUpdate((latest) => {
      const current = latest.purchaseReview
      if (current?.questionsSource !== 'offline' || answersFor(latest).some((answer) => answer.trim())) return {}
      return { purchaseReview: undefined }
    })
  }

  function pinQuestions() {
    if (loaded || pinned.current) return
    pinned.current = true
    onUpdate((latest) => hasQuestions(latest.purchaseReview) && answersFor(latest).some((answer) => answer.trim()) ? {} : {
      purchaseReview: { ...review, answers: answersFor(latest) },
    })
  }

  function editAnswer(index, value) {
    const answer = value.slice(0, 500)
    if (answer === draft[index]) return
    pinned.current = true
    onUpdate((latest) => {
      const answers = answersFor(latest)
      const saved = latest.purchaseReview
      // Record the first answer against the questions that were visible when
      // typing began, even if a response was saved before React painted it.
      const current = hasQuestions(saved) && answers.some(Boolean) ? saved : review
      if (current.questions.some((question, i) => question !== review.questions[i])) return {}
      answers[index] = answer
      return { purchaseReview: { ...current, answers } }
    })
  }

  async function submit(event) {
    event.preventDefault()
    const answers = draft.map((answer) => answer.trim())
    if (reminderRequest.current || composing.current >= 0 || answers.some((answer) => !answer)) return
    const controller = new AbortController()
    reminderRequest.current = controller
    setSubmitting(true)
    const timeout = AbortSignal.timeout(20000)
    const signal = AbortSignal.any?.([controller.signal, timeout]) ?? timeout
    let reminder, reminderSource
    try {
      ({ reminder } = await requestReview({
        phase: 'reminder',
        product: productForReview(item),
        questions: review.questions,
        answers,
      }, signal))
      if (typeof reminder !== 'string' || !reminder.trim()) throw new Error('DeepSeek 未返回购买提醒')
      reminderSource = 'deepseek'
    } catch {
      reminder = '下单前核对你写下的实际用途与预算，再检查商品规格、到手价和退换条件。仍有疑虑，可以先放一放。'
      reminderSource = 'offline'
    }
    if (controller.signal.aborted) return
    reminderRequest.current = null
    setSubmitting(false)
    onUpdate((latest) => {
      const current = latest.purchaseReview
      if (!hasQuestions(current) || current.questions.some((question, index) => question !== review.questions[index]) ||
        answersFor(latest).some((answer, index) => answer.trim() !== answers[index])) return {}
      return {
        stage: 'final',
        purchaseReview: { ...current, answers, reminder, reminderSource },
      }
    })
  }

  return (
    <form className="add-form purchase-questions" onSubmit={submit} aria-busy={submitting}>
      <p className={'question-status reading-copy small' + (!loaded ? ' motion-busy' : '')} role="status">
        {!loaded ? '正在生成商品专属问题，也可以先作答。'
          : review.questionsSource === 'deepseek' ? 'DeepSeek 识别 · ' + review.productType : '当前使用通用问题。'}
      </p>
      {review.questions.map((question, index) => (
        <label key={index} className="question-card">
          <span className="reading-copy question-prompt">{question}</span>
          <textarea name={'reason-' + (index + 1)} rows={3} required maxLength={500} disabled={submitting}
            inputMode="text" placeholder="点此输入你的理由"
            value={composition?.index === index ? composition.value : draft[index]}
            onCompositionStart={() => {
              composing.current = index
              pinQuestions()
            }}
            onCompositionEnd={(event) => {
              composing.current = -1
              setComposition(null)
              editAnswer(index, event.currentTarget.value)
            }}
            onChange={(event) => {
              const value = event.currentTarget.value
              if (composing.current === index || event.nativeEvent.isComposing) {
                pinQuestions()
                setComposition({ index, value })
              } else editAnswer(index, value)
            }} />
        </label>
      ))}
      {loaded && review.questionsSource === 'offline' && !draft.some((answer) => answer.trim()) &&
        <button className="btn ghost" type="button" onClick={retryQuestions}>重试生成问题</button>}
      <p className="muted small reading-copy">提交后会将商品资料和两项回答发送给 DeepSeek。</p>
      <button className="btn primary full-action" disabled={submitting || draft.some((answer) => !answer.trim())}
        type="submit">{submitting ? '正在生成提醒…' : '提交两项回答'}</button>
      {submitting && <p className="motion-busy" role="status">DeepSeek 正在整理你的回答。</p>}
    </form>
  )
}
