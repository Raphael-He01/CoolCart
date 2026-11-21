import { useState } from 'react'
import { combinedBudgetPreview, formatCents } from '../lib/ledger.js'
import ProductPhoto from './ProductPhoto.jsx'

function money(cents) {
  return cents === null ? '超出可计算范围' : formatCents(cents)
}

export default function CombinedBudget({ items, settings, now, demo, spendingTotals, onBack }) {
  const [selected, setSelected] = useState(() => new Set())
  const { candidates, count, budgetCents, monthCents, candidateCents, projectedCents, excessCents } =
    combinedBudgetPreview(items, selected, settings, now, { demo }, spendingTotals)

  function toggle(id) {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <main className="page page-narrow report-page">
      <button className="btn ghost back" type="button" onClick={onBack}>返回购物车</button>
      <h1>多件预算预演</h1>
      <section className="pixel-frame panel" aria-labelledby="combined-totals-title">
        <h2 className="panel-heading" id="combined-totals-title">预算合计</h2>
        <div className="panel-content field-stack">
          <dl className="receipt" aria-live="polite">
            <div><dt>月预算</dt><dd>{budgetCents === null ? '待核对' : money(budgetCents)}</dd></div>
            <div><dt>本月实付</dt><dd>{money(monthCents)}</dd></div>
            <div><dt>所选合计（{count} 件）</dt><dd className={count ? 'motion-accent' : undefined}
              key={candidateCents}>{money(candidateCents)}</dd></div>
            {count > 0 && <div className="receipt-total"><dt>买后预计</dt>
              <dd className="motion-accent" key={projectedCents}>{money(projectedCents)}</dd></div>}
            {count > 0 && excessCents !== null && (
              <div className={excessCents > 0 ? 'receipt-over' : undefined}>
                <dt>{excessCents > 0 ? '预计超出预算' : '预计预算剩余'}</dt>
                <dd>{money(excessCents > 0 ? excessCents : budgetCents - projectedCents)}</dd>
              </div>
            )}
          </dl>
          <p className="muted small reading-copy">按已核对的商品单价估算。实付在确认付款后入账。</p>
        </div>
      </section>
      <section className="pixel-frame panel" aria-labelledby="budget-picks-title">
        <h2 className="panel-heading" id="budget-picks-title">勾选商品</h2>
        <div className="panel-content field-stack">
          {candidates.length === 0 && <p className="muted small reading-copy">购物车中还没有可预演的已核价商品。</p>}
          {candidates.length > 0 && (
            <ul className="ledger-list">
              {candidates.map(({ item, cents }) => (
                <li key={item.id}>
                  <label className="check comparison-row">
                    <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
                    <ProductPhoto item={item} compact fallback />
                    <span>{item.name || '未命名商品'}
                      {item.variant && <small className="comparison-variant muted">{item.variant}</small>}
                    </span>
                    <strong>{money(cents)}</strong>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {count > 0 && <button className="btn ghost small" type="button" onClick={() => setSelected(new Set())}>清空勾选</button>}
        </div>
      </section>
    </main>
  )
}
