import { useCallback, useEffect, useState } from 'react'

/** 倒计时和账本共用同一时刻；应用从后台恢复时立即重新取时。 */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  const refreshNow = useCallback(() => setNow(Date.now()), [])
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (!document.hidden) refreshNow()
    }
    const timer = setInterval(refreshNow, intervalMs)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('pageshow', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('pageshow', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
    }
  }, [intervalMs, refreshNow])
  return [now, refreshNow]
}
