import { useEffect, useId, useRef, useState } from 'react'
import { PEEK_PENALTY_CAP_MS, PEEK_PENALTY_MS, TAP_CHALLENGE_MS, TAP_CHALLENGE_TARGET } from '../lib/config.js'
import { fmtShort } from '../lib/convert.js'
import './TapChallenge.css'

const TAPS_PER_JUMP = 4
const START = [0.5, 0.5]
const TARGET_SPOTS = [
  [0.08, 0.08], [0.5, 0.08], [0.92, 0.08],
  [0.08, 0.5], [0.92, 0.5],
  [0.08, 0.92], [0.5, 0.92], [0.92, 0.92],
]

function nextSpot([x, y]) {
  // Favor nearby positions. A player can cross the arena over several jumps.
  const nearby = TARGET_SPOTS.filter(([nextX, nextY]) => {
    const distance = Math.hypot(nextX - x, nextY - y)
    return distance > 0 && distance < 0.65
  })
  return nearby[Math.floor(Math.random() * nearby.length)]
}

export default function TapChallenge({ item, onResolve, onDismiss }) {
  const title = useId()
  const dialog = useRef(null)
  const focusButton = useRef(null)
  const active = useRef(null)
  const interval = useRef(null)
  const [phase, setPhase] = useState('rules')
  const [taps, setTaps] = useState(0)
  const [seconds, setSeconds] = useState(TAP_CHALLENGE_MS / 1000)
  const [result, setResult] = useState(null)
  const [fixedTarget, setFixedTarget] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [target, setTarget] = useState({ spot: START, previous: null, jump: 0 })

  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => {
      clearInterval(interval.current)
      element.close()
    }
  }, [])

  useEffect(() => {
    focusButton.current?.focus({ preventScroll: true })
  }, [phase])

  function finish() {
    const round = active.current
    if (!round) return
    active.current = null
    clearInterval(interval.current)
    const outcome = onResolve(round)
    const won = round.taps >= TAP_CHALLENGE_TARGET
    const completed = won && round.cooldownEndsAt + outcome.delta <= Date.now()
    setResult({ ...outcome, won, completed })
    setPhase('result')
  }

  function begin() {
    if (active.current) return
    const { cooldownEndsAt } = item
    if (Date.now() >= cooldownEndsAt) {
      setResult({ expired: true })
      setPhase('result')
      return
    }
    const end = performance.now() + TAP_CHALLENGE_MS
    active.current = { end, taps: 0, cooldownEndsAt, peeks: item.peeks ?? 0 }
    setPhase('playing')
    interval.current = setInterval(() => {
      const left = end - performance.now()
      if (left <= 0 || Date.now() >= cooldownEndsAt) finish()
      else setSeconds(Math.ceil(left / 1000))
    }, 50)
  }

  function tap() {
    const round = active.current
    if (!round) return
    if (performance.now() >= round.end || Date.now() >= round.cooldownEndsAt) return finish()
    round.taps++
    setTaps(round.taps)
    if (round.taps === TAP_CHALLENGE_TARGET) finish()
    else if (!fixedTarget && round.taps % TAPS_PER_JUMP === 0) {
      const spot = nextSpot(target.spot)
      setTarget({ spot, previous: target.spot, jump: round.taps })
    }
  }

  const amount = fmtShort(PEEK_PENALTY_MS)
  let feedback = ''
  if (result?.expired) feedback = '冷静期已结束，可以继续。'
  else if (result?.stale) feedback = '冷静时间已更新，请查看当前倒计时。'
  else if (result?.completed) feedback = '挑战成功，冷静期已结束，可以继续。'
  else if (result?.won) feedback = '挑战成功，冷静时间缩短 ' + fmtShort(-result.delta) + '。'
  else if (result?.delta > 0) feedback = '未达到目标，冷静时间增加 ' + fmtShort(result.delta) + '。'
  else if (result) feedback = '未达到目标，累计加时已达上限。'

  return <dialog ref={dialog} className={'pixel-frame confirm-dialog tap-dialog' + (phase === 'playing' ? ' tap-dialog-arena' : '')} aria-labelledby={title} onCancel={(event) => {
    event.preventDefault()
    if (active.current) finish()
    else onDismiss()
  }}>
    <header className="tap-heading">
      <h2 className="panel-heading" id={title}>手速大战</h2>
      <span aria-hidden="true" className="tap-heading-caption">TAP RUSH</span>
    </header>
    {phase === 'rules' && <div className="panel-content field-stack">
      <p>{TAP_CHALLENGE_MS / 1000} 秒内连点 {TAP_CHALLENGE_TARGET} 次。达标最多减 {amount}，失败加 {amount}。</p>
      <p className="muted small">{fixedTarget ? '本轮按钮固定在屏幕中央。' : `每点中 ${TAPS_PER_JUMP} 次，按钮会跳到新位置。`}</p>
      <label className="tap-fixed-option">
        <input type="checkbox" checked={fixedTarget} onChange={(event) => setFixedTarget(event.target.checked)} />
        固定位置模式
      </label>
      <p className="muted small">累计加时上限 {fmtShort(PEEK_PENALTY_CAP_MS)}。</p>
      <button ref={focusButton} type="button" className="btn primary full-action" onClick={begin}>开始挑战</button>
      <button type="button" className="btn ghost" onClick={onDismiss}>继续等待</button>
    </div>}
    {phase === 'playing' && <>
      <div className="tap-hud">
        <p className="tap-score">
          <span role="timer" aria-label="挑战剩余时间">{seconds} 秒</span>
          <span>{taps} / {TAP_CHALLENGE_TARGET} 次</span>
        </p>
        <progress className="tap-progress" value={taps} max={TAP_CHALLENGE_TARGET} aria-label="连点进度" />
      </div>
      <div className="tap-arena">
        {target.previous && <span key={target.jump} className="tap-echo" aria-hidden="true"
          style={{ '--tap-x': target.previous[0], '--tap-y': target.previous[1] }} />}
        <button ref={focusButton} type="button" className="btn primary tap-target" onClick={tap}
          style={{ '--tap-x': target.spot[0], '--tap-y': target.spot[1] }}
          onKeyDown={(event) => { if (event.repeat && ['Enter', ' '].includes(event.key)) event.preventDefault() }}>
          连点
        </button>
      </div>
    </>}
    {phase === 'result' && <div className="panel-content field-stack">
      <p className="notice" role="status">{feedback}</p>
      <button ref={focusButton} type="button" className="btn primary full-action" onClick={onDismiss}>关闭挑战</button>
    </div>}
  </dialog>
}
