/**
 * MaturityReminder.js (Phase 12 B3) - local notification 7 days before an FD / RD matures,
 * at 9 am. Re-scheduling replaces the old one. A date already past schedules nothing.
 */
import * as Notifications from 'expo-notifications';
import Storage from '../data/Storage';
import { maturityOf } from './DepositValue';

export const REMIND_DAYS_BEFORE = 7;

/** When to remind (Date) or null. Pure. */
export const maturityReminderDate = (account, now = new Date()) => {
  const m = maturityOf(account);
  if (!m) return null;
  const at = new Date(m.getFullYear(), m.getMonth(), m.getDate() - REMIND_DAYS_BEFORE, 9);
  return at > now ? at : null;
};

export const scheduleMaturityReminder = async (account, now = new Date()) => {
  const key = `maturity_reminder_${account.id}`;
  const previous = await Storage.getItem(key);
  if (previous) await Notifications.cancelScheduledNotificationAsync(previous).catch(() => {});
  const date = maturityReminderDate(account, now);
  if (!date) {
    await Storage.removeItem(key);
    return null;
  }
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') throw new Error('Notification permission is required');
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: `${account.name} matures in ${REMIND_DAYS_BEFORE} days`,
      body: 'Decide whether to renew it or move the money.',
      data: { accountId: account.id },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
  });
  await Storage.setItem(key, id);
  return date;
};
