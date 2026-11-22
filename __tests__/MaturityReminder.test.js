import * as Notifications from 'expo-notifications';
import Storage from '../data/Storage';
import { maturityReminderDate, scheduleMaturityReminder } from '../utils/MaturityReminder';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(async () => 'n1'),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

const now = new Date(2026, 10, 21, 10);
const fd = {
  id: 'fd1',
  name: 'SBI FD',
  subType: 'Fixed Deposit',
  maturityDate: new Date(2027, 0, 10, 12).toISOString(),
};

test('7 days before maturity at 9 am; none when past or unknown', () => {
  const d = maturityReminderDate(fd, now);
  expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2027, 0, 3, 9]);
  expect(maturityReminderDate({ ...fd, maturityDate: new Date(2026, 10, 25).toISOString() }, now)).toBeNull();
  expect(maturityReminderDate({ subType: 'Fixed Deposit' }, now)).toBeNull();
  const rd = { subType: 'Recurring Deposit', startDate: new Date(2026, 5, 1, 12).toISOString(), tenure: 12 };
  expect(maturityReminderDate(rd, now).getMonth()).toBe(4); // matures 1 Jun 2027 → 25 May
});

test('schedule replaces the previous reminder', async () => {
  await scheduleMaturityReminder(fd, now);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.objectContaining({ title: 'SBI FD matures in 7 days' }) })
  );
  expect(await Storage.getItem('maturity_reminder_fd1')).toBe('n1');
  await scheduleMaturityReminder({ ...fd, maturityDate: null }, now);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('n1');
  expect(await Storage.getItem('maturity_reminder_fd1')).toBeNull();
  Notifications.requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
  await expect(scheduleMaturityReminder(fd, now)).rejects.toThrow('Notification permission is required');
});

test('no previous reminder and no date: nothing scheduled', async () => {
  Notifications.scheduleNotificationAsync.mockClear();
  expect(await scheduleMaturityReminder({ id: 'x', subType: 'Fixed Deposit' }, now)).toBeNull();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(maturityReminderDate({ subType: 'Fixed Deposit', maturityDate: 'junk' }, now)).toBeNull();
  expect(maturityReminderDate(fd)).not.toBeUndefined(); // default clock
});
