import { useState } from 'react'
import { yuan } from '../lib/convert.js'
import { cartImportLabel } from '../lib/capturedCartItems.js'
import CartProductLink from './CartProductLink.jsx'
import ProductPhoto from './ProductPhoto.jsx'
import ReviewScreenshot from './ReviewScreenshot.jsx'
import ImportStatus from './ImportStatus.jsx'

export default function RecognizedCartItems({ items, disabled, onExtract, onDiscard, canLookupCart, onChooseLink, onRetryLookup }) {
  const [filled, setFilled] = useState('')

  function fill(item) {
    const { id, name, variant, platform, link, price, cartImport, imageUrl, details, matchSource, category, priceSource } = item
    onExtract({ name, variant, platform, link, price, cartImport, imageUrl, details, matchSource, category, cartReviewId: id,
      priceSource: price == null ? null : priceSource || 'screen_capture' })
    setFilled(item.id)
  }

  return <ul className="item-list recognized-cart-items" aria-label="待核对的购物车商品">
    {items.map((item) => <li key={item.id}>
      <div className="product-summary">
        <ProductPhoto item={item} compact />
        <strong>{item.name}</strong>
      </div>
      <p className="muted small">
        {[cartImportLabel(item) || item.platform, item.variant, item.price == null ? '单价待核对' :
          (item.priceSource === 'web' ? '公开参考价 ' : '购物车显示单价 ') + yuan(item.price),
          item.cartReviewReason === 'duplicate' && '可能与已有商品重复',
          item.cartReviewReason === 'category' && '请确认品类后执行购物锁规则'].filter(Boolean).join(' · ')}
      </p>
      <ReviewScreenshot item={item} />
      <CartProductLink item={item} available={canLookupCart} disabled={disabled}
        onChoose={(link) => onChooseLink(item.id, link)} onRetry={() => onRetryLookup(item.id)} />
      <div className="actions">
        <button type="button" className="btn ghost" disabled={disabled} onClick={() => fill(item)}>填入商品草稿</button>
        {onDiscard && <button type="button" className="btn ghost" disabled={disabled} onClick={() => onDiscard(item.id)}>移除</button>}
      </div>
      {filled === item.id && <ImportStatus tone="success" title="已填入下方草稿" detail="请核对后加入购物车。" />}
    </li>)}
  </ul>
}
