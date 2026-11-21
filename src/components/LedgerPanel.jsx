import { memo, useMemo } from 'react'
import { formatCents, ledgerDisplayTime, ledgerEntries, totalsForEntries } from '../lib/ledger.js'
import { duePurchaseFollowUps, purchaseFollowUpState } from '../lib/purchaseFollowUp.js'
import ProductPhoto from './ProductPhoto.jsx'
import PixelIcon from './PixelIcon.jsx'
import { FollowUpSummary } from './PurchaseFollowUp.jsx'

const beijingTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export default function LedgerPanel({ items, nowMs, demo = false, onOpenPurchase, onMonthlyReview }) {
  const entries = useMemo(() => ledgerEntries(items, { demo }).sort((a, b) => b.paidAt - a.paidAt), [items, demo])
  const asOf = ledgerDisplayTime(entries, nowMs)
  const { weekCents, monthCents } = useMemo(() => totalsForEntries(entries, asOf), [entries, asOf])
  const due = onOpenPurchase ? duePurchaseFollowUps(entries, nowMs, { demo }) : []
  return (
    <section className="ledger" aria-labelledby="ledger-title">
      <header>
        <div className="ledger-title">
          <h1 id="ledger-title">购物账本{demo && ' · 示例'}</h1>
          <PixelIcon name="coins" className="coin-icon" />
        </div>
        <p className="muted small reading-copy">仅计已确认的实付，按北京时间统计，周一开周。</p>
      </header>
      <dl className="ledger-stats receipt-sheet">
        {[['本月实付', monthCents], ['本周实付', weekCents]].map(([label, cents]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={cents === null ? 'ledger-total muted small' : 'ledger-total ledger-amount'}>
              {cents === null ? '合计超出可计算范围' : formatCents(cents)}
            </dd>
          </div>
        ))}
      </dl>
      {onMonthlyReview && <button className="btn ghost" type="button" onClick={onMonthlyReview}>月度使用复盘</button>}
      {due.length > 0 && (
        <section className="pixel-frame panel" aria-labelledby="ledger-follow-up-title">
          <h2 className="panel-heading" id="ledger-follow-up-title">待回访</h2>
          <div className="panel-content">
            <ul className="ledger-list">
              {due.map((item) => (
                <li key={item.id} className="ledger-row">
                  <span>{item.name || '未命名商品'}</span>
                  <button id={`ledger-follow-up-${item.id}`} className="btn ghost small" type="button"
                    aria-label={`填写回访 · ${item.name || '未命名商品'}`} onClick={(event) => onOpenPurchase(item.id, event.currentTarget)}>填写回访</button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      <LedgerHistory entries={entries} asOf={asOf} demo={demo} onOpenPurchase={onOpenPurchase} />
    </section>
  )
}

const LedgerHistory = memo(function LedgerHistory({ entries, asOf, demo, onOpenPurchase }) {
  return (
    <section className="pixel-frame panel receipt-sheet" aria-labelledby="ledger-entries-title">
      <h2 className="panel-heading" id="ledger-entries-title">已购买</h2>
      <div className="panel-content">
        {entries.length === 0 ? (
          <p className="muted small reading-copy">暂无已确认的付款记录。</p>
        ) : (
          <ul className="ledger-list">
            {entries.map((item) => {
              const name = item.name || '未命名商品'
              const answer = purchaseFollowUpState(item, asOf, { demo })?.answer
              return (
                <li key={item.id} className="ledger-row ledger-entry">
                  <div className="product-summary">
                    <ProductPhoto item={item} compact fallback />
                    <div>
                      <h3>{onOpenPurchase ? (
                        <button id={`ledger-entry-${item.id}`} className="ledger-product-button" type="button"
                          onClick={(event) => onOpenPurchase(item.id, event.currentTarget)}>{name}</button>
                      ) : name}</h3>
                      <p className="ledger-entry-meta muted small reading-copy">
                        <time dateTime={new Date(item.paidAt).toISOString()}>{beijingTime.format(item.paidAt)}</time>
                        <span>{item.source === 'demo' ? '演示确认' : '用户自报'}</span>
                      </p>
                    </div>
                  </div>
                  <p className="ledger-paid">{formatCents(item.paidCents)}</p>
                  {answer && <div className="ledger-note muted small reading-copy"><FollowUpSummary answer={answer} /></div>}
                  {item.paidAt > asOf && <p className="muted small ledger-note reading-copy">付款时间晚于设备当前时间，这笔实付暂未计入合计。</p>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
})
