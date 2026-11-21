import { useCallback, useEffect, useEffectEvent, useRef } from 'react'

export function useProductReturn(onReturn) {
  const activeVisit = useRef(null)
  const notify = useEffectEvent(onReturn)

  useEffect(() => {
    function updateVisibility() {
      const visit = activeVisit.current
      if (!visit || visit.returnedAt !== null) return
      if (document.hidden) {
        visit.left = true
      } else if (visit.left) {
        visit.returnedAt = Date.now()
        if (visit.opened) {
          activeVisit.current = null
          notify(visit.itemId, visit.returnedAt)
        }
      }
    }
    document.addEventListener('visibilitychange', updateVisibility)
    return () => document.removeEventListener('visibilitychange', updateVisibility)
  }, [])

  function begin(itemId, waitsForNative, acceptOpen) {
    const visit = { itemId, opened: !waitsForNative, left: false, returnedAt: null }
    activeVisit.current = visit
    return (opened) => {
      if (activeVisit.current !== visit) return
      if (opened && acceptOpen && !acceptOpen()) {
        activeVisit.current = null
        return false
      }
      visit.opened = opened
      if (!opened || visit.returnedAt !== null) activeVisit.current = null
      if (opened && visit.returnedAt !== null) onReturn(itemId, visit.returnedAt)
    }
  }

  const cancel = useCallback(() => {
    activeVisit.current = null
  }, [])

  return { begin, cancel }
}
