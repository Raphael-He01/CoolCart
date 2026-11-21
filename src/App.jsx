import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import Home from './components/Home.jsx'
import ItemFlow from './components/ItemFlow.jsx'
import Settings from './components/Settings.jsx'
import CombinedBudget from './components/CombinedBudget.jsx'
import MonthlyReview from './components/MonthlyReview.jsx'
import PixelIcon from './components/PixelIcon.jsx'
import { loadState, newId, normalizeSettings, onCartStorageChange, saveState } from './lib/storage.js'
import { evaluateLock as evaluateSavedRules } from './lib/rules.js'
import { findDuplicateProducts } from './lib/duplicateProducts.js'
import { correctCapturedTitle, importCapturedCart, requiresCaptureCategory } from './lib/capturedCartItems.js'
import { applyScreenShoppingBatch, applyShareInbox, readShareInbox, SHARE_INBOX_EVENT } from './lib/sharedCartImports.js'
import { cartLookupInput, chooseCartLink, finishCartLinkLookup } from './lib/cartProductLinks.js'
import { CartLookupActivity } from './lib/cartLookupActivity.js'
import { hasCartLookup, importHandlers, requestProductImport } from './lib/productImportClient.js'
import { removeCartItem, settleTapChallenge, updateCartItem } from './lib/cartItems.js'
import { duePurchaseFollowUps, reschedulePurchaseFollowUp, updatePurchaseFollowUp } from './lib/purchaseFollowUp.js'
import { canRegisterPayment, correctPayment, registerPayment, withdrawPayment } from './lib/ledger.js'
import { COOLDOWN_MS, DEMO, SHORT_COOLDOWN } from './lib/config.js'
import { useNow } from './lib/useNow.js'
import { useProductReturn } from './lib/useProductReturn.js'
import { itemForReminder, reminderPreferences } from './lib/cartReminders.js'
import { useCartReminders } from './lib/useCartReminders.js'
import { useScreenShopping } from './lib/useScreenShopping.js'

function listPosition(button) {
  const row = button?.closest('li')
  const neighbor = row?.nextElementSibling ?? row?.previousElementSibling
  return {
    buttonId: button?.id,
    neighborId: neighbor?.querySelector('button[id]')?.id,
    rowTop: row?.getBoundingClientRect().top,
    scrollY: window.scrollY,
  }
}

export default function App({ evaluateLock = evaluateSavedRules, spendingTotals, confirmPurchase, LedgerPanel }) {
  const [state, setState] = useState(loadState)
  const [view, setView] = useState({ name: 'home' })
  const [toast, setToast] = useState('')
  const [shareSummary, setShareSummary] = useState(null)
  const saveNotice = useRef(null)
  const unsavedChanges = useRef([])
  const toastTimer = useRef(null)
  const linkRequests = useRef(new Map())
  const [activeLookups, setActiveLookups] = useState(() => new Map())

  const [now, refreshNow] = useNow()
  const items = state.items
  const canLookupCart = hasCartLookup()
  const current = view.name === 'item' ? items.find((it) => it.id === view.id) : null
  if (view.name === 'item' && !current) setView({ ...(view.returnTo ?? { name: 'home' }), motion: 'back' })
  const cooldownEnd = current?.stage === 'cooling' ? current.cooldownEndsAt : null
  const { begin: beginProductVisit, cancel: cancelProductVisit } = useProductReturn((id, paymentReturnAt) => {
    const cart = currentCart()
    const item = cart.items.find((entry) => entry.id === id)
    if (!canRegisterPayment(item) || item.paymentReturnAt >= paymentReturnAt) return
    changeCart((latest) => ({
      ...latest,
      items: updateCartItem(latest.items, item, (entry) =>
        entry.paymentReturnAt >= paymentReturnAt ? {} : { paymentReturnAt }),
    }), cart)
  })
  const navigate = useCallback((nextView, motion = 'forward') => {
    cancelProductVisit()
    clearTimeout(toastTimer.current)
    setToast('')
    refreshNow()
    setView((previous) => ({
      ...nextView,
      motion: previous.name === nextView.name && previous.id === nextView.id ? previous.motion : motion,
    }))
  }, [cancelProductVisit, refreshNow])
  const goLedger = useCallback(() => navigate({ name: 'ledger' }), [navigate])
  const openLedgerItem = useCallback((id, button) => navigate({
    name: 'item', id, returnTo: { name: 'ledger', position: listPosition(button) },
  }), [navigate])
  const notifications = useCartReminders((target) => {
    const cart = loadState()
    const item = itemForReminder(cart, target, Date.now())
    if (item) {
      if (!unsavedChanges.current.length) setState(cart)
      navigate({ name: 'item', id: item.id })
    }
  })
  const syncReminders = notifications.synchronize
  const screenShopping = useScreenShopping(receiveScreenBatch)

  // 在截止时刻解锁按钮，避免 10 秒测试还得等下一次整秒刷新。
  useEffect(() => {
    const remaining = cooldownEnd - Date.now()
    if (remaining > 0 && remaining <= 2147483647) {
      const timer = window.setTimeout(refreshNow, remaining)
      return () => window.clearTimeout(timer)
    }
  }, [cooldownEnd, refreshNow])

  useLayoutEffect(() => {
    saveNotice.current.hidden = saveState(loadState())
    return onCartStorageChange(() => {
      if (!unsavedChanges.current.length) {
        const cart = loadState()
        refreshNow()
        setState(cart)
        syncReminders(cart)
      }
    })
  }, [refreshNow, syncReminders])
  useLayoutEffect(() => {
    const position = view.position
    const button = position && (document.getElementById(position.buttonId) || document.getElementById(position.neighborId))
    const row = button?.closest('li')
    const top = row ? window.scrollY + row.getBoundingClientRect().top - position.rowTop : position?.scrollY ?? 0
    window.scrollTo(0, top)
    button?.focus({ preventScroll: true })
  }, [view])

  const finishLinkRequest = useEffectEvent((id, input, result) => {
    linkRequests.current.delete(id)
    setActiveLookups(new Map(linkRequests.current))
    changeCart((cart) => ({
      ...cart, items: cart.items.map((item) => item.id === id ? finishCartLinkLookup(item, input, result) : item),
    }))
  })

  useEffect(() => {
    if (!canLookupCart || unsavedChanges.current.length) return
    // 自动查找在入库后开始，限制同时查找的商品数，长购物车也能先使用。
    const active = linkRequests.current
    const previousSize = active.size
    for (const item of items) {
      if (active.size >= 2) break
      if (item.cartLinkLookup || active.has(item.id)) continue
      const input = cartLookupInput(item)
      if (!input) continue
      active.set(item.id, input)
      requestProductImport({ cartProduct: input }).then(
        (result) => finishLinkRequest(item.id, input, result),
        () => finishLinkRequest(item.id, input, null),
      )
    }
    if (active.size !== previousSize) setActiveLookups(new Map(active))
  }, [items, canLookupCart])

  const receiveShareBatches = useEffectEvent((batches, receivedAt) => {
    const cart = currentCart()
    const { cart: next, summary } = applyShareInbox(cart, batches, receivedAt, makeCartItem)
    if (next === cart) return true
    const saved = persistCart(next)
    saveNotice.current.hidden = saved
    // The native batch stays in the inbox until the cart and its receipt have
    // been written together. A failed write can be retried without re-sharing.
    if (!saved) return false
    setState(next)
    const counts = [summary.added && '已添加 ' + summary.added + ' 件',
      summary.review && summary.review + ' 件待核对', summary.skipped && summary.skipped + ' 件已有记录'].filter(Boolean)
    if (counts.length) {
      setShareSummary({ ...summary, count: summary.added + summary.review + summary.skipped })
      showToast('截屏分享 · ' + counts.join(' · '))
    }
    return true
  })
  const notifyShareFailure = useEffectEvent(() => showToast('截屏分享暂未同步，请重新打开 CoolCart。'))

  function receiveScreenBatch(batch) {
    const cart = currentCart()
    const { cart: next, summary } = applyScreenShoppingBatch(cart, batch, Date.now(), makeCartItem)
    if (!summary) return null
    const saved = persistCart(next)
    saveNotice.current.hidden = saved
    if (!saved) return false
    setState(next)
    showToast('屏幕共享商品已处理，可回购物车查看。')
    return summary
  }

  useEffect(() => {
    const inbox = !DEMO && importHandlers()?.cartShareInbox
    if (!inbox) return
    let disposed = false
    let reading = false
    let refreshPending = false
    async function receive() {
      if (disposed) return
      if (reading) {
        refreshPending = true
        return
      }
      reading = true
      try {
        const batches = readShareInbox(await inbox.postMessage({ action: 'pending' }))
        if (!disposed && batches.length && receiveShareBatches(batches, Date.now())) {
          await inbox.postMessage({ action: 'acknowledge', ids: batches.map(({ id }) => id) })
        }
      } catch {
        if (!disposed) notifyShareFailure()
      } finally {
        reading = false
        if (refreshPending) {
          refreshPending = false
          void receive()
        }
      }
    }
    const receiveWhenVisible = () => { if (!document.hidden) void receive() }
    const initial = window.setTimeout(receive, 0)
    window.addEventListener(SHARE_INBOX_EVENT, receive)
    document.addEventListener('visibilitychange', receiveWhenVisible)
    return () => {
      disposed = true
      window.clearTimeout(initial)
      window.removeEventListener(SHARE_INBOX_EVENT, receive)
      document.removeEventListener('visibilitychange', receiveWhenVisible)
    }
  }, [])

  function showToast(msg) {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3000)
  }

  // 每次操作从最新记录开始，包括另一标签的修改。写入失败时只保留
  // 尚未写入的操作，重试时仍以最新的本地商品和设置为准。
  function currentCart() {
    return unsavedChanges.current.reduce((cart, apply) => apply(cart), loadState())
  }

  function persistCart(next) {
    const saved = saveState(next)
    if (saved) {
      unsavedChanges.current = []
      syncReminders(next)
    }
    refreshNow()
    return saved
  }

  function changeCart(update, cart = currentCart()) {
    const next = update ? update(cart) : cart
    if (update) unsavedChanges.current.push(update)
    saveNotice.current.hidden = persistCart(next)
    setState(next)
    return next
  }

  /** patch 可以是对象，也可以是 (item) => 对象 */
  function updateItem(shown, patch) {
    changeCart((s) => ({ ...s, items: updateCartItem(s.items, shown, patch) }))
  }

  function retryCartLookup(id) {
    changeCart((cart) => ({
      ...cart, items: cart.items.map((item) => item.id === id && cartLookupInput(item)
        ? { ...item, cartLinkLookup: undefined } : item),
    }))
  }

  function selectCartLink(id, link) {
    changeCart((cart) => ({
      ...cart, items: cart.items.map((item) => item.id === id ? chooseCartLink(item, link) : item),
    }))
  }

  // 保存失败时保留原记录供用户重试。
  function commitItem(shown, update, matches = () => true) {
    const cart = currentCart()
    const index = cart.items.findIndex((item) =>
      item.id === shown.id && item.stage === shown.stage && matches(item))
    const item = cart.items[index]
    const updated = item && update(item)
    if (!item || updated === item) {
      setState(cart)
      return false
    }
    const items = [...cart.items]
    items[index] = updated
    return commitCart({ ...cart, items }, cart)
  }

  function commitCart(next, cart) {
    const saved = persistCart(next)
    if (saved) saveNotice.current.hidden = true
    setState(saved ? next : cart)
    return saved
  }

  function makeCartItem(draft, id, settings, now) {
    const { locked, reasons } = evaluateLock(draft, settings)
    return {
      ...draft, id, demo: DEMO, createdAt: now, lockReasons: reasons,
      ...(locked ? {
        stage: 'cooling',
        cooldownStartedAt: now,
        cooldownEndsAt: now + COOLDOWN_MS,
        peeks: 0,
        penaltyMs: 0,
      } : { stage: 'approved', approvedAt: now }),
    }
  }

  function addItem(draft, acknowledgedIds = [], reviewId) {
    const cart = currentCart()
    if (requiresCaptureCategory(draft, cart.settings)) return 'category'
    const savedProducts = cart.items.filter((item) => item.stage !== 'cartReview')
    const matches = findDuplicateProducts(draft, savedProducts)
    if (matches.exact || matches.items.some((item) => !acknowledgedIds.includes(item.id))) {
      setState(cart)
      return false
    }
    const now = Date.now()
    const review = cart.items.find((item) => item.id === reviewId && item.stage === 'cartReview')
    const id = review?.id ?? newId()
    changeCart((s) => {
      // 存储失败后重试时，另一标签可能已保存同一规格。
      const products = s.items.filter((item) => item.stage !== 'cartReview')
      if (requiresCaptureCategory(draft, s.settings) || products.some((item) => item.id === id)
        || (s !== cart && findDuplicateProducts(draft, products).exact)) return s
      const remaining = s.items.filter((item) => item.id !== id || item.stage !== 'cartReview')
      return { ...s, items: [makeCartItem(draft, id, s.settings, now), ...remaining] }
    }, cart)
    navigate({ name: 'item', id })
    return true
  }

  function addCapturedItems(rows, method, platform) {
    const cart = currentCart()
    const now = Date.now()
    const batch = rows.map((row) => ({ ...row, id: newId() }))
    const importInto = (current) => importCapturedCart(current.items, batch, method, platform,
      (draft, id) => makeCartItem(draft, id, current.settings, now), current.settings)
    const result = importInto(cart)
    if (result.items !== cart.items) {
      changeCart((current) => ({ ...current, items: (current === cart ? result : importInto(current)).items }), cart)
    }
    return { added: result.added, review: result.review, skipped: result.skipped }
  }

  function discardCartReview(id) {
    changeCart((cart) => ({
      ...cart, items: cart.items.filter((item) => item.id !== id || item.stage !== 'cartReview'),
    }))
  }

  function saveCapturedTitle(shown, name) {
    const cart = currentCart()
    const item = cart.items.find(({ id }) => id === shown.id)
    if (!item || item.name !== shown.name) {
      setState(cart)
      return '商品内容已更新，请核对最新名称后重试。'
    }
    const result = correctCapturedTitle(item, name, cart.items)
    if (result.error) return result.error
    if (result.item !== item && !commitCart({ ...cart,
      items: cart.items.map((entry) => entry === item ? result.item : entry) }, cart)) {
      return '名称未保存，请重试。'
    }
    return ''
  }

  function useExistingItem(id, reviewId) {
    const cart = currentCart()
    if (!cart.items.some((item) => item.id === id && item.stage !== 'cartReview')) {
      setState(cart)
      showToast('这条商品记录已移除，请重新选择。')
      return
    }
    if (reviewId) {
      changeCart((latest) => latest.items.some((item) => item.id === id && item.stage !== 'cartReview')
        ? { ...latest, items: latest.items.filter((item) => item.id !== reviewId || item.stage !== 'cartReview') }
        : latest, cart)
    } else setState(cart)
    navigate({ name: 'item', id })
  }

  function retrySave() {
    const cart = currentCart()
    changeCart(undefined, cart)
    window.dispatchEvent(new Event(SHARE_INBOX_EVENT))
    if (current && !cart.items.some((item) => item.id === current.id)) {
      const matches = findDuplicateProducts(current, cart.items.filter((item) => item.stage !== 'cartReview'))
      if (matches.exact && matches.items.length === 1) {
        navigate({ name: 'item', id: matches.items[0].id })
        showToast('这个规格已保存，已打开已有记录。')
      }
    }
  }

  function openItem(id, button) {
    const cart = currentCart()
    const shown = cart.items.find((item) => item.id === id)
    setState(cart)
    navigate({
      name: 'item', id, challengeOffered: shown?.stage === 'cooling' && Date.now() < shown.cooldownEndsAt,
      returnTo: { name: 'home', position: listPosition(button) },
    })
  }

  function resolveTapChallenge(id, round) {
    const cart = currentCart()
    const item = cart.items.find((entry) => entry.id === id)
    const finishedAt = Date.now()
    if (!item || item.stage !== 'cooling' || finishedAt >= item.cooldownEndsAt) return { expired: true }
    const updated = settleTapChallenge(item, round, finishedAt)
    if (updated === item) return { stale: true }
    changeCart((latest) => ({
      ...latest, items: updateCartItem(latest.items, item, (entry) => settleTapChallenge(entry, round, finishedAt)),
    }), cart)
    return { delta: updated.cooldownEndsAt - item.cooldownEndsAt }
  }

  function abandonItem(shown) {
    const abandonedAt = Date.now()
    updateItem(shown, (it) => {
      if (it.stage === 'abandoned' || it.stage === 'purchased') return {}
      return { stage: 'abandoned', prevStage: it.stage, abandonedAt }
    })
  }

  function undoAbandon(shown) {
    updateItem(shown, (it) => {
      if (it.stage !== 'abandoned') return {}
      const stage = it.prevStage && it.prevStage !== 'abandoned' ? it.prevStage : 'cooling'
      return { stage, prevStage: null, abandonedAt: null }
    })
  }

  function openProduct(shown, { productPage, trackReturn, waitsForNative }) {
    if (!canRegisterPayment(shown)) return false
    const matchesLink = (item) => !productPage || item.link === shown.link
    const stillCurrent = () => currentCart().items.some((item) =>
      item.id === shown.id && item.stage === shown.stage && matchesLink(item))

    function acceptOpen() {
      if (!productPage || shown.stage === 'pending') return stillCurrent()
      let saved
      const approvedAt = shown.approvedAt ?? Date.now()
      flushSync(() => {
        saved = commitItem(shown, (item) => ({ ...item, stage: 'pending', approvedAt }), matchesLink)
      })
      return saved
    }

    // Web tabs need a durable record before leaving. The native bridge reports whether it opened.
    if (waitsForNative) return stillCurrent() ? beginProductVisit(shown.id, true, acceptOpen) : false
    if (!acceptOpen()) return false
    return trackReturn ? beginProductVisit(shown.id, false) : true
  }

  function recordPayment(shown, { followUpRequested, ...payment }) {
    return commitItem(shown, (item) => {
      const purchased = registerPayment(item, { ...payment, source: DEMO ? 'demo' : 'self_reported' }, confirmPurchase)
      return followUpRequested === true
        ? updatePurchaseFollowUp(purchased, { type: 'enable' }, Date.now(), { demo: DEMO }) : purchased
    })
  }

  function commitPurchasedItem(shown, update) {
    return shown.stage === 'purchased' && commitItem(shown, update, (item) =>
      item.paidAt === shown.paidAt && item.paidCents === shown.paidCents && item.source === shown.source &&
      JSON.stringify(item.purchaseFollowUp) === JSON.stringify(shown.purchaseFollowUp))
  }

  function amendPayment(shown, payment) {
    return commitPurchasedItem(shown, (item) =>
      reschedulePurchaseFollowUp(item, correctPayment(item, payment), Date.now(), { demo: DEMO }))
  }

  function recordFollowUp(shown, action) {
    return commitPurchasedItem(shown, (item) => updatePurchaseFollowUp(item, action, Date.now(), { demo: DEMO }))
  }

  function deleteItem(shown) {
    const next = changeCart((s) => ({ ...s, items: removeCartItem(s.items, shown) }))
    navigate(view.returnTo ?? { name: 'home' }, 'back')
    if (next.items.some((item) => item.id === shown.id)) showToast('商品状态已更新，已保留这条记录。')
  }

  function resetAll() {
    setShareSummary(null)
    changeCart(({ shareReceipts, screenShoppingReceipt }) =>
      ({ items: [], settings: normalizeSettings(), shareReceipts, screenShoppingReceipt }))
    navigate({ name: 'home' }, 'back')
  }

  function saveReminderPreference(kind, enabled) {
    const cart = currentCart()
    const reminders = { ...reminderPreferences(cart.settings.reminders), [kind]: enabled }
    return commitCart({ ...cart, settings: { ...cart.settings, reminders } }, cart)
  }

  const goHome = () => navigate({ name: 'home' }, 'back')

  return <CartLookupActivity value={activeLookups}>
    <div className="app calm-famicom" data-page-motion={view.motion}>
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" type="button" onClick={() => navigate({ name: 'home' }, 'switch')} aria-label="CoolCart 首页">
            <PixelIcon name="cart" /> CoolCart
          </button>
          <button className="btn ghost small" type="button" aria-current={view.name === 'settings' ? 'page' : undefined}
            onClick={() => { if (view.name !== 'settings') navigate({ name: 'settings' }, 'switch') }}>设置</button>
        </div>
      </header>
      {SHORT_COOLDOWN && <div className="demo-banner">
        {DEMO ? '演示模式' : '测试版'} · 初始冷静期 {COOLDOWN_MS / 1000} 秒{DEMO && ' · 演示支出单独统计'}
      </div>}
      <div ref={saveNotice} hidden className="error storage-notice" role="alert">
        当前更改尚未保存到本机，请先保留此页面。
        <button className="btn ghost" type="button" onClick={retrySave}>重试保存</button>
      </div>

      {view.name === 'home' && (
        <Home
          items={items}
          settings={state.settings}
          now={now}
          canLookupCart={canLookupCart}
          onImportCart={addCapturedItems}
          screenShopping={screenShopping}
          onCorrectCapturedTitle={saveCapturedTitle}
          onDiscardCartReview={discardCartReview}
          onChooseCartLink={selectCartLink}
          onRetryCartLookup={retryCartLookup}
          onAdd={addItem}
          onOpen={openItem}
          onUseExisting={useExistingItem}
          onLedger={goLedger}
          onBudget={() => navigate({ name: 'budget' })}
          shareSummary={shareSummary}
          dueFollowUpCount={LedgerPanel ? duePurchaseFollowUps(items, now, { demo: DEMO }).length : 0}
        />
      )}

      {view.name === 'item' && current && (
        <ItemFlow
          key={current.id}
          item={current}
          settings={state.settings}
          items={items}
          now={now}
          spendingTotals={spendingTotals}
          demo={DEMO}
          challengeOffered={view.challengeOffered}
          onResolveTapChallenge={(round) => resolveTapChallenge(current.id, round)}
          canLookupCart={canLookupCart}
          onChooseCartLink={(link) => selectCartLink(current.id, link)}
          onRetryCartLookup={() => retryCartLookup(current.id)}
          onUpdate={(patch) => updateItem(current, patch)}
          onAbandon={() => abandonItem(current)}
          onUndoAbandon={() => undoAbandon(current)}
          onOpenProduct={(options) => openProduct(current, options)}
          onConfirmPurchase={confirmPurchase && ((payment) => recordPayment(current, payment))}
          onCorrectPayment={(payment) => amendPayment(current, payment)}
          onWithdrawPayment={() => commitPurchasedItem(current, withdrawPayment)}
          onDelete={() => deleteItem(current)}
          onSaveFollowUp={(action) => recordFollowUp(current, action)}
          onBack={view.returnTo ? () => navigate(view.returnTo, 'back') : goHome}
          backLabel={view.returnTo?.name === 'monthly' ? '返回复盘' : view.returnTo?.name === 'ledger' ? '返回账本' : '返回购物车'}
        />
      )}

      {view.name === 'settings' && (
        <Settings
          settings={state.settings}
          onChange={(apply) => changeCart((s) => ({ ...s, settings: apply(s.settings) }))}
          onReset={resetAll}
          onBack={goHome}
          notifications={notifications}
          onReminderChange={saveReminderPreference}
        />
      )}

      {view.name === 'budget' && (
        <CombinedBudget items={items} settings={state.settings} now={now} demo={DEMO}
          spendingTotals={spendingTotals} onBack={goHome} />
      )}

      {view.name === 'monthly' && (
        <MonthlyReview items={items} now={now} demo={DEMO} initialMonth={view.month}
          onBack={() => navigate({ name: 'ledger' }, 'back')}
          onOpenPurchase={(id, month, button) => navigate({
            name: 'item', id, returnTo: { name: 'monthly', month, position: listPosition(button) },
          })} />
      )}

      {view.name === 'ledger' && (
        <main className="page page-narrow">
          <button className="btn ghost back" onClick={goHome}>返回购物车</button>
          {LedgerPanel ? <LedgerPanel items={items} nowMs={now} demo={DEMO} onOpenPurchase={openLedgerItem}
            onMonthlyReview={() => navigate({ name: 'monthly' })} /> : (
            <section className="pixel-frame panel">
              <h1 className="panel-heading">支出记录</h1>
              <p className="panel-content">账本接入后可查看本周和本月实付。</p>
            </section>
          )}
        </main>
      )}

      <div className="toast" role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  </CartLookupActivity>
}
