import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import CartCaptureSummary from './CartCaptureSummary.jsx'
import ImportStatus from './ImportStatus.jsx'
import { CART_PLATFORMS, readCartItems } from '../lib/capturedCartItems.js'
import { prepareScreenshot } from '../lib/prepareScreenshot.js'
import { IMAGE_TYPES } from '../lib/productImport.js'
import { requestProductImport } from '../lib/productImportClient.js'
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
    if (!bridge) return
    const showPreview = ({ detail }) => {
      if (!inFlight.current || detail?.requestId !== inFlight.current.id) return
      inFlight.current.receivedImage = true
      setPhase('recognizing')
      setPreview(detail.preview?.startsWith('data:image/jpeg;base64,') ? detail.preview : '')
      setSummary(null)
    }
    window.addEventListener('coolcart:cart-screenshot-ready', showPreview)
    return () => window.removeEventListener('coolcart:cart-screenshot-ready', showPreview)
  }, [bridge])

  useLayoutEffect(() => {
    if (previousTop.current === null) return
    const delta = resultAnchor.current.getBoundingClientRect().top - previousTop.current
    previousTop.current = null
    if (delta) window.scrollBy(0, delta)
  }, [summary])

  async function loadWebImage(file) {
    if (busy || inFlight.current || !file) return
    inFlight.current = {}
    setBusy(true)
    setPhase('reading')
    setError('')
    setSummary(null)
    setPreview('')
    try {
      setPreview(await prepareScreenshot(file))
    } catch (failure) {
      setError(failure?.message || '截图读取失败，请重新选择。')
    } finally {
      inFlight.current = null
      setPhase('idle')
      setBusy(false)
    }
  }

  async function pick() {
    if (busy || inFlight.current || (!bridge && !preview)) return
    const request = { id: newId(), receivedImage: !bridge }
    inFlight.current = request
    setBusy(true)
    setPhase(bridge ? 'selecting' : 'recognizing')
    setError('')
    try {
      const start = performance.now()
      const result = bridge
        ? await bridge.postMessage({ action: 'pick', requestId: request.id })
        : await requestProductImport({ cartImage: preview })
      if (result?.status === 'cancelled') return
      if (bridge && result?.status !== 'recognized') throw new Error('未能读取截屏识别结果，请重试。')
      const items = readCartItems(result?.items)
      // Imported rows can appear above this panel on narrow screens.
      const anchor = resultAnchor.current
      const rect = anchor?.getBoundingClientRect()
      if (rect?.height > 0 && anchor.closest('details')?.open && rect.bottom > 0 && rect.top < window.innerHeight) previousTop.current = rect.top
      if (!request.receivedImage) setPreview('')
      const durationMs = bridge ? result.durationMs : performance.now() - start
      setSummary({ ...onImportCart(items, 'screenshot', platform), count: items.length, durationMs })
    } catch (failure) {
      setSummary(null)
      if (!request.receivedImage) setPreview('')
      setError(failure?.message || (typeof failure === 'string' && failure) || '识别暂时失败，请重新选择购物车截屏。')
    } finally {
      inFlight.current = null
      setPhase('idle')
      setBusy(false)
    }
  }

  const pendingTitle = { selecting: '正在选择购物车截屏', reading: '正在读取购物车截屏', recognizing: '正在识别购物车商品' }[phase]

  return <details className="import-disclosure">
    <summary id={title}>购物车截屏识别</summary>
    <div className="field-stack" role="group" aria-labelledby={title}>
      <p className="muted small">选择包含完整商品行的购物车截屏，批量识别商品。
        {!bridge && '支持 20 MB 以内的 PNG、JPEG、WebP。确认识别时会把截屏发送给 DeepSeek，请先裁去姓名、地址和手机号。'}</p>
      <label>来源平台
        <select value={platform} disabled={busy || pending} onChange={(event) => setPlatform(event.target.value)}>
          <option value="">自动识别</option>
          {CART_PLATFORMS.map((name) => <option key={name}>{name}</option>)}
        </select>
      </label>
      {bridge ? <button type="button" className="btn secondary" disabled={busy || pending} onClick={pick}>选择购物车截屏</button>
        : <label className="import-file-picker">
          <span className="btn secondary" aria-hidden="true">选择购物车截屏</span>
          <input type="file" accept={IMAGE_TYPES.join(',')} disabled={busy || pending}
            aria-label="选择购物车截屏" onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              void loadWebImage(file)
            }} />
        </label>}
      {(pending || summary || error || (!bridge && preview)) && <div ref={resultAnchor} className="field-stack cart-capture-feedback">
        {preview && <figure className="screenshot-preview"><img src={preview} alt="已选购物车截屏" /></figure>}
        {pending ? <ImportStatus tone="working" title={pendingTitle}
          detail={phase === 'recognizing' ? (bridge ? '正在本机读取商品名称、规格和单价。' : '正在用 DeepSeek 读取商品名称、规格和单价。') : undefined} />
          : error ? <ImportStatus tone="error" title="购物车截屏未能识别" detail={error} />
          : summary ? <CartCaptureSummary title="已识别" result={summary} />
          : <ImportStatus title="购物车截屏已就绪" detail="核对预览后开始识别。" />}
      </div>}
      {!bridge && preview && <button type="button" className="btn primary" disabled={busy || pending}
        onClick={pick}>识别购物车商品</button>}
      {canShare && <p className="muted small">也可从截屏预览或相册点「共享 → CoolCart」。</p>}
    </div>
  </details>
}
