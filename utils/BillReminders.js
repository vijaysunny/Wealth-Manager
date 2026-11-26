/**
 * BillReminders (Phase 14 E2): a reminder 2 days before a saved bill (9 am), for bills with
 * reminder on. Card bills and loans keep their own reminders, so they are never doubled here.
 * syncBillReminders replaces every reminder it scheduled before.
 */
import * as Notifications from 'expo-notifications';
import Storage from '../data/Storage';
import { upcoming } from './UpcomingBills';
import { getAll } from '../data/TransactionRepo';
import { formatMoney } from './Format';

const KEY = 'bill_reminder_ids';
const DAY = 24 * 60 * 60 * 1000;

/** [{ billId, name, amount, date }] for the next date of each bill with a reminder, still to come. */
export const reminderPlan = (bills = [], txs = [], now = new Date()) =>
  upcoming({ bills: bills.filter((b) => b.reminder), txs, asOf: now, days: 60 })
    .items.filter((i) => i.kind === 'bill')
    .map((i) => {
      const d = new Date(new Date(i.date).getTime() - 2 * DAY);
      d.setHours(9, 0, 0, 0);
      return { billId: i.ref.billId, name: i.name, amount: i.amount, date: d };
    })
    // the first reminder still to come per bill (a bill due tomorrow gets next month's)
    .filter((r) => r.date > now)
    .filter((r, n, all) => all.findIndex((x) => x.billId === r.billId) === n);

export const syncBillReminders = async (bills, txs, { ask = false, fmt = (n) => `₹${n}` } = {}) => {
  const previous = JSON.parse((await Storage.getItem(KEY)) || '[]');
  for (const id of previous) await Notifications.cancelScheduledNotificationAsync(id).catch(() => null);
  const plan = reminderPlan(bills, txs);
  if (plan.length && ask) {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') throw new Error('Notification permission is required');
  }
  const ids = [];
  for (const r of plan)
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${r.name} due in 2 days`,
          body: `${fmt(r.amount)} · Upcoming bills`,
          data: { billId: r.billId },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.date },
      })
    );
  await Storage.setItem(KEY, JSON.stringify(ids));
  return plan;
};

/**
 * App start: re-plan from the saved bills, so after a reminder fires the next one is scheduled
 * without opening Upcoming bills. Never asks for permission here.
 */
export const refreshBillReminders = async () => {
  let bills = [];
  try {
    bills = JSON.parse((await Storage.getItem('recurring_bills')) || '[]');
  } catch {
    bills = [];
  }
  if (!Array.isArray(bills)) bills = [];
  const previous = JSON.parse((await Storage.getItem(KEY)) || '[]');
  if (!bills.some((b) => b && b.reminder) && !previous.length) return []; // nothing to do
  return syncBillReminders(bills, await getAll(), { fmt: formatMoney });
};
