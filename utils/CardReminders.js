import * as Notifications from 'expo-notifications';
import Storage from '../data/Storage';
export const scheduleCardReminder = async (account, day) => {
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('Due day must be from 1 to 31');
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') throw new Error('Notification permission is required');
  const key = `card_reminder_${account.id}`;
  const previous = JSON.parse((await Storage.getItem(key)) || '[]');
  for (const id of previous) await Notifications.cancelScheduledNotificationAsync(id);
  const now = new Date(),
    ids = [];
  for (let offset = 0; offset < 12; offset++) {
    const due = new Date(now.getFullYear(), now.getMonth() + offset, 1, 9);
    due.setDate(Math.min(day, new Date(due.getFullYear(), due.getMonth() + 1, 0).getDate()));
    if (due <= now) continue;
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Credit card payment due',
          body: `Check the ${account.name} bill and make your payment.`,
          data: { cardId: account.id },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: due },
      })
    );
  }
  await Storage.setItem(key, JSON.stringify(ids));
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
