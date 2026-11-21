import { yuan } from './convert.js'

export const LOCK_CATEGORIES = Object.freeze(['数码', '生活', '学习', '服饰', '美妆', '食品', '其他'])

function normalizeThreshold(value) {
  return Number.isFinite(value) && value >= 0 ? value : null
}

export function normalizeLockRules(rules) {
  const categories = Array.isArray(rules?.categories)
    ? [...new Set(rules.categories.filter((name) => typeof name === 'string' && name.trim()).map((name) => name.trim()))]
    : []
  return {
    all: typeof rules?.all === 'boolean' ? rules.all : true,
    categories,
    thresholdYuan: normalizeThreshold(rules?.thresholdYuan),
    categoryThresholdYuan: normalizeThreshold(rules?.categoryThresholdYuan),
  }
}

function priceExceeds(price, threshold) {
  return threshold !== null && Number.isFinite(price) && price > threshold
}

export function evaluateLock(item, settings) {
  const { all, categories, thresholdYuan, categoryThresholdYuan } = normalizeLockRules(settings?.lockRules)
  const category = typeof item?.category === 'string' ? item.category.trim() : ''
  const price = item?.price
  const reasons = []
  if (all) reasons.push('全锁已开启')
  if (categories.includes(category)) {
    if (categoryThresholdYuan === null) reasons.push(`品类：${category}`)
    else if (priceExceeds(price, categoryThresholdYuan)) {
      reasons.push(`品类：${category}，且单价高于 ${yuan(categoryThresholdYuan)}`)
    }
  }
  if (priceExceeds(price, thresholdYuan)) {
    reasons.push(`单价高于 ${yuan(thresholdYuan)}`)
  }
  return { locked: reasons.length > 0, reasons }
}
