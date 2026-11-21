import { useState } from 'react'
import { beijingPaymentTime } from '../lib/ledger.js'
import { FOLLOW_UP_REASONS, purchaseFollowUpState } from '../lib/purchaseFollowUp.js'

export function FollowUpSummary({ answer }) {
  return <p>使用 {answer.useCount} 次 · 购前理由{FOLLOW_UP_REASONS[answer.reason]}</p>
}

export default function PurchaseFollowUp({ item, now, demo, onSave }) {
  const [saveError, setSaveError] = useState(false)
  const [editing, setEditing] = useState(false)
  const followUp = purchaseFollowUpState(item, now, { demo })
  if (!followUp) return null

  function save(action) {
    const failed = onSave(action) === false
    setSaveError(failed)
    if (!failed) setEditing(false)
  }

  return (
    <section className="import-controls" aria-labelledby="purchase-follow-up-title">
      <h3 id="purchase-follow-up-title">买后一周回访</h3>
      {followUp.status === 'disabled' && <>
        <p className="muted small">开启后，{demo ? '演示付款 10 秒后' : '付款满七天后'}可在购物账本填写回访。</p>
        <button className="btn ghost" type="button" onClick={() => save({ type: 'enable' })}>开启回访</button>
      </>}
      {followUp.status === 'scheduled' && <p className="muted small motion-enter" role="status">
        <time dateTime={new Date(followUp.dueAt).toISOString()}>
          {beijingPaymentTime(followUp.dueAt).replace('T', ' ')}
        </time> 北京时间可填写回访。{followUp.draft && '之前的回答保留为草稿。'}
      </p>}
      {followUp.status === 'due' && <FollowUpForm item={item} initialAnswer={followUp.draft}
        onAnswer={(answer) => save({ type: 'answer', ...answer })} />}
      {followUp.status === 'completed' && <div className="field-stack motion-enter" role="status">
        <strong>已完成回访</strong>
        <FollowUpSummary answer={followUp.answer} />
      </div>}
      {followUp.status === 'completed' && (editing
        ? <FollowUpForm item={item} initialAnswer={followUp.answer}
          onCancel={() => { setEditing(false); setSaveError(false) }}
          onAnswer={(answer) => save({ type: 'correct', ...answer })} />
        : <button className="btn ghost small" type="button" onClick={() => setEditing(true)}>修改回访</button>)}
      {['scheduled', 'due'].includes(followUp.status) && (
        <button className="btn ghost small" type="button" onClick={() => save({ type: 'cancel' })}>取消回访</button>
      )}
      {saveError && <p className="error" role="alert">回访未保存，请查看当前状态后重试。</p>}
    </section>
  )
}

function FollowUpForm({ item, initialAnswer, onAnswer, onCancel }) {
  const [count, setCount] = useState(initialAnswer ? String(initialAnswer.useCount) : '')
  const [reason, setReason] = useState(initialAnswer?.reason ?? '')
  const validCount = /^\d+$/.test(count.trim()) && Number.isSafeInteger(Number(count))
  const prior = item.purchaseReview
  const priorAnswers = Array.isArray(prior?.answers)
    ? prior.answers.filter((answer) => typeof answer === 'string' && answer.trim())
    : []

  function submit(event) {
    event.preventDefault()
    if (validCount && Object.hasOwn(FOLLOW_UP_REASONS, reason)) onAnswer({ useCount: Number(count), reason })
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <label>
        买下后的第一周用了几次？
        <input value={count} inputMode="numeric" placeholder="例如 0 或 3" required
          onChange={(event) => setCount(event.target.value)} />
      </label>
      {count.trim() && !validCount && <p className="error" role="alert">请输入 0 或正整数。</p>}
      {priorAnswers.length > 0 && (
        <details className="import-disclosure">
          <summary>查看当时的购前回答</summary>
          <ul className="follow-up-answers">{priorAnswers.map((answer, index) => <li key={index}>{answer}</li>)}</ul>
        </details>
      )}
      <label>
        当初买它的理由还成立吗？
        <select value={reason} required onChange={(event) => setReason(event.target.value)}>
          <option value="">请选择</option>
          {Object.entries(FOLLOW_UP_REASONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <button className="btn primary full-action" type="submit" disabled={!validCount || !reason}>
        {onCancel ? '保存回访修改' : '保存回访'}
      </button>
      {onCancel && <button className="btn ghost" type="button" onClick={onCancel}>取消修改</button>}
    </form>
  )
}
