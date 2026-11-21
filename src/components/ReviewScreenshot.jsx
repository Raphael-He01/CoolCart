import { useId, useMemo, useRef, useState } from 'react'
import { reviewScreenshotUrl } from '../lib/capturedCartItems.js'

export default function ReviewScreenshot({ item }) {
  const dialog = useRef(null)
  const title = useId()
  const [failed, setFailed] = useState('')
  const url = useMemo(() => reviewScreenshotUrl(item), [item])
  if (!url || failed === url) return null

  return (
    <div className="review-screenshot">
      <button className="review-screenshot-button" type="button" aria-haspopup="dialog"
        aria-label={`放大截图局部 · ${item.name}`} onClick={() => dialog.current.showModal()}>
        <img src={url} alt="" loading="lazy" onError={() => setFailed(url)} />
        <span>放大截图局部</span>
      </button>
      <dialog ref={dialog} className="pixel-frame confirm-dialog screenshot-dialog" aria-labelledby={title}>
        <h3 className="panel-heading" id={title}>原截屏商品局部</h3>
        <div className="panel-content field-stack">
          <p>{item.name}</p>
          <img src={url} alt={item.name + ' 的原截屏局部'} loading="lazy" />
          <button className="btn ghost" type="button" onClick={() => dialog.current.close()}>关闭预览</button>
        </div>
      </dialog>
    </div>
  )
}
