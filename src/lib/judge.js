import { offlineJudge } from './offlineJudge.js'

/**
 * 让 AI 审查官判定理由。接口失败时自动退回离线规则，保证演示不翻车。
 * @returns {Promise<{ verdict: 'pass'|'fail', score: number, rebuttal: string, source: 'ai'|'offline' }>}
 */
export async function judge(payload) {
  try {
    const res = await fetch('/api/argue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (data.verdict !== 'pass' && data.verdict !== 'fail') throw new Error('bad response')
    return data
  } catch {
    return { ...offlineJudge(payload), source: 'offline' }
  }
}
