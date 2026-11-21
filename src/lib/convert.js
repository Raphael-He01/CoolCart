export const DEFAULT_SETTINGS = {
  mealPrice: 15, // 食堂一顿饭（元）
  hourlyWage: 25, // 兼职时薪（元/小时）
  monthlyBudget: 2000, // 每月生活费（元）
}

/** 把价格换算成大学生能"感受到"的单位 */
export function convert(price, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings }
  return {
    meals: Math.round(price / s.mealPrice),
    hours: Math.round((price / s.hourlyWage) * 10) / 10,
    budgetPct: Math.round((price / s.monthlyBudget) * 100),
  }
}

export function itemMealEstimate(item, settings) {
  const mealPrice = item.quizAnswer?.mealPrice ?? settings.mealPrice
  return { mealPrice, meals: convert(item.price, { mealPrice }).meals }
}

export function yuan(n) {
  return '¥' + Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

/** 01:23:45 */
export function fmtClock(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':')
}

/** 「10 分钟」「5 秒」「2 小时」 */
export function fmtShort(ms) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} 分钟`
  const h = Math.round((m / 60) * 10) / 10
  return `${h} 小时`
}

/** 只允许 http(s) 链接，防止 javascript: 之类的链接被渲染出来 */
export function safeUrl(url) {
  if (!url) return ''
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : ''
  } catch {
    return ''
  }
}
