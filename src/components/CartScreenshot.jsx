import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import CartCaptureSummary from './CartCaptureSummary.jsx'
import ImportStatus from './ImportStatus.jsx'
import { CART_PLATFORMS, readCartItems } from '../lib/capturedCartItems.js'
import { newId } from '../lib/storage.js'

export default function CartScreenshot({ bridge, busy, setBusy, onImportCart, canShare }) {
  const title = useId()
  const inFlight = useRef(null)
  const resultAnchor = useRef(null)
  const previousTop = useRef(null)
  const [phase, setPhase] = useState('idle')
  const [preview, setPreview] = useState('')
  const pending = phase !== 'idle'
  const [error, setError] = useState('')
  const [platform, setPlatform] = useState('')
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    const showPreview = ({ detail }) => {
      if (!inFlight.current || detail?.requestId !== inFlight.current.id) return
      inFlight.current.receivedImage = true
      setPhase('recognizing')
      setPreview(detail.preview?.startsWith('data:image/jpeg;base64,') ? detail.preview : '')
      setSummary(null)
    }
    window.addEventListener('coolcart:cart-screenshot-ready', showPreview)
    return () => window.removeEventListener('coolcart:cart-screenshot-ready', showPreview)
  }, [])

  useLayoutEffect(() => {
    if (previousTop.current === null) return
    const delta = resultAnchor.current.getBoundingClientRect().top - previousTop.current
    previousTop.current = null
    if (delta) window.scrollBy(0, delta)
  }, [summary])

  async function pick() {
    if (busy || inFlight.current) return
    const request = { id: newId(), receivedImage: false }
    inFlight.current = request
    setBusy(true)
    setPhase('selecting')
    setError('')
    try {
      const result = await bridge.postMessage({ action: 'pick', requestId: request.id })
      if (result?.status === 'cancelled') return
      if (result?.status !== 'recognized') throw new Error('未能读取截屏识别结果，请重试。')
      const items = readCartItems(result.items)
      // Imported rows can appear above this panel on narrow screens.
      const anchor = resultAnchor.current
      const rect = anchor?.getBoundingClientRect()
      if (rect?.height > 0 && anchor.closest('details')?.open && rect.bottom > 0 && rect.top < window.innerHeight) previousTop.current = rect.top
      if (!request.receivedImage) setPreview('')
      setSummary({ ...onImportCart(items, 'screenshot', platform), count: items.length, durationMs: result.durationMs })
    } catch (failure) {
      setSummary(null)
      if (!request.receivedImage) setPreview('')
      setError(failure?.message || (typeof failure === 'string' && failure) || '本机识别暂时失败，请重新选择购物车截屏。')
    } finally {
      inFlight.current = null
      setPhase('idle')
      setBusy(false)
    }
  }

  return <details className="import-disclosure">
    <summary id={title}>购物车截屏识别</summary>
    <div className="field-stack" role="group" aria-labelledby={title}>
      <p className="muted small">选择包含完整商品行的购物车截屏，批量识别商品。</p>
      <label>来源平台
        <select value={platform} disabled={busy || pending} onChange={(event) => setPlatform(event.target.value)}>
          <option value="">自动识别</option>
          {CART_PLATFORMS.map((name) => <option key={name}>{name}</option>)}
        </select>
      </label>
      <button type="button" className="btn secondary" disabled={busy || pending} onClick={pick}>选择购物车截屏</button>
      {(pending || summary || error) && <div ref={resultAnchor} className="field-stack cart-capture-feedback">
        {preview && <figure className="screenshot-preview"><img src={preview} alt="已选购物车截屏" /></figure>}
        {pending ? <ImportStatus tone="working" title={phase === 'recognizing' ? '正在识别购物车商品' : '正在选择购物车截屏'}
          detail={phase === 'recognizing' ? '正在本机读取商品名称、规格和单价。' : undefined} />
          : error ? <ImportStatus tone="error" title="购物车截屏未能识别" detail={error} />
          : <CartCaptureSummary title="已识别" result={summary} />}
      </div>}
      {canShare && <p className="muted small">也可从截屏预览或相册点「共享 → CoolCart」。</p>}
    </div>
  </details>
}
