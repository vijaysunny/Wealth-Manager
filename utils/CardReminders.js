import * as Notifications from 'expo-notifications';
import Storage from '../data/Storage';
/**
 * Phase 13 review: the old "due day" reminders (12 monthly notifications, card_reminder_<id>)
 * ignore whether the bill is paid. The bill reminder (scheduleBillReminder) replaces them;
 * this cancels any left over. Returns how many were cancelled.
 */
export const cancelOldCardReminders = async (cardIds = []) => {
  let n = 0;
  for (const cardId of cardIds) {
    const key = `card_reminder_${cardId}`;
    const ids = JSON.parse((await Storage.getItem(key)) || '[]');
    if (!ids.length) continue;
    for (const id of ids) await Notifications.cancelScheduledNotificationAsync(id).catch(() => null);
    await Storage.removeItem(key);
    n += ids.length;
  }
  return n;
};

/**
 * Phase 13 B4: one reminder 3 days before the bill's due date (9 am), only while something is
 * left to pay. Re-run whenever a payment or a new bill arrives; it replaces the old reminder.
 * Returns the reminder date, or null when none is needed.
 */
export const billReminderDate = (bill, now = new Date()) => {
  if (!bill || !(bill.left > 0) || !bill.dueDate) return null;
  const d = new Date(bill.dueDate);
  d.setDate(d.getDate() - 3);
  d.setHours(9, 0, 0, 0);
  return d > now ? d : null;
};

export const scheduleBillReminder = async (card, bill, { ask = false } = {}) => {
  const key = `card_bill_reminder_${card.id}`;
  const previous = JSON.parse((await Storage.getItem(key)) || '[]');
  for (const id of previous) await Notifications.cancelScheduledNotificationAsync(id);
  const date = billReminderDate(bill);
  if (!date) {
    await Storage.setItem(key, '[]');
    return null;
  }
  if (ask) {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') throw new Error('Notification permission is required');
  }
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Credit card bill due in 3 days',
      body: `${card.name}: pay before the due date to avoid interest.`,
      data: { cardId: card.id },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
  });
  await Storage.setItem(key, JSON.stringify([id]));
  return date;
};
