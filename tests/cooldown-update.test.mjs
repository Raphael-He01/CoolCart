import assert from 'node:assert/strict'
import test from 'node:test'
import { finishCooldown, peekDuringCooldown, settleTapChallenge, updateCartItem } from '../src/lib/cartItems.js'
import { PEEK_PENALTY_CAP_MS, PEEK_PENALTY_MS, TAP_CHALLENGE_TARGET } from '../src/lib/config.js'

const shown = { id: 'headphones', stage: 'cooling', cooldownEndsAt: 50000 }

test('两页打开同一件商品时，两次加时都基于最新截止时间', () => {
  const peek = (latest) => peekDuringCooldown(latest, 1000)
  const [first] = updateCartItem([shown], shown, peek)
  const [second] = updateCartItem([first], shown, peek)
  assert.equal(second.peeks, 2)
  assert.equal(second.cooldownEndsAt, shown.cooldownEndsAt + 2 * PEEK_PENALTY_MS)
  const [early] = updateCartItem([second], shown, (latest) => finishCooldown(latest, first.cooldownEndsAt))
  assert.equal(early.stage, 'cooling')
  assert.equal(finishCooldown(second, second.cooldownEndsAt).stage, 'quiz')
})

test('单次加时遵守总上限，截止时刻打开不再加时', () => {
  const nearCap = { ...shown, penaltyMs: PEEK_PENALTY_CAP_MS - 1 }
  const last = peekDuringCooldown(nearCap, 1000)
  assert.equal(last.cooldownEndsAt, shown.cooldownEndsAt + 1)
  assert.equal(peekDuringCooldown(last, 1000).penaltyMs, PEEK_PENALTY_CAP_MS)
  assert.deepEqual(peekDuringCooldown(last, last.cooldownEndsAt), last)
})

test('连点达标减时且不越过现在，过期或重复结算不会调整', () => {
  const item = { ...shown, cooldownEndsAt: PEEK_PENALTY_MS + 50000 }
  const round = { peeks: 0, taps: TAP_CHALLENGE_TARGET, cooldownEndsAt: item.cooldownEndsAt }
  const won = settleTapChallenge(item, round, 1000)
  assert.equal(won.cooldownEndsAt, 50000)
  assert.equal(settleTapChallenge(won, round, 1001), won)
  assert.equal(settleTapChallenge(item, round, item.cooldownEndsAt - 1).cooldownEndsAt, item.cooldownEndsAt - 1)
  assert.equal(settleTapChallenge(item, round, item.cooldownEndsAt), item)
})

test('未达到连点目标沿用加时上限，已进入下一关的记录不回退', () => {
  const item = { ...shown, penaltyMs: PEEK_PENALTY_CAP_MS - 20 }
  const round = { peeks: 0, taps: TAP_CHALLENGE_TARGET - 1, cooldownEndsAt: item.cooldownEndsAt }
  const lost = settleTapChallenge(item, round, 1000)
  assert.equal(lost.penaltyMs, PEEK_PENALTY_CAP_MS)
  assert.equal(lost.cooldownEndsAt, item.cooldownEndsAt + 20)
  const quiz = { ...item, stage: 'quiz' }
  assert.equal(settleTapChallenge(quiz, round, 1000), quiz)
})
