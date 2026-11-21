import { PEEK_PENALTY_CAP_MS, PEEK_PENALTY_MS, TAP_CHALLENGE_TARGET } from './config.js'

// 操作来自当前页面，另一标签或保存重试可能已经改变了商品阶段。
function matchesStage(item, shown) {
  return item.id === shown.id && item.stage === shown.stage
}

export function updateCartItem(items, shown, patch) {
  return items.map((item) => {
    if (!matchesStage(item, shown) || item.stage === 'purchased') return item
    const fields = typeof patch === 'function' ? patch(item) : patch
    return { ...item, ...fields }
  })
}

export function removeCartItem(items, shown) {
  if (shown.stage !== 'approved' && shown.stage !== 'abandoned') return items
  return items.filter((item) => !matchesStage(item, shown))
}

export function peekDuringCooldown(item, openedAt) {
  if (item.stage !== 'cooling' || openedAt >= item.cooldownEndsAt) return item
  const penalty = item.penaltyMs ?? 0
  const extra = Math.max(0, Math.min(PEEK_PENALTY_MS, PEEK_PENALTY_CAP_MS - penalty))
  return {
    ...item,
    peeks: (item.peeks ?? 0) + 1,
    penaltyMs: penalty + extra,
    cooldownEndsAt: item.cooldownEndsAt + extra,
  }
}

export function settleTapChallenge(item, round, finishedAt) {
  if (item.stage !== 'cooling' || item.cooldownEndsAt !== round.cooldownEndsAt
    || (item.peeks ?? 0) !== round.peeks || finishedAt >= item.cooldownEndsAt) return item
  if (round.taps < TAP_CHALLENGE_TARGET) return peekDuringCooldown(item, finishedAt)
  return {
    ...item,
    peeks: (item.peeks ?? 0) + 1,
    cooldownEndsAt: Math.max(finishedAt, item.cooldownEndsAt - PEEK_PENALTY_MS),
  }
}

export function finishCooldown(item, clickedAt) {
  return item.stage === 'cooling' && clickedAt >= item.cooldownEndsAt ? { stage: 'quiz' } : {}
}
