// 离线审查官：没有 AI Key、断网或 AI 出错时使用的规则判定。
// 浏览器和服务端共用这个文件，所以这里不能用任何浏览器专属 API。

const NEED_WORDS = [
  '坏了', '坏掉', '碎了', '丢了', '摔了', '替换', '换掉', '旧的',
  '上课', '学习', '作业', '课程', '实验', '考试', '论文', '专业',
  '工作', '实习', '面试', '比赛',
  '健康', '医生', '安全', '身体',
  '必须', '刚需', '要求', '每天',
]

const IMPULSE_WORDS = [
  '好看', '可爱', '打折', '便宜', '限时', '优惠', '双十一', '双11',
  '想要', '喜欢', '种草', '博主', '同款', '囤', '凑单', '心动',
  '爆款', '颜值', '新款', '奖励自己', '犒劳',
]

function hits(text, words) {
  return words.filter((w) => text.includes(w))
}

/**
 * @param {{ item: { name: string }, reason: string, round: number }} input
 * @returns {{ verdict: 'pass' | 'fail', score: number, rebuttal: string }}
 */
export function offlineJudge({ item, reason, round = 1 }) {
  const text = String(reason || '')
  const need = hits(text, NEED_WORDS)
  const impulse = hits(text, IMPULSE_WORDS)
  const name = item?.name || '它'

  let score = 35
  score += need.length * 12
  score -= impulse.length * 15
  score += Math.min(20, Math.floor(text.length / 8))
  score += (round - 1) * 8 // 越往后越心软一点
  score = Math.max(0, Math.min(100, score))

  const verdict = score >= 70 ? 'pass' : 'fail'

  let rebuttal
  if (verdict === 'pass') {
    rebuttal = need.length
      ? `“${need[0]}”这个理由勉强成立。行，放你过去——但我会记住你今天说的话。`
      : `说得挺长，看得出你认真想过了。这次放行，别让${name}吃灰。`
  } else if (impulse.length) {
    rebuttal = `“${impulse[0]}”不是理由，是商家写给你的台词。再说一个不靠情绪的理由。`
  } else if (need.length) {
    rebuttal = `你说“${need[0]}”，那没有${name}的这些天你是怎么过来的？说具体点。`
  } else if (text.length < 50) {
    rebuttal = '就这？理由比你的冲动还短。再想想你到底拿它来干什么。'
  } else {
    rebuttal = `我没看出来你非${name}不可。用它解决什么具体问题？现在用什么凑合？`
  }

  return { verdict, score, rebuttal }
}
