import { useRef, useState } from 'react'
import ProductPhoto from './ProductPhoto.jsx'
import PurchaseQuestions from './PurchaseQuestions.jsx'
import PurchaseFollowUp, { FollowUpSummary } from './PurchaseFollowUp.jsx'
import CartProductLink from './CartProductLink.jsx'
import TapChallenge from './TapChallenge.jsx'
import { convert, fmtClock, fmtShort, itemMealEstimate, safeUrl, yuan } from '../lib/convert.js'
import { isJdNavigationPage, readProductLink } from '../lib/productImport.js'
import { beijingPaymentTime, budgetPreview, formatCents, yuanToCents } from '../lib/ledger.js'
import { finishCooldown } from '../lib/cartItems.js'
import { cartImportLabel } from '../lib/capturedCartItems.js'
import { latestRelatedFollowUp } from '../lib/purchaseFollowUp.js'

const STEPS = [
  ['cooling', '冷静期'],
  ['quiz', '生活成本'],
  ['trial', '购买理由'],
  ['final', '确认'],
]

const FLOW_TITLES = {
  cooling: '冷静期',
  quiz: '生活成本',
  trial: '购买理由',
  final: '购买前提醒',
  approved: '已放行',
  pending: '待确认支付',
  purchased: '已购买',
  abandoned: '已放弃购买',
}

const PRICE_SOURCES = {
  web: '导入时的公开参考价',
  screenshot: '截图标价',
  screenshot_offer: '截图到手参考价，以商城结算为准',
  screen_capture: '购物车显示单价',
  manual: '手填',
}

const SHOP_SEARCH = new Map([
  ['淘宝', ['https://s.taobao.com/search', 'q']],
  ['天猫', ['https://list.tmall.com/search_product.htm', 'q']],
])

export default function ItemFlow({
  item,
  settings,
  items,
  now,
  spendingTotals,
  demo,
  challengeOffered,
  onResolveTapChallenge,
  canLookupCart,
  onChooseCartLink,
  onRetryCartLookup,
  onUpdate,
  onAbandon,
  onUndoAbandon,
  onOpenProduct,
  onConfirmPurchase,
  onCorrectPayment,
  onWithdrawPayment,
  onSaveFollowUp,
  onDelete,
  onBack,
  backLabel = '返回购物车',
}) {
  const [removeStage, setRemoveStage] = useState(null)
  const [openError, setOpenError] = useState('')
  const openingProduct = useRef(false)
  const { mealPrice, meals } = itemMealEstimate(item, settings)
  const hasPrice = Number.isFinite(item.price) && item.price >= 0
  const hasPayment = Number.isSafeInteger(item.paidCents) && item.paidCents >= 0
  const paymentVersion = JSON.stringify([item.paidAt, item.paidCents, item.source, item.purchaseFollowUp])
  const listedCents = hasPayment ? yuanToCents(item.price) : null
  const paidDifference = listedCents === null ? null : item.paidCents - listedCents
  const stepIndex = STEPS.findIndex(([stage]) => stage === (item.stage === 'approved' ? 'final' : item.stage))
  const canAbandon = item.stage !== 'abandoned' && item.stage !== 'purchased'
  const imported = cartImportLabel(item)
  const platform = imported && item.platform === item.cartImport?.platform ? '' : item.platform
  const priceSource = PRICE_SOURCES[item.priceSource]
  const facts = [item.variant, platform, item.category].filter(Boolean)
  const link = isJdNavigationPage(item.link) ? '' : safeUrl(item.link)
  const readyToShop = ['final', 'approved'].includes(item.stage)
  const linkAction = item.cartLinkLookup?.status === 'linked' ? '打开已关联商品页' : '打开原商品页'
  const preferredPlatform = item.cartImport?.platform || item.platform
  const searchPlatform = SHOP_SEARCH.has(preferredPlatform) ? preferredPlatform : '京东'
  const searchTerms = [item.name, item.variant].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  const searchPage = SHOP_SEARCH.get(searchPlatform)
  const searchUrl = searchPage && searchPage[0] + '?' + new URLSearchParams({ [searchPage[1]]: searchTerms })
  const fromJdCart = item.cartImport?.platform === '京东'
  const linkInfo = <CartProductLink item={item} available={canLookupCart} onChoose={onChooseCartLink} onRetry={onRetryCartLookup} />
  const reminder = item.purchaseReview?.reminder
  const budget = <BudgetPreview items={items} item={item} settings={settings} now={now} demo={demo} getTotals={spendingTotals} />
  const previousFollowUp = ['trial', 'final', 'approved', 'pending'].includes(item.stage)
    ? latestRelatedFollowUp(items, item, now, { demo }) : null

  function continueAfterCooldown() {
    const clickedAt = Date.now()
    onUpdate((latest) => finishCooldown(latest, clickedAt))
  }

  async function followProduct(event, productPage = false) {
    const href = event.currentTarget.href
    const bridge = window.location.protocol === 'coolcart:' && window.webkit?.messageHandlers?.openRetailLink
    if (openingProduct.current) {
      event.preventDefault()
      return
    }
    setOpenError('')
    const normalClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
    const finishVisit = onOpenProduct({ productPage, trackReturn: Boolean(bridge) || normalClick, waitsForNative: Boolean(bridge) })
    if (finishVisit === false) {
      event.preventDefault()
      setOpenError('待确认记录未能保存。请留在此页，稍后再打开商品页。')
      return
    }
    if (bridge) {
      event.preventDefault()
      openingProduct.current = true
      let opened = false
      try {
        opened = await bridge.postMessage(href) === true
      } catch {
        // A failed bridge call can be retried using the same link.
      } finally {
        openingProduct.current = false
      }
      const accepted = typeof finishVisit === 'function' ? finishVisit(opened) : true
      if (!opened) setOpenError('未能打开商品页面，请再试一次。')
      else if (accepted === false) setOpenError('待确认记录未能保存。如果已完成付款，请核对商品并使用「登记实付」。')
    }
  }

  const jdCartAction = (fromJdCart || (!link && searchPlatform === '京东')) && (
    <a className={readyToShop && !link ? 'btn primary full-action' : 'btn ghost'}
      href="https://cart.jd.com/cart_index"
      target="_blank" rel="noopener noreferrer" onClick={(event) => followProduct(event)}>打开京东购物车</a>
  )

  return (
    <main className="page page-narrow item-page">
      <div className="item-navigation">
        <button className="btn ghost back small" onClick={onBack}>{backLabel}</button>
        {canAbandon && <button className="btn ghost small" onClick={onAbandon}>放弃购买</button>}
      </div>
      <header className="item-head">
        <div className="item-photo">
          <ProductPhoto item={item} fallback />
        </div>
        <div className="item-identity">
          <h1>{item.name}</h1>
          <p className="item-price">
            {hasPrice ? <>{yuan(item.price)} <span className="muted small">· 约 {meals} 顿食堂饭</span></> : '商品单价待核对'}
          </p>
          {facts.length > 0 && <p className="item-facts muted small">
            {facts.map((fact, index) => <span key={index}>{fact}</span>)}
          </p>}
          {imported && <p className="muted small">商品来源 · {imported}</p>}
        </div>
      </header>
      {stepIndex >= 0 && (
        <ol className="stepper" aria-label="冷静流程">
          {STEPS.map(([stage, label], index) => (
            <li key={stage} aria-current={index === stepIndex ? 'step' : undefined}
              data-complete={index < stepIndex && item.stage !== 'approved' ? 'true' : undefined}>{label}</li>
          ))}
        </ol>
      )}

      <section className="pixel-frame panel flow-panel" aria-labelledby="flow-title">
        <h2 className="panel-heading" id="flow-title">{FLOW_TITLES[item.stage] ?? '商品详情'}</h2>
        <div className="panel-content field-stack motion-enter" key={item.stage}>
          {openError && ['final', 'approved', 'pending'].includes(item.stage) &&
            <p className="error" role="alert">{openError}</p>}
          {previousFollowUp && (
            <aside className="notice" aria-labelledby="related-follow-up-title">
              <h3 id="related-follow-up-title">同类商品上次回访</h3>
              <p>{previousFollowUp.name}</p>
              <FollowUpSummary answer={previousFollowUp.answer} />
            </aside>
          )}
          {item.stage === 'cooling' && (
            <Cooldown item={item} now={now} onContinue={continueAfterCooldown}
              challengeOffered={challengeOffered} onResolveTapChallenge={onResolveTapChallenge} />
          )}
          {item.stage === 'quiz' && (
            <CostQuiz
              price={item.price}
              mealPrice={mealPrice}
              meals={meals}
              hourlyWage={settings.hourlyWage}
              hours={convert(item.price, settings).hours}
              answer={item.quizAnswer}
              onAnswer={(quizAnswer) => onUpdate({ quizAnswer })}
              onContinue={() => onUpdate({ stage: 'trial' })} />
          )}
          {item.stage === 'trial' && <PurchaseQuestions item={item} onUpdate={onUpdate} />}
          {['cooling', 'quiz', 'trial'].includes(item.stage) && linkInfo}
          {readyToShop && (
            <>
              {budget}
              {reminder && <div className="notice">
                <strong>{item.purchaseReview.reminderSource === 'deepseek' ? 'DeepSeek 提醒' : '本地提醒'}</strong>
                <p className="reading-copy">{reminder}</p>
              </div>}
              {item.stage === 'approved' && item.lockReasons?.length === 0 && <p className="muted small">入库时未命中锁定规则，可直接打开商品页。</p>}
              {linkInfo}
              {link ? <>
                <a className="btn primary full-action" href={link} target="_blank" rel="noopener noreferrer"
                  onClick={(event) => followProduct(event, true)}
                  onAuxClick={(event) => { if (event.button === 1) followProduct(event, true) }}>
                  {linkAction}
                </a>
                {jdCartAction}
              </> : <>
                {jdCartAction || (searchUrl && <a className="btn primary full-action" href={searchUrl} target="_blank" rel="noopener noreferrer"
                  onClick={(event) => followProduct(event)}>在{searchPlatform}搜索同款</a>)}
                {searchPlatform === '京东' && <CopyRetailQuery terms={searchTerms} />}
                <AddLink onUpdate={onUpdate} />
              </>}
              {onConfirmPurchase && (
                <details className="import-disclosure">
                  <summary>登记实付</summary>
                  <div className="field-stack">
                    <p className="muted small">如果已在商城完成付款，可以直接登记实际金额和时间。</p>
                    <PaymentForm price={hasPrice ? item.price : null} returnTime={item.paymentReturnAt}
                      demo={demo} onConfirmPurchase={onConfirmPurchase} />
                  </div>
                </details>
              )}
            </>
          )}
          {item.stage === 'pending' && (
            <>
              {linkInfo}
              <h3>登记实付</h3>
              <p className="notice">在购物平台完成付款后，可核对并登记实际金额。</p>
              {onConfirmPurchase ? <PaymentForm price={hasPrice ? item.price : null} returnTime={item.paymentReturnAt}
                demo={demo} onConfirmPurchase={onConfirmPurchase} />
                : <p className="muted small">账本接入后可登记实付。</p>}
              <div className="actions">
                <button className="btn ghost" onClick={onBack}>暂未支付</button>
                {link && (
                  <a className="btn ghost" href={link} target="_blank" rel="noopener noreferrer"
                    onClick={(event) => followProduct(event, true)}>{linkAction}</a>
                )}
                {jdCartAction}
              </div>
            </>
          )}
          {item.stage === 'purchased' && (
            <>
              <dl className="receipt">
                <div><dt>标价</dt><dd>{hasPrice ? yuan(item.price) : '待核对'}</dd></div>
                {hasPayment && <div className="receipt-total"><dt>实付</dt><dd>{formatCents(item.paidCents)}</dd></div>}
              </dl>
              {paidDifference !== null && paidDifference !== 0 && (
                <p className="muted small">
                  {paidDifference < 0
                    ? `比标价少付 ${formatCents(Math.abs(paidDifference))}`
                    : `比标价多付 ${formatCents(paidDifference)}`}
                </p>
              )}
              {item.source === 'demo' && <p className="muted small">演示记录</p>}
              {item.source === 'self_reported' && <p className="muted small">用户自报</p>}
              <div className="field-stack" key={paymentVersion}>
                {hasPayment && onCorrectPayment && onWithdrawPayment && (
                  <PaymentCorrections item={item} demo={demo} onCorrect={onCorrectPayment} onWithdraw={onWithdrawPayment} />
                )}
                {onSaveFollowUp && <PurchaseFollowUp item={item} now={now} demo={demo} onSave={onSaveFollowUp} />}
              </div>
            </>
          )}
          {item.stage === 'abandoned' && (
            <>
              <p>这次暂未支出</p>
              <p className="big">{yuan(item.price)}</p>
              <button className="btn ghost" onClick={onUndoAbandon}>撤销放弃</button>
            </>
          )}
          {['abandoned', 'approved'].includes(item.stage) && (removeStage === item.stage ? (
            <div className="notice field-stack motion-enter" role="group" aria-label="确认移除商品">
              <p>从购物车移除「{item.name}」？</p>
              <div className="actions">
                <button className="btn ghost" onClick={() => setRemoveStage(null)}>取消</button>
                <button className="btn ghost" onClick={onDelete}>确认移除</button>
              </div>
            </div>
          ) : <button className="btn ghost" onClick={() => setRemoveStage(item.stage)}>移除商品</button>)}
        </div>
      </section>
      {(item.details || priceSource || item.lockReasons?.length > 0) && (
        <details className="import-disclosure">
          <summary>更多商品信息</summary>
          <div className="field-stack muted small">
            {item.details && <p>商品资料 · {item.details}</p>}
            {priceSource && <p>价格来源 · {priceSource}</p>}
            {item.lockReasons?.length > 0 && <p>锁定原因 · {item.lockReasons.join('、')}</p>}
          </div>
        </details>
      )}
    </main>
  )
}

function CopyRetailQuery({ terms }) {
  const [status, setStatus] = useState('')

  async function copy() {
    try {
      const bridge = window.location.protocol === 'coolcart:' && window.webkit?.messageHandlers?.copyRetailQuery
      if (bridge) {
        if (await bridge.postMessage(terms) !== true) throw new Error('Copy failed')
      } else {
        await navigator.clipboard.writeText(terms)
      }
      setStatus('copied')
    } catch {
      setStatus('manual')
    }
  }

  return <>
    <button className="btn ghost" type="button" onClick={copy}>复制商品名和规格</button>
    {status === 'copied' && <p className="muted small" role="status">已复制，可在京东 App 粘贴搜索。</p>}
    {status === 'manual' && <label className="field-stack">长按复制搜索词
      <input readOnly value={terms} />
    </label>}
  </>
}

function Cooldown({ item, now, onContinue, challengeOffered, onResolveTapChallenge }) {
  const remaining = item.cooldownEndsAt - now
  const ready = remaining <= 0
  const [challengeOpen, setChallengeOpen] = useState(Boolean(challengeOffered && !ready))
  const challengeButton = useRef(null)
  const continueButton = useRef(null)
  const dismissChallenge = () => {
    setChallengeOpen(false)
    requestAnimationFrame(() => (challengeButton.current || continueButton.current)?.focus({ preventScroll: true }))
  }
  return (
    <>
      <div className="cooldown-display">
        <p className="timer" role="timer" aria-label="剩余冷静时间" data-ready={ready}>{fmtClock(remaining)}</p>
        <p role="status">{ready ? '冷静期结束，可以继续。' : '等倒计时结束，再重新考虑这件商品。'}</p>
        {!ready && item.penaltyMs > 0 && <p className="muted small">这件商品已累计加时 {fmtShort(item.penaltyMs)}。</p>}
      </div>
      <div className="cooldown-actions">
        <button ref={continueButton} className="btn primary full-action" disabled={!ready} onClick={onContinue}>查看生活成本</button>
        {!ready && <button ref={challengeButton} className="btn ghost" onClick={() => setChallengeOpen(true)}>手速大战</button>}
      </div>
      {challengeOpen && <TapChallenge item={item} onResolve={onResolveTapChallenge} onDismiss={dismissChallenge} />}
    </>
  )
}

function CostQuiz({ price, mealPrice, meals, hourlyWage, hours, answer, onAnswer, onContinue }) {
  const choices = meals > 2 ? [meals - 2, meals + 3, meals] : [meals + 2, meals, meals + 5]
  return (
    <>
      <div className="quiz-question">
        <h3>这笔钱够吃几顿饭？</h3>
        <p>商品 {yuan(price)}，食堂每餐按 {yuan(mealPrice)} 计算。选最接近的餐数。</p>
        <p className="muted small">按每小时 {yuan(hourlyWage)} 计算，{hours === 0 && price > 0
          ? '相当于不到 0.1 小时兼职。' : `相当于约 ${hours.toLocaleString('zh-CN')} 小时兼职。`}</p>
      </div>
      {!answer ? (
        <div className="quiz-options">
          {choices.map((count) => (
            <button className="btn ghost" key={count} onClick={() => onAnswer({ count, mealPrice })}>{count} 顿</button>
          ))}
        </div>
      ) : (
        <>
          <p className="notice motion-enter" role="status">{answer.count === meals ? '答对了。' : '实际换算结果是'}约 {meals} 顿食堂饭。</p>
          <button className="btn primary full-action" onClick={onContinue}>确认这笔开销</button>
        </>
      )}
    </>
  )
}

function BudgetPreview({ items, item, settings, now, demo, getTotals }) {
  const { budgetCents, candidateCents, monthCents, projectedCents, excessCents } = budgetPreview(items, item, settings, now, { demo }, getTotals)
  return (
    <section className="budget-preview" aria-labelledby="budget-title">
      <h3 id="budget-title">购买前预算预览</h3>
      <dl className="receipt">
        <div><dt>月预算</dt><dd>{budgetCents === null ? '待核对' : formatCents(budgetCents)}</dd></div>
        <div><dt>商品确认单价</dt><dd>{candidateCents === null ? '待核对' : formatCents(candidateCents)}</dd></div>
        <div><dt>本月实付</dt><dd>{monthCents === null ? '超出可计算范围' : formatCents(monthCents)}</dd></div>
        {projectedCents !== null && <div className="receipt-total"><dt>买后预计</dt><dd>{formatCents(projectedCents)}</dd></div>}
        {excessCents !== null && <div className={excessCents > 0 ? 'receipt-over' : undefined}>
          <dt>{excessCents > 0 ? '预计超出预算' : '预计预算剩余'}</dt>
          <dd>{formatCents(excessCents > 0 ? excessCents : budgetCents - projectedCents)}</dd>
        </div>}
      </dl>
      {candidateCents === null && <p className="muted small">核对商品单价后才能估算买后支出。</p>}
      {candidateCents !== null && projectedCents === null && <p className="muted small">买后预计金额超出可计算范围。</p>}
      {budgetCents === null && <p className="muted small">请到设置中核对月预算。</p>}
      {projectedCents !== null && <p className="muted small">预计金额，实付在付款确认后入账。</p>}
    </section>
  )
}

function AddLink({ onUpdate }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  function submit(event) {
    event.preventDefault()
    const product = readProductLink(draft)
    const link = product?.url || safeUrl(draft.trim())
    if (isJdNavigationPage(link)) return setError('请从京东商品详情页复制分享链接。')
    if (!link) return setError('请填写以 http:// 或 https:// 开头的有效商品链接。')
    onUpdate({ link, cartLinkLookup: undefined, ...(product ? { platform: product.platform } : {}) })
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <label>
        补填购买链接
        <input value={draft} onChange={(event) => { setDraft(event.target.value); setError('') }}
          inputMode="url" placeholder="https://..." maxLength={2048} required />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn ghost" type="submit">保存商品链接</button>
    </form>
  )
}

function PaymentCorrections({ item, demo, onCorrect, onWithdraw }) {
  const [action, setAction] = useState(null)
  const [withdrawError, setWithdrawError] = useState(false)
  if (action === 'correct') {
    return <PaymentForm existingPayment={item} demo={demo}
      onCancel={() => setAction(null)}
      onConfirmPurchase={(payment) => {
        if (onCorrect(payment) === false) return false
        setAction(null)
        return true
      }} />
  }
  if (action === 'withdraw') {
    return <div className="notice field-stack motion-enter" role="group" aria-label="确认撤销实付登记">
      <p>撤销后，这笔金额将从账本移除，商品及购买理由会保留，相关回访也将取消。</p>
      {withdrawError && <p role="alert">实付登记未能撤销，请稍后重试。</p>}
      <div className="actions">
        <button className="btn ghost" type="button" onClick={() => { setAction(null); setWithdrawError(false) }}>取消</button>
        <button className="btn ghost" type="button" onClick={() => setWithdrawError(onWithdraw() === false)}>确认撤销登记</button>
      </div>
    </div>
  }
  return <div className="actions">
    <button className="btn ghost" type="button" onClick={() => setAction('correct')}>修改实付</button>
    <button className="btn ghost" type="button" onClick={() => setAction('withdraw')}>撤销实付登记</button>
  </div>
}

function PaymentForm({ price, returnTime, existingPayment, demo, onConfirmPurchase, onCancel }) {
  const [amount, setAmount] = useState(() => {
    if (!existingPayment) return price === null ? '' : String(price)
    const cents = existingPayment.paidCents
    return Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0')
  })
  const [manualTime, setManualTime] = useState(null)
  const [followUpRequested, setFollowUpRequested] = useState(false)
  const [retryPayment, setRetryPayment] = useState(null)
  const [error, setError] = useState('')
  const suggestedAt = existingPayment?.paidAt ?? returnTime
  const suggestedTime = beijingPaymentTime(suggestedAt)
  const useSuggestedTime = manualTime === null && Boolean(suggestedTime)

  function submit(event) {
    event.preventDefault()
    const parsedAmount = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim())
    const paidCents = parsedAmount ? Number(parsedAmount[1]) * 100 + Number((parsedAmount[2] ?? '').padEnd(2, '0')) : NaN
    if (!Number.isSafeInteger(paidCents)) {
      return setError('请填写有效的实付金额，最多两位小数。')
    }
    const confirmedAt = Date.now()
    const paidAt = useSuggestedTime ? suggestedAt : manualTime ? Date.parse(manualTime + '+08:00') : confirmedAt
    if (!Number.isFinite(paidAt) || paidAt > confirmedAt) return setError('请核对北京时间，支付时间须在现在或之前。')
    const payment = retryPayment ?? { paidCents, paidAt, followUpRequested }
    if (onConfirmPurchase(payment) === false) {
      setRetryPayment(payment)
      setError('实付未保存，账本金额保持原值。请留在此页，稍后重试。')
    }
  }

  return (
    <form className="add-form" onSubmit={submit} onChange={() => { setRetryPayment(null); setError('') }}>
      <label>
        实付金额（元）
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
      </label>
      <label>
        支付时间（北京时间）
        <input type="datetime-local" step="1" value={manualTime ?? suggestedTime}
          onChange={(event) => setManualTime(event.target.value)} required={Boolean(existingPayment)}
          aria-describedby="payment-time-hint" />
      </label>
      <p className="muted small" id="payment-time-hint">{existingPayment
        ? '请填写实际付款时间。更改时间后，回访到期时间也会重新计算。'
        : useSuggestedTime
        ? '已填入从商城返回的时间。与实际付款时间不同时，可以修改。清空后使用确认时间。'
        : '留空使用点击确认时的北京时间。补记付款时，请填写实际支付时间。'}</p>
      <p className="muted small">{demo ? '演示记录 · 金额仅计入演示支出' : '用户自报 · 由你填写平台的实际付款金额'}</p>
      {!existingPayment && <label className="check">
        <input type="checkbox" checked={followUpRequested}
          onChange={(event) => setFollowUpRequested(event.target.checked)} />
        {demo ? '演示付款 10 秒后回访这件商品' : '付款一周后回访这件商品'}
      </label>}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary full-action" type="submit">
        {retryPayment ? '重试保存' : existingPayment ? '保存实付修改' : '已支付，确认实付'}
      </button>
      {onCancel && <button className="btn ghost" type="button" onClick={onCancel}>取消修改</button>}
    </form>
  )
}
