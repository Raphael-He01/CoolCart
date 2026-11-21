import { useRef, useState } from 'react'
import { yuanToCents } from '../lib/ledger.js'
import { LOCK_CATEGORIES } from '../lib/rules.js'
import { applyCategoryEdits, applySettingsEdits } from '../lib/settingsEdits.js'
import ReminderSettings from './ReminderSettings.jsx'

const FIELDS = [
  ['mealPrice', '食堂每餐费用（元）'],
  ['hourlyWage', '兼职时薪（元）'],
  ['monthlyBudget', '月度购物预算（元）'],
]

const SUGGESTED_THRESHOLD_YUAN = 100

export default function Settings({ settings, onChange, onReset, onBack, notifications, onReminderChange }) {
  const [amountEdits, setAmountEdits] = useState({})
  const [ruleEdits, setRuleEdits] = useState({})
  const [categoryEdits, setCategoryEdits] = useState(() => new Map())
  const [disabledThresholds, setDisabledThresholds] = useState({})
  const [budgetError, setBudgetError] = useState('')
  const resetDialog = useRef(null)
  const lockRules = { ...settings.lockRules, ...ruleEdits }
  const selected = applyCategoryEdits(settings.lockRules.categories, categoryEdits)
  const categories = [...new Set([...LOCK_CATEGORIES, ...settings.lockRules.categories, ...categoryEdits.keys()])]
  const useThreshold = lockRules.thresholdYuan !== null
  const useCategoryThreshold = lockRules.categoryThresholdYuan !== null

  function updateRules(changes) {
    setRuleEdits((previous) => ({ ...previous, ...changes }))
  }

  function toggleThreshold(key, checked) {
    if (!checked) setDisabledThresholds((previous) => ({ ...previous, [key]: lockRules[key] }))
    updateRules({ [key]: checked ? disabledThresholds[key] ?? SUGGESTED_THRESHOLD_YUAN : null })
  }

  function toggleCategory(category, checked) {
    setCategoryEdits((previous) => new Map(previous).set(category, checked))
  }

  function submit(event) {
    event.preventDefault()
    const amounts = Object.fromEntries(Object.entries(amountEdits).map(([key, value]) => [key, Number(value)]))
    if (amountEdits.monthlyBudget !== undefined && yuanToCents(amounts.monthlyBudget, amountEdits.monthlyBudget) === null) {
      setBudgetError('月度购物预算过大，请填写可按分准确记录的金额。')
      return
    }
    const rules = { ...ruleEdits }
    for (const key of ['thresholdYuan', 'categoryThresholdYuan']) {
      if (rules[key] != null) rules[key] = Number(rules[key])
    }
    onChange((latest) => applySettingsEdits(latest, amounts, rules, categoryEdits))
    onBack()
  }

  return (
    <main className="page page-narrow settings-page">
      <button className="btn ghost back" onClick={onBack}>返回购物车</button>
      <h1>设置</h1>
      <form className="add-form" onSubmit={submit}>
        <section className="pixel-frame panel" aria-labelledby="lock-rules-title">
          <h2 className="panel-heading" id="lock-rules-title">购物锁规则</h2>
          <div className="panel-content field-stack">
            <p className="muted small reading-copy">命中任一启用的规则就上锁。设置只影响新加入的商品。</p>
            <label className="check">
              <input type="checkbox" checked={lockRules.all}
                onChange={(event) => updateRules({ all: event.target.checked })} />
              锁定所有商品
            </label>
            <fieldset className="field-stack settings-categories">
              <legend>锁定品类（可多选）</legend>
              <div className="settings-category-list">
                {categories.map((category) => (
                  <label key={category} className="check">
                    <input type="checkbox" checked={selected.includes(category)}
                      onChange={(event) => toggleCategory(category, event.target.checked)} />
                    {category}
                  </label>
                ))}
              </div>
              {selected.length > 0 && (
                <>
                  <label className="check">
                    <input type="checkbox" checked={useCategoryThreshold}
                      onChange={(event) => toggleThreshold('categoryThresholdYuan', event.target.checked)} />
                    只锁所选品类中超过指定单价的商品
                  </label>
                  {useCategoryThreshold && (
                    <label>
                      所选品类单价门槛（元）
                      <input type="number" inputMode="decimal" min="0" step="0.01" required
                        value={lockRules.categoryThresholdYuan}
                        onChange={(event) => updateRules({ categoryThresholdYuan: event.target.value })} />
                    </label>
                  )}
                </>
              )}
            </fieldset>
            <label className="check">
              <input type="checkbox" checked={useThreshold}
                onChange={(event) => toggleThreshold('thresholdYuan', event.target.checked)} />
              按单价上锁（不限品类）
            </label>
            {useThreshold && (
              <label>
                单价严格高于此金额才锁（元）
                <input type="number" inputMode="decimal" min="0" step="0.01" required
                  value={lockRules.thresholdYuan}
                  onChange={(event) => updateRules({ thresholdYuan: event.target.value })} />
              </label>
            )}
          </div>
        </section>
        <section className="pixel-frame panel" aria-labelledby="settings-budget-title">
          <h2 className="panel-heading" id="settings-budget-title">预算与成本换算</h2>
          <div className="panel-content field-pair settings-amounts">
            {FIELDS.map(([key, label]) => (
              <label key={key}>
                {label}
                <input type="number" inputMode="decimal" min="0.01" step="0.01" required
                  value={amountEdits[key] ?? settings[key]}
                  aria-invalid={key === 'monthlyBudget' && budgetError ? true : undefined}
                  onChange={(event) => {
                    const value = event.target.value
                    setAmountEdits((previous) => ({ ...previous, [key]: value }))
                    if (key === 'monthlyBudget') setBudgetError('')
                  }} />
              </label>
            ))}
            {budgetError && <p className="error" role="alert">{budgetError}</p>}
          </div>
        </section>
        <button className="btn primary full-action" type="submit">保存设置</button>
      </form>
      {notifications?.available && (
        <ReminderSettings settings={settings} notifications={notifications} onChange={onReminderChange} />
      )}
      <button className="btn ghost settings-reset" type="button" onClick={() => {
        resetDialog.current.returnValue = ''
        resetDialog.current.showModal()
      }}>重置本地数据</button>
      <dialog ref={resetDialog} className="pixel-frame panel confirm-dialog" aria-labelledby="reset-title"
        onClose={(event) => { if (event.currentTarget.returnValue === 'reset') onReset() }}>
        <h2 className="panel-heading" id="reset-title">重置本地数据</h2>
        <form method="dialog" className="panel-content field-stack">
          <p>清空此模式下的购物车和设置？</p>
          <div className="actions">
            <button className="btn ghost" value="cancel" autoFocus>取消</button>
            <button className="btn primary" value="reset">确认清空</button>
          </div>
        </form>
      </dialog>
    </main>
  )
}
