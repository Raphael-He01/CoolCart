export function applyCategoryEdits(categories, edits) {
  const selected = new Set(categories)
  for (const [category, checked] of edits) {
    if (checked) selected.add(category)
    else selected.delete(category)
  }
  return [...selected]
}

export function applySettingsEdits(settings, amounts, rules, categoryEdits) {
  const categories = applyCategoryEdits(settings.lockRules.categories, categoryEdits)
  const lockRules = { ...settings.lockRules, ...rules, categories }
  if (!categories.length) lockRules.categoryThresholdYuan = null
  return { ...settings, ...amounts, lockRules }
}
