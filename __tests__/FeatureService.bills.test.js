/** Phase 14 E2: mandates captured from SMS, saved bills, "Not a bill", reminders. */
import Storage from '../data/Storage';
import { addMany } from '../data/TransactionRepo';
import { saveMandates, saveBill, confirmSeries, deleteBill, dismissBillPayee } from '../utils/FeatureService';
import { syncSms } from '../utils/SmsSync';
import { suggestions, upcoming, newBill } from '../utils/UpcomingBills';
import { reminderPlan, syncBillReminders } from '../utils/BillReminders';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));
jest.mock('react-native-android-sms-listener', () => ({ addListener: jest.fn() }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => `n${Math.random()}`),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

const fs = require('fs');
const path = require('path');
const owner = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '__fixtures__', 'sms', 'owner_real_samples.json'), 'utf8')
);
const paused = owner.messages.find((m) => m.id === 'axis-autopay-paused-01').body;
const Notifications = require('expo-notifications');
const list = async (k) => JSON.parse((await Storage.getItem(k)) || '[]');
const d = (m, day) => new Date(2026, m - 1, day, 10).toISOString();
const asOf = new Date(2026, 10, 26, 12);

beforeEach(async () => {
  await Storage.clear();
  jest.clearAllMocks();
});

test('mandates: the newest message per payee is kept', async () => {
  await saveMandates([{ key: 'openai', payee: 'OpenAI LLC', status: 'active', date: '2026-10-01' }]);
  await saveMandates([{ key: 'openai', payee: 'OpenAI LLC', status: 'paused', date: '2026-11-04' }, null]);
  expect((await list('mandates')).map((m) => m.status)).toEqual(['paused']);
  await saveMandates();
  expect(await list('mandates')).toHaveLength(1);
});

test('SMS sync saves mandate messages from the scan', async () => {
  const mem = { getItem: async () => null, setItem: async () => {} };
  const m = {
    key: 'openai',
    payee: 'OpenAI LLC',
    status: 'paused',
    amount: 399,
    date: '2026-11-04T00:00:00Z',
  };
  await syncSms({
    scan: async () => ({ ok: true, items: [], mandates: [m] }),
    storage: mem,
    save: async () => ({ addedTxs: [] }),
    notify: async () => {},
    now: () => Date.now(),
  });
  expect(await list('mandates')).toEqual([m]);
});

test('the instant listener saves a paused mandate (and nothing when tracking is off)', async () => {
  const SmsListener = require('react-native-android-sms-listener');
  require('../utils/InstantSmsListener').startSmsListener();
  const handler = SmsListener.addListener.mock.calls[0][0];
  await Storage.setItem('sms_auto_track_enabled', 'false');
  handler({ body: paused, originatingAddress: 'AX-AXISBK', timestamp: Date.now() });
  await new Promise((r) => setTimeout(r, 50));
  expect(await list('mandates')).toEqual([]);
  await Storage.setItem('sms_auto_track_enabled', 'true');
  handler({ body: paused, originatingAddress: 'AX-AXISBK', timestamp: Date.now() });
  await new Promise((r) => setTimeout(r, 50));
  expect((await list('mandates')).map((x) => [x.payee, x.status])).toEqual([['OpenAI LLC', 'paused']]);
});

test('found → Add saves a bill; Not a bill dismisses the payee; delete removes it', async () => {
  const g = (i, m) => ({
    id: `g${i}`,
    type: 'expense',
    amount: 1998.19,
    merchant: 'Google',
    accountId: 'axis',
    fullDate: d(m, 18),
  });
  const s = (i, m) => ({ id: `s${i}`, type: 'expense', amount: 149, merchant: 'Spotify', fullDate: d(m, 2) });
  await addMany(
    [8, 9, 10, 11].flatMap((m, i) => [g(i, m), s(i, m)]),
    { dedup: false }
  );
  const { getAll } = require('../data/TransactionRepo');
  const txs = await getAll();
  const found = suggestions({ txs, asOf });
  expect(found.map((x) => x.name).sort()).toEqual(['Google', 'Spotify']);
  const bill = await confirmSeries(found.find((x) => x.name === 'Google'));
  await dismissBillPayee('spotify');
  await dismissBillPayee('spotify');
  expect(await list('bill_dismissed')).toEqual(['spotify']);
  const bills = await list('recurring_bills');
  expect(bills).toEqual([bill]);
  expect(suggestions({ txs, bills, dismissed: await list('bill_dismissed'), asOf })).toEqual([]);
  expect(upcoming({ txs, bills, asOf }).items.map((i) => [i.name, i.date.slice(0, 7)])).toEqual([
    ['Google', '2026-12'],
  ]);
  await saveBill({ ...bill, reminder: true });
  expect((await list('recurring_bills'))[0].reminder).toBe(true);
  await deleteBill(bill.id);
  expect(await list('recurring_bills')).toEqual([]);
});

test('newBill validates; reminders 2 days before at 9 am, replacing the old ones', async () => {
  expect(() => newBill({ amount: 5, nextDate: asOf }, asOf)).toThrow(/name/);
  expect(() => newBill({ name: 'Gym', nextDate: asOf }, asOf)).toThrow(/amount/);
  expect(() => newBill({ name: 'Gym', amount: 5, cadence: 'daily', nextDate: asOf }, asOf)).toThrow(
    /how often/
  );
  expect(() => newBill({ name: 'Gym', amount: 5, nextDate: new Date(2026, 10, 1) }, asOf)).toThrow(
    /due date/
  );
  expect(() => newBill({ name: 'Gym', amount: 5 }, asOf)).toThrow(/due date/);
  const gym = newBill(
    { name: ' Gym ', amount: '1500', cadence: 'monthly', nextDate: new Date(2026, 11, 5), reminder: true },
    asOf
  );
  expect(gym).toMatchObject({
    key: 'gym',
    name: 'Gym',
    amount: 1500,
    anchorDay: 5,
    stepDays: null,
    source: 'manual',
    reminder: true,
    accountId: null,
  });
  expect(newBill({ name: 'Milk', amount: 1, cadence: 'weekly', nextDate: asOf }, asOf).stepDays).toBe(7);

  const quiet = { ...gym, id: 'q', name: 'Quiet', key: 'quiet', reminder: false };
  const plan = reminderPlan([gym, quiet], [], asOf);
  expect(plan).toEqual([{ billId: gym.id, name: 'Gym', amount: 1500, date: new Date(2026, 11, 3, 9) }]);
  expect(
    reminderPlan([{ ...gym, anchorDay: 27, nextDate: new Date(2026, 10, 27).toISOString() }], [], asOf)[0]
      .date
  ).toEqual(new Date(2026, 11, 25, 9));

  await Storage.setItem('bill_reminder_ids', JSON.stringify(['old']));
  await syncBillReminders([gym], [], { ask: true });
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old');
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({ title: 'Gym due in 2 days', body: '₹1500 · Upcoming bills' }),
    })
  );
  expect(await list('bill_reminder_ids')).toHaveLength(1);
  Notifications.requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
  await expect(syncBillReminders([gym], [], { ask: true })).rejects.toThrow(/permission/);
  await syncBillReminders([quiet], []);
  expect(await list('bill_reminder_ids')).toEqual([]);
});

test('reminders: nothing to plan; first run has no old ids; a custom money format', async () => {
  expect(reminderPlan()).toEqual([]);
  expect(await syncBillReminders([], undefined)).toEqual([]);
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  const gym = newBill({
    name: 'Gym',
    amount: 1500,
    nextDate: new Date(Date.now() + 10 * 86400000),
    reminder: true,
  });
  await syncBillReminders([gym], [], { fmt: (n) => `Rs ${n}` });
  expect(Notifications.scheduleNotificationAsync.mock.calls[0][0].content.body).toBe(
    'Rs 1500 · Upcoming bills'
  );
});
