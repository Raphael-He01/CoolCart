import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateLock } from '../src/lib/rules.js'
import { applySettingsEdits } from '../src/lib/settingsEdits.js'
import { normalizeSettings } from '../src/lib/storage.js'

test('两份设置草稿分别保存预算和锁定范围，保留双方修改及旧版自定义品类', () => {
  const original = normalizeSettings({ lockRules: { categories: ['书籍'] } })
  const other = applySettingsEdits(original, { monthlyBudget: 1234 }, { thresholdYuan: 300 },
    new Map([['学习', true]]))
  const result = applySettingsEdits(other, {}, { all: false }, new Map([['数码', true]]))
  assert.equal(result.monthlyBudget, 1234)
  assert.deepEqual(result.lockRules, {
    all: false, categories: ['书籍', '学习', '数码'], thresholdYuan: 300, categoryThresholdYuan: null,
  })
  assert.equal(evaluateLock({ category: '学习', price: 20 }, result).locked, true)
  assert.equal(evaluateLock({ category: '生活', price: 300 }, result).locked, false)
  assert.equal(evaluateLock({ category: '生活', price: 300.01 }, result).locked, true)
  assert.deepEqual(original.lockRules.categories, ['书籍'])
})

test('移除品类的保存操作可重试，新加入的品类和门槛保留至最后一个品类被移除', () => {
  const original = normalizeSettings({ lockRules: { categories: ['数码'], categoryThresholdYuan: 99 } })
  const removeDigital = (latest) => applySettingsEdits(latest, {}, {}, new Map([['数码', false]]))
  assert.equal(removeDigital(original).lockRules.categoryThresholdYuan, null)
  const other = applySettingsEdits(original, {}, { categoryThresholdYuan: 0 }, new Map([['食品', true]]))
  const retried = removeDigital(other)
  assert.deepEqual(retried.lockRules.categories, ['食品'])
  assert.equal(retried.lockRules.categoryThresholdYuan, 0)
  assert.deepEqual(removeDigital(retried), retried)
})
