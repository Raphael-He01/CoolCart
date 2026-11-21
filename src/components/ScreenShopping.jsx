import { SCREEN_SHOPPING_PHASES } from '../lib/useScreenShopping.js'
import ImportStatus from './ImportStatus.jsx'

export default function ScreenShopping({ controls, busy }) {
  const { status, pending, error, send } = controls
  const active = status.phase !== 'idle' || pending === 'start' || pending === 'stop'
  const message = [SCREEN_SHOPPING_PHASES[status.phase], status.notice].filter(Boolean).join(' ')
  return <div className="import-controls" aria-labelledby="screen-shopping-title">
    <h4 id="screen-shopping-title">屏幕共享识别购物车</h4>
    <p className="muted small">共享后切到购物 App，打开购物车并缓慢滚动。返回时结束识别并添加商品，入库后按名称和规格查找购买页。</p>
    {active
      ? <button type="button" className="btn ghost" disabled={pending === 'stop' || status.phase === 'stopping'}
        onClick={() => send('stop')}>结束录屏识别</button>
      : <button type="button" className="btn ghost" disabled={busy || Boolean(pending) || Boolean(status.batch)}
        onClick={() => send('start')}>开始录屏识别</button>}
    {message && <ImportStatus tone={active ? 'working' : 'neutral'}
      title={active ? '正在处理屏幕共享' : '屏幕共享'} detail={message} />}
    {error && <ImportStatus tone="error" title="屏幕共享未能处理" detail={error.message} />}
    {status.batch && <ImportStatus tone="working" title="正在保存商品" detail="识别到的商品将加入购物车或待核对。" />}
  </div>
}
