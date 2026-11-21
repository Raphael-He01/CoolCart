import { useState } from 'react'
import { reminderPreferences } from '../lib/cartReminders.js'

const LABELS = [
  ['cooldown', '冷静期结束提醒'],
  ['followUp', '买后回访到期提醒'],
]

export default function ReminderSettings({ settings, notifications, onChange }) {
  const prefs = reminderPreferences(settings.reminders)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const { status, authorize, openSettings } = notifications
  const enabled = prefs.cooldown || prefs.followUp

  async function requestPermission() {
    setBusy(true)
    try {
      await authorize()
    } finally {
      setBusy(false)
    }
  }

  function toggle(kind, checked) {
    const saved = onChange(kind, checked)
    setSaveError(!saved)
    if (saved && checked && status?.permission === 'notDetermined') void requestPermission()
  }

  return (
    <section className="pixel-frame panel" aria-labelledby="reminder-settings-title">
      <h2 className="panel-heading" id="reminder-settings-title">iPhone 到期提醒</h2>
      <div className="panel-content add-form">
        {LABELS.map(([kind, label]) => (
          <label className="check" key={kind}>
            <input type="checkbox" disabled={busy} checked={prefs[kind]}
              onChange={(event) => toggle(kind, event.target.checked)} />
            {label}
          </label>
        ))}
        <p className="muted small reading-copy">回访提醒只用于已开启回访的商品。开关即时保存。</p>
        {enabled && status?.permission === 'denied' && (
          <div className="notice field-stack">
            <p>请在 iPhone 设置中允许 CoolCart 发送通知。</p>
            <button className="btn ghost small" type="button" onClick={openSettings}>打开系统设置</button>
          </div>
        )}
        {enabled && status?.permission === 'notDetermined' && !busy && (
          <button className="btn ghost small" type="button" onClick={requestPermission}>允许 iPhone 通知</button>
        )}
        {enabled && status?.permission === 'allowed' && (
          <p className="muted small reading-copy" role="status">已安排 {status.scheduled} 条到期通知。
            {status.waiting > 0 && '其余较晚的提醒会在下次打开 App 时补排。'}
          </p>
        )}
        {saveError && <p className="error" role="alert">提醒开关暂未保存，请重试。</p>}
        {enabled && status?.failed && (
          <div className="notice field-stack">
            <p>有提醒暂未安排成功。</p>
            <button className="btn ghost small" type="button" onClick={requestPermission}>重试安排通知</button>
          </div>
        )}
      </div>
    </section>
  )
}
