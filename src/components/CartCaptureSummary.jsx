import ImportStatus from './ImportStatus.jsx'

export default function CartCaptureSummary({ result, title = '本机识别', canReview = true }) {
  if (!result) return null
  const { added, review, skipped, count, durationMs } = result
  if (!count) return <ImportStatus tone="review" title="未识别到商品。"
    detail="请选择有完整商品行的购物车截屏，或包含商品名和购买按钮的详情图。" />
  const message = [
    added > 0 && `已添加 ${added} 件`,
    review > 0 && `${review} 件待核对`,
    skipped > 0 && `${skipped} 件已有记录`,
    Number.isFinite(durationMs) && durationMs >= 100 && durationMs < 60000
      && `识别用时 ${(durationMs / 1000).toFixed(1)} 秒`,
  ].filter(Boolean).join(' · ')
  const needsReview = review > 0 && canReview
  const destination = needsReview ? 'cart-review-title' : 'cart-items'
  return <ImportStatus tone={needsReview ? 'review' : 'success'} title={`${title} ${count} 件`} detail={message}
    key={`${count}:${message}`} action={(added > 0 || needsReview) && <a href={'#' + destination} onClick={(event) => {
      event.preventDefault()
      document.getElementById(destination)?.scrollIntoView({ block: 'start' })
    }}>{needsReview ? '查看待核对商品' : '查看已导入商品'}</a>} />
}
