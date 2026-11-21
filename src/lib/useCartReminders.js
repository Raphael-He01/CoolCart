import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { cartReminderRequests } from './cartReminders.js'
import { DEMO } from './config.js'
import { importHandlers } from './productImportClient.js'
import { loadState } from './storage.js'

const REMINDER_EVENT = 'coolcart:reminders'

export function useCartReminders(openReminder) {
  const [bridge] = useState(() => !DEMO && importHandlers()?.cartReminders)
  const [status, setStatus] = useState(null)
  const previousPlan = useRef(null)
  const revision = useRef(0)
  const handleOpen = useEffectEvent(openReminder)

  const synchronize = useCallback((cart, force = false) => {
    if (!bridge) return
    const requests = cartReminderRequests(cart)
    const signature = JSON.stringify(requests)
    if (!force && previousPlan.current === signature) return
    previousPlan.current = signature
    const current = ++revision.current
    bridge.postMessage({ action: 'sync', requests }).then((result) => {
      if (current !== revision.current) return
      setStatus(result)
      if (result?.failed) previousPlan.current = null
    }, () => {
      if (current !== revision.current) return
      previousPlan.current = null
      setStatus({ failed: true })
    })
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    let disposed = false
    function refresh() {
      synchronize(loadState(), true)
      bridge.postMessage({ action: 'takeOpen' }).then((target) => {
        if (!disposed && target) handleOpen(target)
      }, () => {})
    }
    const initial = window.setTimeout(refresh, 0)
    window.addEventListener(REMINDER_EVENT, refresh)
    return () => {
      disposed = true
      window.clearTimeout(initial)
      window.removeEventListener(REMINDER_EVENT, refresh)
    }
  }, [bridge, synchronize])

  async function authorize() {
    try {
      await bridge.postMessage({ action: 'authorize' })
      synchronize(loadState(), true)
    } catch {
      setStatus({ failed: true })
    }
  }

  async function openSettings() {
    try {
      await bridge.postMessage({ action: 'openSettings' })
    } catch {
      setStatus({ failed: true })
    }
  }

  return { available: Boolean(bridge), status, synchronize, authorize, openSettings }
}
