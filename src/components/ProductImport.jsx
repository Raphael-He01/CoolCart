import { useRef, useState } from 'react'
import { WEB_AI_DISABLED } from '../lib/config.js'
import { IMAGE_TYPES, productQuery, readProductLink, readProductLinks } from '../lib/productImport.js'
import { hasCartLookup, importHandlers, requestProductImport } from '../lib/productImportClient.js'
import { prepareScreenshot } from '../lib/prepareScreenshot.js'
import ScreenShopping from './ScreenShopping.jsx'
import CartScreenshot from './CartScreenshot.jsx'
import ImportStatus from './ImportStatus.jsx'
import './ProductImport.css'

export default function ProductImport({ onExtract, onShowDraft, busy, setBusy, draft, onImportCart, screenShopping }) {
  const [shareText, setShareText] = useState('')
  const [picture, setPicture] = useState(null)
  const selection = useRef(0)
  const selectingNative = useRef(false)
  const [readingPicture, setReadingPicture] = useState(false)
  const [pictureError, setPictureError] = useState('')
  const [lookupMode, setLookupMode] = useState(null)
  const [lookingUp, setLookingUp] = useState(false)
  const [notice, setNotice] = useState(null)
  const [choices, setChoices] = useState([])
  const [offers, setOffers] = useState(null)
  const [imageOpen, setImageOpen] = useState(true)
  const [openedScreenSharing, setOpenedScreenSharing] = useState(false)
  const bundled = window.location.protocol === 'coolcart:'
  const handlers = importHandlers()
  const offline = WEB_AI_DISABLED || (bundled && !handlers?.personalProductImport && !handlers?.importProductLink)
  const canImportImage = !WEB_AI_DISABLED && (!bundled || Boolean(handlers?.personalProductImport || handlers?.importProductImage))
  const nativePicker = handlers?.cartScreenshot

  function showNotice(tone, title, detail) {
    setNotice({ tone, title, detail })
  }

  async function selectPicture(file) {
    const revision = ++selection.current
    setPicture(null)
    setPictureError('')
    setNotice(null)
    setOffers(null)
    setReadingPicture(true)
    try {
      const data = await prepareScreenshot(file, Boolean(handlers?.personalProductImport))
      if (revision === selection.current) setPicture({ data, name: file.name })
    } catch (error) {
      if (revision === selection.current) setPictureError(error?.message || '截图读取失败，请重新选择。')
    } finally {
      if (revision === selection.current) setReadingPicture(false)
    }
  }

  async function selectNativePicture() {
    if (busy || selectingNative.current) return
    selectingNative.current = true
    setBusy(true)
    setReadingPicture(true)
    setPictureError('')
    try {
      const result = await nativePicker.postMessage({ action: 'pickProduct' })
      if (result?.status === 'cancelled') return
      if (result?.status !== 'selected' || typeof result.image !== 'string') {
        throw new Error('未能读取所选截屏，请重新选图。')
      }
      let data = result.image
      if (!handlers.personalProductImport) {
        // The team API keeps its request size limit even when the photo was selected natively.
        const blob = await (await fetch(data)).blob()
        data = await prepareScreenshot(new File([blob], '商品截屏', { type: blob.type }))
      }
      setPicture({ data })
      setNotice(null)
      setOffers(null)
    } catch (error) {
      setPictureError(error?.message || (typeof error === 'string' && error) || '截图读取失败，请重新选择。')
    } finally {
      selectingNative.current = false
      setReadingPicture(false)
      setBusy(false)
    }
  }

  async function lookup(mode, selected) {
    if (busy) return
    const text = mode === 'draft' ? [draft.platform, draft.name, draft.variant].filter(Boolean).join(' ') : shareText
    const draftLink = mode === 'draft' && draft.link?.trim()
    const options = { forDraft: mode === 'draft' }
    const links = mode === 'text' && !selected ? readProductLinks(text) : []
    setLookupMode(mode === 'image' ? 'image' : 'text')
    setOffers(null)
    if (links.length > 1) {
      setChoices(links)
      showNotice('review', '待选择商品', '找到多个商品链接，请选择要导入的一件。')
      return
    }
    const link = selected || (draftLink && readProductLink(draftLink)) || links[0]
    const query = !link && mode !== 'image' && !draftLink ? productQuery(text) : ''
    if (mode !== 'image' && !link && !query) {
      showNotice('error', '请核对搜索内容', '请输入 2 至 160 字的商品名或型号，或粘贴京东、淘宝、天猫商品链接。')
      return
    }
    if (query && (WEB_AI_DISABLED || (bundled && !handlers?.importProductQuery && !handlers?.personalProductImport))) {
      showNotice('error', '在线查询未连接', '请配置个人密钥或团队接口，也可手动填写商品。')
      return
    }
    setChoices([])
    if (offline && link) {
      onExtract({ link: link.url, platform: link.platform }, true, options)
      showNotice('success', '已填入商品链接', '请核对名称、规格和单价。')
      return
    }
    if (mode === 'image' && !picture) return
    setBusy(true)
    setLookingUp(true)
    setNotice(null)
    try {
      const result = await requestProductImport(link ? { link: link.url } : query ? { query } : { image: picture.data })
      if (!result) throw new Error('请裁剪到只包含一件商品，并保留商品名称。')
      if (result.choices?.length) {
        if (mode === 'image') onExtract(result)
        setOffers({ ...result, forDraft: options.forDraft })
        showNotice('review', '待核对同款', mode === 'image'
          ? 'DeepSeek 已识别截图。找到多个同款商品，请核对后选择购买页。'
          : '请核对候选商品的型号和规格，再选择购买页。')
        return
      }
      // 仅补查现有草稿时，查无结果要保留用户已经核对的内容。
      if (mode !== 'draft' || result.link || result.alternative) onExtract(result, mode !== 'image', options)
      if (query) {
        if (result.link) showNotice('success', '已找到购买页', result.price == null
          ? '购买链接已填入，请核对单价。' : '同款购买链接和公开单价已填入，请核对商品草稿。')
        else showNotice('review', '购买页待核对', '暂未确认该平台的同款购买链接。可补充型号和规格再查。')
      } else if (mode === 'image') {
        const matched = result.link ? 'DeepSeek 已识别截图，并填入同款购买链接。' : 'DeepSeek 已识别截图，购买页待核对。'
        const priceNote = result.priceSource === 'screenshot_offer' ? '已填入截图到手参考价。'
          : result.price == null ? '单价待核对。' : '已填入单价。'
        showNotice(result.link ? 'success' : 'review', result.link ? '识别完成' : '购买页待核对', matched + priceNote)
      } else {
        if (result.price == null) showNotice('review', '待核对单价', '没有找到可以核对的价格，请在下方确认名称并填入单价。')
        else showNotice('success', '商品草稿已填好', '请核对商品、规格和单价，再加入购物车。')
      }
    } catch (error) {
      if (link) onExtract({ link: link.url, platform: link.platform }, false, options)
      showNotice('error', '查询未完成', error?.name === 'TimeoutError' || error instanceof SyntaxError
        ? '查价暂时不可用，请重试或手动填写。'
        : error?.message || (typeof error === 'string' && error) || '识别暂时不可用，请重试或手动填写。')
    } finally {
      setLookingUp(false)
      setBusy(false)
    }
  }

  function lookupFeedback(mode) {
    if (lookupMode !== mode) return null
    return <>
      {lookingUp
        ? <ImportStatus tone="working" title={mode === 'image' ? '正在识别截图' : '正在查找同款'}
          detail="正在用 DeepSeek 核对商品和价格。" />
        : notice && <ImportStatus {...notice} action={mode === 'image' && notice.tone !== 'error' && !offers &&
          <a href="#product-draft" onClick={(event) => {
            event.preventDefault()
            onShowDraft()
          }}>查看已填草稿</a>} />}
      {offers && <ul className="link-choices motion-enter">{offers.choices.map((offer) => (
        <li key={offer.link}><button className="btn ghost" type="button" disabled={busy} onClick={() => {
          onExtract({ ...offers, ...offer, choices: [], alternative: null, priceSource: offer.price != null ? (offer.priceSource || 'web') : null },
            mode !== 'image', { forDraft: offers.forDraft })
          setOffers(null)
          showNotice('success', '已选定购买页', offer.priceSource === 'screenshot_offer' ? '所选商品链接和截图到手参考价已填入。'
            : offer.price == null ? '所选商品链接已填入，单价待核对。' : '所选商品链接和单价已填入。')
        }}>{offer.platform} · {offer.details || offer.name}{offer.price != null ? ' · ¥' + offer.price : ''}</button></li>
      ))}</ul>}
    </>
  }

  return (
    <section className="product-import field-stack" aria-label="商品导入">
      {canImportImage && <details className="import-disclosure" open={imageOpen}
        onToggle={(event) => setImageOpen(event.currentTarget.open)}>
        <summary>单品截图导入</summary>
        <div className="field-stack">
          <p className="muted small reading-copy">{nativePicker ? '选择 20 MB 以内的商品详情截图。' : '支持 20 MB 以内的 PNG、JPEG、WebP。'}
            请保留商品名和价格，裁去个人信息。</p>
          <div className="actions import-picture-actions">
            {nativePicker ? <button className={picture ? 'btn ghost' : 'btn primary'} type="button"
              disabled={busy || readingPicture} onClick={selectNativePicture}>选择单件商品截屏</button>
              : <label className="import-file-picker">
                <span className={picture ? 'btn ghost' : 'btn primary'} aria-hidden="true">上传单件商品截图</span>
                <input type="file" accept={IMAGE_TYPES.join(',')} disabled={busy}
                  aria-label="上传单件商品截图" onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    if (file) void selectPicture(file)
                  }} />
              </label>}
          </div>
          {readingPicture && <ImportStatus tone="working" title="正在读取截屏…" />}
          {pictureError && <ImportStatus tone="error" title="无法读取截图" detail={pictureError} />}
          {picture && <>
            <figure className="screenshot-preview motion-enter">
              <img src={picture.data} alt="已选商品截图" />
              {picture.name && <figcaption className="muted small reading-copy">{picture.name}</figcaption>}
            </figure>
            <button className="btn primary" type="button" disabled={busy || readingPicture}
              onClick={() => lookup('image')}>用 DeepSeek 识别并找同款</button>
          </>}
          {lookupFeedback('image')}
        </div>
      </details>}
      {(nativePicker || (!bundled && hasCartLookup())) && <CartScreenshot bridge={nativePicker} canShare={Boolean(handlers?.cartShareInbox)}
        busy={busy} setBusy={setBusy} onImportCart={onImportCart} />}
      {!nativePicker && handlers?.cartShareInbox && <p className="muted small">也可从截屏预览或相册点「共享 → CoolCart」。</p>}
      <details className="import-disclosure" open={!canImportImage}>
        <summary>{offline ? '使用商品分享链接' : '按名称或链接查找'}</summary>
        <div className="field-stack">
          {offline && <p className="muted small reading-copy">{WEB_AI_DISABLED
            ? '公开演示使用手填或商品分享链接，购买前使用内置问答。'
            : '单品识图和在线查价需要配置个人密钥或团队接口。你仍可使用分享链接、手填商品或识别购物车截屏。'}</p>}
          <label>
            {offline ? '商品分享链接' : '商品名称、型号或分享链接'}
            <textarea rows={2} value={shareText} onChange={(event) => {
              setShareText(event.target.value)
              setChoices([])
              setOffers(null)
              setNotice(null)
            }} placeholder={offline ? '粘贴京东、淘宝或天猫商品分享链接' : '如：罗技 M185 黑色灰边，或粘贴商品链接'}
            disabled={busy} maxLength={8192} />
          </label>
          <div className="actions">
            <button className="btn secondary" type="button" disabled={busy || !shareText.trim()}
              onClick={() => lookup('text')}>{offline ? '填入链接' : '用 DeepSeek 查商品'}</button>
            {!offline && draft?.name?.trim() && <button type="button" className="btn ghost" disabled={busy} onClick={() => lookup('draft')}>查找已填商品</button>}
          </div>
          {choices.length > 0 && (
            <ul className="link-choices">
              {choices.map((product) => (
                <li key={product.url}><button className="btn ghost" type="button"
                  onClick={() => lookup('text', product)}>{product.platform} · {product.url}</button></li>
              ))}
            </ul>
          )}
          {lookupFeedback('text')}
        </div>
      </details>
      {screenShopping && <details className="import-disclosure" onToggle={(event) => { if (event.currentTarget.open) setOpenedScreenSharing(true) }}>
        <summary>实时屏幕共享</summary>
        {openedScreenSharing && <ScreenShopping controls={screenShopping} busy={busy} />}
      </details>}
    </section>
  )
}
