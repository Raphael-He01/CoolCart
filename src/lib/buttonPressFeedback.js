// A touch browser can defer :active until it decides whether the gesture is a scroll.
export function installButtonPressFeedback(root) {
  const listeners = new AbortController()
  const options = { capture: true, passive: true, signal: listeners.signal }
  let pressed = null
  let pointerId = null

  function release() {
    pressed?.removeAttribute('data-pressed')
    pressed = null
    pointerId = null
  }

  function press(event) {
    if (!event.isPrimary || event.pointerType === 'mouse' || event.button !== 0) return
    const target = event.target
    const button = target.closest('.btn.primary') || target.closest('.import-file-picker:not(:has(:disabled))')?.querySelector('.btn.primary')
    if (!button || button.matches(':disabled') || target.matches(':disabled')) return
    release()
    pressed = button
    pointerId = event.pointerId
    pressed.setAttribute('data-pressed', '')
  }

  function end(event) {
    if (event.pointerId === pointerId) release()
  }

  root.addEventListener('pointerdown', press, options)
  window.addEventListener('pointerup', end, options)
  window.addEventListener('pointercancel', end, options)
  window.addEventListener('blur', release, options)
  document.addEventListener('visibilitychange', release, options)
  return () => {
    listeners.abort()
    release()
  }
}
