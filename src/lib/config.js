// 演示模式：网址后加 ?demo=1，所有等待时间缩短到几秒，方便评委现场体验。
const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
const staticWebDemo = import.meta.env?.VITE_COOLCART_STATIC_DEMO === '1'
const webApiOrigin = (import.meta.env?.VITE_COOLCART_API_ORIGIN || '').replace(/\/$/, '')
export const WEB_AI_DISABLED = staticWebDemo && !webApiOrigin
export const DEMO = staticWebDemo || params.has('demo')

export async function postWebAi(path, body, signal) {
  const crossOrigin = Boolean(webApiOrigin && webApiOrigin !== globalThis.location?.origin)
  try {
    return await fetch(webApiOrigin + path, {
      method: 'POST',
      // A simple cross-origin request avoids a separate Safari preflight.
      headers: { 'Content-Type': crossOrigin ? 'text/plain;charset=UTF-8' : 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error
    if (error instanceof TypeError) throw new Error('无法连接识别服务。已保留截图，请重试或手动填写。')
    throw error
  }
}
// 开发版沿用主屏幕的购物车，只缩短等待时间。演示模式继续使用单独的账本。
export const SHORT_COOLDOWN = DEMO || (globalThis.location?.protocol === 'coolcart:' && params.get('testBuild') === '1')

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN

/** 第 1 关：冷静期时长 */
export const COOLDOWN_MS = SHORT_COOLDOWN ? 30 * SEC : 24 * HOUR
/** 手速大战对冷静时间的单次调整幅度 */
export const PEEK_PENALTY_MS = SHORT_COOLDOWN ? 5 * SEC : 10 * MIN
/** 挑战失败累计加时上限 */
export const PEEK_PENALTY_CAP_MS = SHORT_COOLDOWN ? 30 * SEC : 2 * HOUR
export const TAP_CHALLENGE_MS = 4 * SEC
export const TAP_CHALLENGE_TARGET = 20
/** 第 3 关审讯 3 次都失败后，重新冷静的时长 */
export const RETRY_COOLDOWN_MS = SHORT_COOLDOWN ? COOLDOWN_MS : 2 * HOUR

/** 第 3 关最多审讯轮数 */
export const MAX_TRIAL_ROUNDS = 3
/** 第 3 关理由最少字数 */
export const MIN_REASON_CHARS = 30
/** 第 4 关「确认购买」最多躲几次，之后就跑累了 */
export const MAX_DODGES = 3
