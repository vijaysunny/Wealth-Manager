jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
const scheduled = [];
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { WEEKLY: 'weekly', DAILY: 'daily' },
  getAllScheduledNotificationsAsync: jest.fn(async () => scheduled.slice()),
  cancelScheduledNotificationAsync: jest.fn(async (id) => {
    const i = scheduled.findIndex((n) => n.identifier === id);
    if (i > -1) scheduled.splice(i, 1);
  }),
  scheduleNotificationAsync: jest.fn(async (req) => {
    scheduled.push({ identifier: `n${scheduled.length + 1}`, ...req });
  }),
}));
const { setWalletReconcileReminder, WALLET_REMINDER_KEY } = require('../utils/NotificationService');
const Storage = require('../data/Storage').default;

test('on twice = one weekly reminder; off removes it; flag persisted', async () => {
  expect(await setWalletReconcileReminder(true)).toBe(true);
  await setWalletReconcileReminder(true);
  expect(scheduled).toHaveLength(1);
  expect(scheduled[0].trigger).toMatchObject({ type: 'weekly', weekday: 1, hour: 10 });
  expect(await Storage.getItem(WALLET_REMINDER_KEY)).toBe('true');
  await setWalletReconcileReminder(false);
  expect(scheduled).toHaveLength(0);
  expect(await Storage.getItem(WALLET_REMINDER_KEY)).toBe('false');
});

test('a scheduling failure returns false instead of throwing', async () => {
  require('expo-notifications').getAllScheduledNotificationsAsync.mockRejectedValueOnce(new Error('denied'));
  await expect(setWalletReconcileReminder(true)).resolves.toBe(false);
});
