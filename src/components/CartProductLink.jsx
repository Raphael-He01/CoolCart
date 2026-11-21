import { cartLookupInput } from '../lib/cartProductLinks.js'
import { useCartLookupRunning } from '../lib/cartLookupActivity.js'
import { yuan } from '../lib/convert.js'
import ProductPhoto from './ProductPhoto.jsx'
import ImportStatus from './ImportStatus.jsx'

export default function CartProductLink({ item, available, disabled, onChoose, onRetry }) {
  const lookup = item.cartLinkLookup
  const input = cartLookupInput(item)
  const running = useCartLookupRunning(item.id, input)
  if (item.link && lookup?.status === 'linked') {
    return <ImportStatus tone="success"
      title={lookup.method === 'automatic' ? '已自动关联同款购买页' : '已选定购买页'}
      detail={[lookup.platform, lookup.shop].filter(Boolean).join(' · ')} />
  }
  if (!input) return null
  const platform = input.platform || '京东'

  if (lookup?.status === 'choices') return <section className="import-state import-state-review field-stack motion-enter" aria-label="选择购买页">
    <h3>核对同款购买页</h3>
    <p className="muted small">请核对店铺和规格，再选择要关联的商品页。</p>
    <ul className="cart-link-choices">
      {lookup.offers.map((offer) => (
        <li key={offer.link}>
          <div className="product-summary">
            <ProductPhoto item={offer} compact />
            <div className="cart-link-option">
              <p className="item-name">{offer.name}</p>
              <p className="muted small">{offer.platform} · {offer.shop || '店铺待核对'}</p>
              <p className="muted small">
                {offer.variant ? '页面规格 · ' + offer.variant : '规格待核对'}
                {offer.code && ' · 编号 ' + offer.code}
              </p>
              {item.variant && !offer.variantVerified && <p className="muted small">请核对截屏规格「{item.variant}」。</p>}
              {offer.price != null && <p className="muted small">公开参考价 · {yuan(offer.price)}</p>}
              <button type="button" className="btn ghost small" disabled={disabled}
                aria-label={['选择购买页', offer.shop, offer.variant, offer.code || offer.name].filter(Boolean).join(' ')}
                onClick={() => onChoose(offer.link)}>用这个购买页</button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  </section>

  if (!available) return <ImportStatus title="商品查询服务未连接" detail="可手动核对商品信息。" announce={false} />
  if (lookup?.status === 'none' || lookup?.status === 'error') return <ImportStatus
    tone={lookup.status === 'error' ? 'error' : 'review'} title="购买页待核对"
    detail={lookup.status === 'error' ? '暂时无法查找购买页。' : 'DeepSeek 已查询' + platform + '，暂未找到可核对的同款购买页。'}
    action={<button type="button" className="btn ghost small" disabled={disabled} onClick={onRetry}>重新查找购买页</button>} />
  if (!running) return <ImportStatus title="等待查找同款" detail="轮到这件商品时会自动查询。" />
  return <ImportStatus tone="working" title="正在查找同款"
    detail={`DeepSeek 正在${platform}查找同款${input.needsPrice ? '和公开单价' : '购买页'}…`} />
}
