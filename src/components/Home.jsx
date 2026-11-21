import { useRef, useState } from 'react'
import { convert, fmtClock, itemMealEstimate, safeUrl, yuan } from '../lib/convert.js'
import { isJdNavigationPage, readProductLink, readProductLinks, storefrontForLink } from '../lib/productImport.js'
import { applyProductImport, confirmDraftLink, draftHasProductEvidence, editProductDraft, EMPTY_DRAFT } from '../lib/importDraft.js'
import { findDuplicateProducts } from '../lib/duplicateProducts.js'
import { LOCK_CATEGORIES } from '../lib/rules.js'
import { formatCents } from '../lib/ledger.js'
import { cartImportLabel } from '../lib/capturedCartItems.js'
import { cartLookupInput } from '../lib/cartProductLinks.js'
import { useCartLookupRunning } from '../lib/cartLookupActivity.js'
import PixelIcon from './PixelIcon.jsx'
import ProductPhoto from './ProductPhoto.jsx'
import ProductImport from './ProductImport.jsx'
import CartCaptureSummary from './CartCaptureSummary.jsx'
import ImportStatus from './ImportStatus.jsx'
import RecognizedCartItems from './RecognizedCartItems.jsx'
import ReviewScreenshot from './ReviewScreenshot.jsx'

const STAGE_LABEL = {
  cooling: '冷静中',
  quiz: '待算账',
  trial: '待考虑理由',
  final: '待放行',
  approved: '已放行',
  pending: '待确认',
  purchased: '已购买',
  abandoned: '已放弃',
}

const GROUPS = [
  ['处理中', ['cooling', 'quiz', 'trial', 'final', 'approved']],
  ['待确认', ['pending']],
  ['已购买', ['purchased']],
  ['已放弃', ['abandoned']],
]

const PRICE_SOURCE_LABEL = { manual: '手填', screenshot: '截图标价', screenshot_offer: '截图到手参考价', screen_capture: '购物车显示单价', web: '公开参考价' }
const PAYMENT_SOURCE_LABEL = { demo: '演示记录', self_reported: '用户自报' }
const CART_LINK_STATUS = { linked: '已关联购买页', choices: '待选购买页', error: '购买页查找可重试', none: '购买页待确认' }

function listedPrice(price) {
  return Number.isFinite(price) && price >= 0 ? yuan(price) : null
}

function stageLabel(item, now) {
  if (item.stage === 'cooling' && item.cooldownEndsAt <= now) return '冷静期结束，可继续'
  return STAGE_LABEL[item.stage]
}

function candidateLabel(item, now) {
  const product = readProductLink(item.link)
  const code = product?.skuId ? `规格编号 ${product.skuId}` : product?.itemId && `商品编号 ${product.itemId}`
  return [item.name, item.variant, storefrontForLink(product) || item.platform, code, listedPrice(item.price) ?? '标价待核对', stageLabel(item, now)]
    .filter(Boolean).join(' · ')
}

export default function Home({ items, settings, now, canLookupCart, onImportCart, onDiscardCartReview,
  screenShopping, onCorrectCapturedTitle,
  onChooseCartLink, onRetryCartLookup, onAdd, onOpen, onUseExisting, onLedger, onBudget, shareSummary, dueFollowUpCount = 0 }) {
  const addForm = useRef(null)
  const savedItems = items.filter((item) => item.stage !== 'cartReview')
  const reviewItems = items.filter((item) => item.stage === 'cartReview')
  const abandoned = items.filter((item) => item.stage === 'abandoned')
  const saved = abandoned.reduce((sum, item) => sum + (Number(item.price) || 0), 0)
  const savedConv = convert(saved, settings)

  return (
    <main className="page page-home">
      <section className="hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <p className="hero-label" lang="en" aria-hidden="true">PRESS PAUSE</p>
          <h1 id="home-title"><span>冷静一下，</span>再买也行。</h1>
        </div>
        <div className="hero-display" aria-hidden="true">
          <PixelIcon name="coins" className="hero-coins" />
        </div>
        <nav className="actions home-actions" aria-label="购物车操作">
          <button className="btn primary" onClick={() => {
            addForm.current.focus({ preventScroll: true })
            addForm.current.scrollIntoView({ block: 'start' })
          }}>导入或手填</button>
          <button className="btn ghost" onClick={onLedger}>查看支出</button>
        </nav>
      </section>

      {dueFollowUpCount > 0 && (
        <div className="notice follow-up-notice motion-enter">
          <p role="status">{dueFollowUpCount} 件已购买商品可以回访了。</p>
          <button className="btn ghost small" type="button" onClick={onLedger}>查看待回访商品</button>
        </div>
      )}

      <div className="home-layout">
        <div className="cart-column">
          <section className="pixel-frame cart-panel" aria-labelledby="cart-items">
            <div className="section-title">
              <h2 id="cart-items">购物车商品 <span className="cart-count">{savedItems.length} 件</span></h2>
              <button className="btn ghost small" type="button" onClick={onBudget}>预算预演</button>
            </div>
            {shareSummary && <CartCaptureSummary result={shareSummary} title="截屏分享" canReview={reviewItems.length > 0} />}
            {screenShopping?.summary && <CartCaptureSummary result={screenShopping.summary} title="屏幕共享" canReview={reviewItems.length > 0} />}
            {!savedItems.length && <ImportStatus title="购物车还是空的。" announce={false}
              detail={reviewItems.length ? '请先核对识别到的商品。' : '从「导入或手填」添加想买的商品。'} />}
            {GROUPS.map(([heading, stages]) => {
              const groupItems = savedItems.filter((item) => stages.includes(item.stage))
              if (!groupItems.length) return null
              return (
                <section className="cart-group" key={heading}>
                  <h3>{heading}</h3>
                  <ul className="item-list">
                    {groupItems.map((item) => (
                      <ItemRow key={item.id} item={item} settings={settings} now={now} canLookupCart={canLookupCart}
                        onOpen={onOpen} onCorrectCapturedTitle={onCorrectCapturedTitle} />
                    ))}
                  </ul>
                </section>
              )
            })}
            {items.some((item) => item.stage === 'cooling' && now < item.cooldownEndsAt) && (
              <p className="muted small">冷静期内点开商品，可以参加手速大战。</p>
            )}
          </section>
          {abandoned.length > 0 && (
            <section className="pixel-frame savings">
              <h3>放弃购买的商品金额</h3>
              <p className="big">{yuan(saved)}</p>
              <p className="muted">按当前餐费约合 {savedConv.meals} 顿食堂饭 · 放弃了 {abandoned.length} 件</p>
            </section>
          )}
        </div>

        <AddItemForm formRef={addForm} items={savedItems} reviewItems={reviewItems} settings={settings} now={now}
          screenShopping={screenShopping}
          onAdd={onAdd} onUseExisting={onUseExisting} onImportCart={onImportCart} onDiscardCartReview={onDiscardCartReview}
          canLookupCart={canLookupCart} onChooseCartLink={onChooseCartLink} onRetryCartLookup={onRetryCartLookup} />
      </div>
    </main>
  )
}

function ItemRow({ item, settings, now, canLookupCart, onOpen, onCorrectCapturedTitle }) {
  const { meals } = itemMealEstimate(item, settings)
  const cooling = item.stage === 'cooling' && now < item.cooldownEndsAt
  const purchased = item.stage === 'purchased'
  const price = listedPrice(item.price)
  const source = purchased ? PAYMENT_SOURCE_LABEL[item.source] : PRICE_SOURCE_LABEL[item.priceSource]
  const imported = cartImportLabel(item)
  const platform = imported && item.platform === item.cartImport?.platform ? '' : item.platform
  const metadata = [imported && `来源 · ${imported}`, platform, item.variant, item.category, source].filter(Boolean).join(' · ')
  const lookup = item.cartLinkLookup?.status
  const input = cartLookupInput(item)
  const running = useCartLookupRunning(item.id, input)
  const linkStatus = lookup === 'linked' && item.link ? CART_LINK_STATUS.linked
    : input && (CART_LINK_STATUS[lookup] || (running ? '正在查找同款' : canLookupCart ? '等待查找同款' : '商品查询服务未连接'))
  return (
    <li>
      <button id={`cart-item-${item.id}`} className={`pixel-frame item-row stage-${item.stage}`} type="button"
        onClick={(event) => onOpen(item.id, event.currentTarget)}>
        <span className="item-content">
          <span className="item-summary">
            <ProductPhoto item={item} compact fallback />
            <span className="item-name">{item.name}</span>
          </span>
          {metadata && <small className="muted">{metadata}</small>}
          {linkStatus && <small className="muted">{linkStatus}</small>}
          <span className="item-meta">
            {purchased && Number.isSafeInteger(item.paidCents) && item.paidCents >= 0
              ? <>实付 {formatCents(item.paidCents)}<small> · {price ? `标价 ${price}` : '标价待核对'}</small></>
              : price ? `${price} · 约 ${meals} 顿饭` : '标价待核对'}
          </span>
          {item.lockReasons?.length > 0 && !purchased && item.stage !== 'abandoned' && (
            <small className="muted">锁定原因 · {item.lockReasons.join('、')}</small>
          )}
        </span>
        <span className="badge stage-badge" data-ready={item.stage === 'cooling' && item.cooldownEndsAt <= now}>
          {cooling ? fmtClock(item.cooldownEndsAt - now) : stageLabel(item, now)}
        </span>
      </button>
      {imported && <CapturedTitleCorrection item={item} onSave={onCorrectCapturedTitle} />}
    </li>
  )
}

function CapturedTitleCorrection({ item, onSave }) {
  const details = useRef(null)
  const [name, setName] = useState(item.name)
  const [error, setError] = useState('')
  return <details className="import-disclosure" ref={details} onToggle={(event) => {
    if (event.currentTarget.open) {
      setName(item.name)
      setError('')
    }
  }}>
    <summary>更正识别名称</summary>
    <form className="add-form" onSubmit={(event) => {
      event.preventDefault()
      const failure = onSave(item, name)
      setError(failure)
      if (!failure) details.current.open = false
    }}>
      <p className="muted small">只更正同一件商品的名称。规格、金额和购物进度会保留。</p>
      <label>
        商品名称
        <input value={name} maxLength={120} required onChange={(event) => setName(event.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn ghost small" type="submit">保存名称更正</button>
    </form>
  </details>
}

function AddItemForm({ formRef, items, reviewItems, settings, now, onAdd, onUseExisting, onImportCart, onDiscardCartReview,
  canLookupCart, onChooseCartLink, onRetryCartLookup, screenShopping }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pendingDraft, setPendingDraft] = useState(null)
  const [correctTitle, setCorrectTitle] = useState(false)
  // 双击/三击提交只允许入库一条：ref 同步生效，不依赖下一帧的重渲染。
  const submitting = useRef(false)
  const manualFields = useRef(null)
  const { name, price, link, platform, variant, category, priceSource } = draft
  const categories = [...new Set([...LOCK_CATEGORIES, ...(settings.lockRules?.categories || []), category].filter(Boolean))]
  const duplicate = pendingDraft && findDuplicateProducts(pendingDraft, items)
  const sourceReview = reviewItems.find(({ id }) => id === draft.cartReviewId)

  function revealDraft(focusSummary = false) {
    const fields = manualFields.current
    if (!fields) return
    // Lay out the whole draft before scrolling to it, including near the bottom of a short page.
    fields.dataset.scrollTarget = ''
    fields.open = true
    requestAnimationFrame(() => {
      if (!fields.isConnected) return
      fields.scrollIntoView({ block: 'start' })
      if (focusSummary) fields.querySelector('summary')?.focus({ preventScroll: true })
      delete fields.dataset.scrollTarget
    })
  }

  function applyImport(result, reveal = false, options) {
    const fields = manualFields.current
    if (!fields) return
    if (reveal) revealDraft()
    else fields.open = true
    setError('')
    setPendingDraft(null)
    setCorrectTitle(false)
    setDraft((current) => applyProductImport(current, result, options))
  }

  function editDraft(fields) {
    setDraft((current) => editProductDraft(current, fields, { correctTitle }))
    setError('')
    setPendingDraft(null)
  }

  function commit(confirmed, acknowledgedIds) {
    if (submitting.current) return
    submitting.current = true
    const added = onAdd(confirmed, acknowledgedIds, draft.cartReviewId)
    if (added === 'category') {
      submitting.current = false
      setPendingDraft(null)
      setError('当前购物锁按品类判断。请先核对并选择商品类别。')
    } else if (added === false) {
      submitting.current = false
      setPendingDraft(confirmed)
    }
  }

  function submit(event) {
    event.preventDefault()
    if (busy || submitting.current) return

    const links = readProductLinks(link)
    if (links.length > 1) return setError('购买链接包含多个商品，请只保留要加入的那一件。')
    const [confirmedLink] = links
    const rawLink = link.trim()
    const url = confirmedLink?.url || (/^https?:\/\/\S+$/i.test(rawLink) && safeUrl(rawLink)) || ''
    if (isJdNavigationPage(url)) return setError('请从京东商品详情页复制分享链接。')
    const enteredPrice = price.trim()
    if (!name.trim()) return setError('请填写商品名称。')
    if (!enteredPrice) return setError('请补填确认单价。')
    if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(enteredPrice)) {
      return setError('确认单价请填写十进制金额，最多两位小数，例如 399.90。')
    }
    const amount = Number(enteredPrice)
    if (amount < 0.01 || amount > 10000000) {
      return setError('请输入 0.01 至 10,000,000 元之间的价格。')
    }
    if (link.trim() && !url) return setError('请填写以 http:// 或 https:// 开头的有效商品链接。')

    const confirmed = {
      name: name.trim().slice(0, 120),
      price: amount,
      link: url,
      platform: storefrontForLink(confirmedLink) || platform,
      variant: variant.trim().slice(0, 60),
      category,
      priceSource: priceSource || 'manual',
      ...(draft.cartImport && { cartImport: draft.cartImport }),
      ...(draft.captureOriginalName && { captureOriginalName: draft.captureOriginalName }),
      ...(draft.imageUrl && { imageUrl: draft.imageUrl }),
      ...(draft.details && { details: draft.details }),
      ...(draft.matchSource && { matchSource: draft.matchSource }),
    }
    commit(confirmed)
  }

  return (
    <form ref={formRef} tabIndex={-1} className="pixel-frame panel add-form" aria-labelledby="add-product-title" onSubmit={submit} noValidate>
      <h2 id="add-product-title" className="panel-heading">添加商品</h2>
      <div className="panel-content field-stack">
        <ProductImport draft={draft} onExtract={applyImport} onShowDraft={() => revealDraft(true)}
          busy={busy} setBusy={setBusy} onImportCart={onImportCart}
          screenShopping={screenShopping} />
        {reviewItems.length > 0 && <section className="import-controls motion-enter" aria-labelledby="cart-review-title">
          <h3 id="cart-review-title">待核对商品</h3>
          <p className="muted small reading-copy">核对规格和单价，再将商品加入购物车。</p>
          <RecognizedCartItems items={reviewItems} disabled={busy} onExtract={(result) => applyImport(result, true)}
            canLookupCart={canLookupCart} onChooseLink={onChooseCartLink} onRetryLookup={onRetryCartLookup}
            onDiscard={(id) => {
              if (draft.cartReviewId === id) {
                setDraft(EMPTY_DRAFT)
                setPendingDraft(null)
                setCorrectTitle(false)
                setError('')
              }
              onDiscardCartReview(id)
            }} />
        </section>}
        <details className="import-disclosure" ref={manualFields}>
          <summary id="product-draft">核对商品，手动填写</summary>
          <div className="field-stack">
            {draft.cartImport && <p className="muted small">商品来源 · {cartImportLabel(draft)}</p>}
            {sourceReview && <ReviewScreenshot item={sourceReview} />}
            {(platform || draft.imageUrl || draft.details) && <div className="product-summary">
              <ProductPhoto item={draft} />
              <div>
                {platform && <p className="muted small">来源平台 · {platform}</p>}
                {draft.details && <p className="product-details">商品资料 · {draft.details}</p>}
                {!link && draft.imageUrl && <p className="muted small">同款图片已找到，购买链接待确认。</p>}
                {link && draft.matchSource === 'reference' && <p className="muted small">购买链接由公开资料中的同款商品记录提供。</p>}
                {link && draft.matchSource === 'merchant' && <p className="muted small">购买链接来自商城的同款商品页。</p>}
              </div>
            </div>}
            {name && draftHasProductEvidence(draft) && <label className="check">
              <input type="checkbox" checked={correctTitle} disabled={busy}
                onChange={(event) => setCorrectTitle(event.target.checked)} />
              只更正同一商品的名称
            </label>}
            <label>
              商品名称
              <input value={name} onChange={(event) => editDraft({ name: event.target.value })}
                placeholder="例如：降噪耳机" maxLength={120} disabled={busy} />
            </label>
            <div className="field-pair">
              <label>
                商品类别
                <select value={category} onChange={(event) => editDraft({ category: event.target.value })} disabled={busy}>
                  <option value="">未选择类别</option>
                  {categories.map((name) => <option key={name}>{name}</option>)}
                </select>
              </label>
              <label>
                规格（选填）
                <input value={variant} onChange={(event) => editDraft({ variant: event.target.value })}
                  placeholder="例如：黑色" maxLength={60} disabled={busy} />
              </label>
            </div>
            <label>
              确认单价（元）
              <input value={price} onChange={(event) => editDraft({ price: event.target.value, priceSource: 'manual' })}
                placeholder="例如：399" inputMode="decimal" disabled={busy} />
            </label>
            {priceSource === 'web' && <p className="muted small">价格来源 · 导入时的公开参考价，以页面实际报价为准。</p>}
            {priceSource === 'screenshot' && <p className="muted small">价格来源 · 截图标价，尚未通过公开商品页核对。</p>}
            {priceSource === 'screenshot_offer' && <p className="muted small">价格来源 · 截图到手参考价，优惠资格和金额以商城结算为准。</p>}
            {priceSource === 'screen_capture' && <p className="muted small">价格来源 · 电商购物车显示单价，请核对所选规格与金额。</p>}
            {priceSource === 'manual' && price.trim() && <p className="muted small">价格来源 · 手填</p>}
            {!price && draft.matchSource && link && <p className="muted small">已找到购买页。单价待确认，请根据商城当前报价填入。</p>}
            {draft.needsNewPrice && <p className="muted small" role="status">商品或规格已更改，请重新确认单价。</p>}
            <label>
              购买链接（选填）
              <input value={link} onChange={(event) => editDraft({ link: event.target.value,
                platform: storefrontForLink(readProductLink(event.target.value)) })}
                onBlur={() => setDraft(confirmDraftLink)} placeholder="https://..." inputMode="url" disabled={busy} />
            </label>
            {draft.alternative && <div className="alternative-product">
              <p>另在{draft.alternative.platform}找到同款 · {draft.alternative.name || name}</p>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => applyImport({
                ...draft.alternative,
                name: draft.alternative.name || name,
                category: draft.category,
                cartImport: draft.cartImport,
                cartReviewId: draft.cartReviewId,
                price: draft.alternative.priceSource === 'web' ? draft.alternative.price : null,
                priceSource: draft.alternative.priceSource === 'web' ? 'web' : null,
              })}>改用{draft.alternative.platform}同款</button>
            </div>}
            {!link.trim() && <p className="muted small">可以先添加商品，放行后再补链接。</p>}
            {error && <p className="error" role="alert">{error}</p>}
            {duplicate?.items.length > 0 && (
              <section className="import-controls" aria-labelledby="duplicate-title">
                <h3 id="duplicate-title">{duplicate.exact ? '已有相同商品和规格' : '可能已有这件商品'}</h3>
                <p>{draft.cartReviewId ? '采用已有记录后，这次导入会从待核对区移除。' : '选已有记录会保留它当前的进度和冷静时间。'}</p>
                <div className="actions">
                  {duplicate.items.map((item) => (
                    <button key={item.id} className="btn ghost" type="button" disabled={busy}
                      onClick={() => onUseExisting(item.id, draft.cartReviewId)}>
                      {draft.cartReviewId ? '采用已有记录' : '打开'} {candidateLabel(item, now)}
                    </button>
                  ))}
                  {!duplicate.exact && (
                    <button className="btn ghost" type="button" disabled={busy}
                      onClick={() => commit(pendingDraft, duplicate.items.map((item) => item.id))}>
                      确认为不同商品，另加一条
                    </button>
                  )}
                </div>
              </section>
            )}
            <button className="btn primary full-action" type="submit" disabled={busy}>加入购物车</button>
          </div>
        </details>
      </div>
    </form>
  )
}
