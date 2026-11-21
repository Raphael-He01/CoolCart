import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { importHandlers } from './productImportClient.js'
import { readShareInbox } from './sharedCartImports.js'

export const SCREEN_SHOPPING_PHASES = {
  idle: '',
  picking: '请在系统窗口选择共享整个屏幕。',
  starting: '正在启动屏幕共享…',
  running: '已开始识别。请切到购物 App，打开购物车并缓慢滚动。',
  stopping: '正在结束屏幕共享…',
}

function readStatus(result) {
  if (!Object.hasOwn(SCREEN_SHOPPING_PHASES, result?.phase)) {
    throw new Error('未能读取录屏识别状态，请重试。')
  }
  const batch = result.batch ? readShareInbox([result.batch])[0] : null
  return { phase: result.phase, batch, notice: typeof result.notice === 'string' ? result.notice : '' }
}

export function useScreenShopping(onCompleted) {
  // WKWebView 每次读取 messageHandlers 的属性时可能返回不同的代理对象。
  const [bridge] = useState(() => importHandlers()?.screenShopping)
  const [status, setStatus] = useState({ phase: 'idle', batch: null, notice: '' })
  const [pending, setPending] = useState('')
  const [error, setError] = useState(null)
  const [summary, setSummary] = useState(null)
  const action = useRef('')
  const revision = useRef(0)
  const consume = useEffectEvent((batch) => onCompleted(batch))

  useEffect(() => {
    if (!bridge) return
    let disposed = false
    let polling = false
    async function refresh() {
      if (document.hidden || polling || action.current) return
      polling = true
      const before = revision.current
      try {
        const next = readStatus(await bridge.postMessage({ action: 'status' }))
        if (disposed || before !== revision.current) return
        setStatus((previous) => previous.phase === next.phase && previous.notice === next.notice
          && previous.batch?.id === next.batch?.id ? previous : next)
        setError((current) => current?.action === 'status' ? null : current)
        if (next.batch) {
          const result = consume(next.batch)
          if (result === false) return
          if (result) setSummary(result)
          await bridge.postMessage({ action: 'acknowledge', id: next.batch.id })
          if (!disposed && before === revision.current) setStatus({ ...next, batch: null })
        }
      } catch (failure) {
        if (!disposed && before === revision.current) {
          setError((current) => current || { action: 'status', message: failure?.message || '无法读取本机录屏识别状态。' })
        }
      } finally {
        polling = false
      }
    }
    const initial = window.setTimeout(refresh, 0)
    const timer = window.setInterval(refresh, 1200)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      disposed = true
      window.clearTimeout(initial)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [bridge])

  async function send(command) {
    // 关闭始终可打断正在启动的识别。旧的启动回复和轮询不会再覆盖关闭状态。
    if (action.current && (command !== 'stop' || action.current === 'stop')) return
    const current = ++revision.current
    action.current = command
    setPending(command)
    setError(null)
    if (command === 'start') setSummary(null)
    try {
      const next = readStatus(await bridge.postMessage({ action: command }))
      if (current === revision.current) setStatus(next)
    } catch (failure) {
      if (current === revision.current) {
        setError({ action: command, message: failure?.message || '本机录屏操作失败，请重试。' })
      }
    } finally {
      if (current === revision.current) {
        action.current = ''
        setPending('')
      }
    }
  }

  return bridge ? { status, pending, error, summary, send } : null
}
