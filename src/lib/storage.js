import { DEFAULT_SETTINGS } from './convert.js'
import { DEMO } from './config.js'
import { normalizeLockRules } from './rules.js'

const KEY = 'coolcart.v1'
const DEMO_KEY = 'coolcart.v1.demo'

function isDemoItem(item) {
  return item?.demo === true || item?.source === 'demo'
}

function readCart(raw) {
  try {
    const cart = JSON.parse(raw)
    if (Array.isArray(cart?.items)) return cart
  } catch {
    // 另一个模式仍可能有可读的记录。
  }
  return null
}

function getDemoItems(shared, demoCart) {
  // 2.1 曾单独保存演示清单，空清单也代表用户已清空。完成迁移后，
  // 以旧版本也能更新的共享清单为准，避免回退期间的增删被旧快照覆盖。
  if (demoCart && !demoCart.itemsInSharedCart) {
    return demoCart.items.map((item) => isDemoItem(item) ? item : { ...item, demo: true })
  }
  return shared?.items.filter(isDemoItem) ?? demoCart?.items ?? []
}

export function onCartStorageChange(refresh) {
  function onStorage(event) {
    if (event.storageArea === localStorage && (event.key === KEY || event.key === DEMO_KEY || event.key === null)) refresh()
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}

export function normalizeSettings(settings) {
  const normalized = { ...DEFAULT_SETTINGS, ...settings, lockRules: normalizeLockRules(settings?.lockRules) }
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    if (!Number.isFinite(normalized[key]) || normalized[key] < 0.01) normalized[key] = fallback
  }
  return normalized
}

export function loadState({ demo = DEMO } = {}) {
  try {
    const shared = readCart(localStorage.getItem(KEY))
    const demoCart = demo ? readCart(localStorage.getItem(DEMO_KEY)) : null
    const items = demo ? getDemoItems(shared, demoCart) : shared?.items.filter((it) => !isDemoItem(it)) ?? []
    const settings = normalizeSettings((demo ? demoCart : shared)?.settings)
    const screenShoppingReceipt = (demo ? demoCart : shared)?.screenShoppingReceipt
    return { items, settings, ...(!demo && Array.isArray(shared?.shareReceipts) && { shareReceipts: shared.shareReceipts }),
      ...(typeof screenShoppingReceipt === 'string' && { screenShoppingReceipt }) }
  } catch {
    // 数据损坏就从头开始
  }
  return { items: [], settings: normalizeSettings() }
}

export function saveState(state, { demo = DEMO } = {}) {
  try {
    const previous = localStorage.getItem(KEY)
    const previousDemo = localStorage.getItem(DEMO_KEY)
    const shared = readCart(previous)
    const demoCart = readCart(previousDemo)
    const normalItems = demo ? shared?.items.filter((it) => !isDemoItem(it)) ?? [] : state.items
    const demoItems = demo ? state.items : getDemoItems(shared, demoCart)
    const next = JSON.stringify({
      items: [...normalItems, ...demoItems],
      settings: demo ? shared?.settings ?? {} : state.settings,
      shareReceipts: demo ? shared?.shareReceipts : state.shareReceipts,
      screenShoppingReceipt: demo ? shared?.screenShoppingReceipt : state.screenShoppingReceipt,
    })
    // 保留 2.1 可读的演示快照及其独立设置。回退到 2.1 后，它再次
    // 写入独立清单时会移除标记，下次升级即可识别那次修改。
    const nextDemo = JSON.stringify({
      items: demoItems,
      settings: demo ? state.settings : demoCart?.settings ?? {},
      screenShoppingReceipt: demo ? state.screenShoppingReceipt : demoCart?.screenShoppingReceipt,
      itemsInSharedCart: true,
    })
    if (next !== previous) localStorage.setItem(KEY, next)
    try {
      if (nextDemo !== previousDemo) localStorage.setItem(DEMO_KEY, nextDemo)
    } catch (error) {
      if (next !== previous) {
        if (previous === null) localStorage.removeItem(KEY)
        else localStorage.setItem(KEY, previous)
      }
      throw error
    }
    return true
  } catch {
    return false
  }
}

export function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
