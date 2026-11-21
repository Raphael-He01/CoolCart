import { useState } from 'react'
import { formatCents } from '../lib/ledger.js'
import { monthlyUsageReview, reviewMonths } from '../lib/monthlyUsageReview.js'
import ProductPhoto from './ProductPhoto.jsx'

export default function MonthlyReview({ items, now, demo, initialMonth, onBack, onOpenPurchase }) {
  const [selected, setSelected] = useState('')
  const months = reviewMonths(items, now, { demo })
  const requestedMonth = selected || initialMonth
  const month = months.includes(requestedMonth) ? requestedMonth : months[0]
  const { purchased, reviewed, paidCents, unused } = monthlyUsageReview(items, month, now, { demo })
  return (
    <main className="page page-narrow report-page monthly-review">
      <button className="btn ghost back" type="button" onClick={onBack}>返回账本</button>
      <h1>月度使用复盘</h1>
      <section className="pixel-frame panel receipt-sheet" aria-labelledby="usage-totals-title">
        <h2 className="panel-heading" id="usage-totals-title">购买与使用</h2>
        <div className="panel-content add-form">
          <label>
            购买月份（北京时间）
            <select value={month} onChange={(event) => setSelected(event.target.value)}>
              {months.map((key) => <option key={key}>{key}</option>)}
            </select>
          </label>
          <dl className="receipt monthly-receipt" aria-live="polite">
            <div className="monthly-paid">
              <dt>当月实付</dt>
              <dd className={paidCents === null ? 'motion-accent muted small' : 'motion-accent big'} key={month}>
                {paidCents === null ? '超出可计算范围' : formatCents(paidCents)}
              </dd>
            </div>
            <div><dt>已购商品</dt><dd>{purchased} 件</dd></div>
            <div><dt>已填写回访</dt><dd>{reviewed} / {purchased} 件</dd></div>
            <div><dt>第一周用过 0 次</dt><dd>{unused.length} 件</dd></div>
          </dl>
          <p className="muted small reading-copy">回访归入商品的购买月份，零次使用按已填写的回答统计。</p>
        </div>
      </section>
      <section className="pixel-frame panel" aria-labelledby="unused-items-title">
        <h2 className="panel-heading" id="unused-items-title">第一周用过 0 次的商品</h2>
        <div className={initialMonth && !selected ? 'panel-content' : 'panel-content motion-enter'} key={month}>
          {!reviewed && <p className="muted small">这个月的商品暂无已填写的回访。</p>}
          {reviewed > 0 && unused.length === 0 && <p className="muted small">已回访的商品在第一周都有使用记录。</p>}
          {unused.length > 0 && (
            <ul className="ledger-list">
              {unused.map((item) => (
                <li className="ledger-row" key={item.id}>
                  <div className="product-summary">
                    <ProductPhoto item={item} compact fallback />
                    <div>
                      <h3>{item.name || '未命名商品'}</h3>
                      <p className="muted small">实付 {formatCents(item.paidCents)}</p>
                    </div>
                  </div>
                  <button id={`monthly-item-${item.id}`} className="btn ghost small" type="button"
                    aria-label={'查看回访 · ' + (item.name || '未命名商品')}
                    onClick={(event) => onOpenPurchase(item.id, month, event.currentTarget)}>查看回访</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  )
}
