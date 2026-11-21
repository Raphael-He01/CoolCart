import { purchaseFollowUpState } from './purchaseFollowUp.js'

export function reminderPreferences(settings) {
  return { cooldown: settings?.cooldown === true, followUp: settings?.followUp === true }
}

function validTarget(id, dueAt) {
  return typeof id === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(id) &&
    Number.isSafeInteger(dueAt) && dueAt > 0 && dueAt <= 8.64e15
}

function reminderForItem(item, prefs) {
  if (!item || item.demo === true || item.source === 'demo') return null
  if (prefs.cooldown && item.stage === 'cooling' && validTarget(item.id, item.cooldownEndsAt)) {
    return { itemId: item.id, kind: 'cooldown', dueAt: item.cooldownEndsAt }
  }
  const followUp = prefs.followUp && purchaseFollowUpState(item, 0)
  if (followUp?.status === 'scheduled' && validTarget(item.id, followUp.dueAt)) {
    return { itemId: item.id, kind: 'followUp', dueAt: followUp.dueAt }
  }
  return null
}

export function cartReminderRequests(cart) {
  const prefs = reminderPreferences(cart.settings.reminders)
  return cart.items.map((item) => reminderForItem(item, prefs)).filter(Boolean)
}

export function itemForReminder(cart, target, now) {
  const item = cart.items.find((entry) => entry?.id === target?.itemId)
  const reminder = reminderForItem(item, reminderPreferences(cart.settings.reminders))
  return reminder && target.kind === reminder.kind && target.dueAt === reminder.dueAt && now >= reminder.dueAt ? item : null
}
