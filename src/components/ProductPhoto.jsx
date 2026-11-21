import { useState } from 'react'
import { productImageUrl } from '../lib/productImport.js'
import PixelIcon from './PixelIcon.jsx'

export default function ProductPhoto({ item, compact = false, fallback = false }) {
  const url = productImageUrl(item.imageUrl, item.platform || item.cartLinkLookup?.platform)
  const [failed, setFailed] = useState('')
  if (!url || failed === url) {
    if (!fallback) return null
    const name = /耳机|耳麦|headphones?|earbuds?/iu.test(item.name ?? '') ? 'headphones' : 'cart'
    return <PixelIcon name={name} className={'product-icon' + (compact ? ' compact' : '')} />
  }
  return <img className={compact ? 'product-photo compact' : 'product-photo'}
    src={url} alt={compact ? '' : `${item.name}商品图`} referrerPolicy="no-referrer"
    loading={compact ? 'lazy' : 'eager'} decoding="async" onError={() => setFailed(url)} />
}
