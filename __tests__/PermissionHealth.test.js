import { permissionWarnings } from '../utils/PermissionHealth';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const base = { platform: 'android', smsEnabled: true, smsPermission: true, notificationsGranted: true };

test('all granted → no warnings; non-android → none', () => {
  expect(permissionWarnings(base)).toEqual([]);
  expect(permissionWarnings({ ...base, platform: 'ios', smsPermission: false })).toEqual([]);
});

test('SMS revoked while tracking is on → warning; tracking off → no warning', () => {
  expect(permissionWarnings({ ...base, smsPermission: false }).map((w) => w.key)).toEqual(['sms']);
  expect(permissionWarnings({ ...base, smsEnabled: false, smsPermission: false })).toEqual([]);
});

test('notifications blocked → warning; unknown status (null) → none', () => {
  expect(permissionWarnings({ ...base, notificationsGranted: false }).map((w) => w.key)).toEqual([
    'notifications',
  ]);
  expect(permissionWarnings({ ...base, notificationsGranted: null })).toEqual([]);
});

test('a blocked notification never throws into SMS capture', async () => {
  jest.resetModules();
  jest.doMock('expo-notifications', () => ({
    setNotificationHandler: jest.fn(),
    AndroidNotificationPriority: { HIGH: 'high' },
    scheduleNotificationAsync: jest.fn().mockRejectedValue(new Error('permission denied')),
    getPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
  }));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const { sendTransactionNotification, notificationsAllowed } = require('../utils/NotificationService');
  await expect(sendTransactionNotification('Expense', '₹100')).resolves.toBeUndefined();
  expect(await notificationsAllowed()).toBe(false);
  warn.mockRestore();
});

describe('A8: smsPermissionState', () => {
  const { smsPermissionState, smsBanner } = require('../utils/PermissionHealth');
  const R = 'android.permission.READ_SMS';
  const V = 'android.permission.RECEIVE_SMS';
  test.each([
    [{ [R]: 'granted', [V]: 'granted' }, 'granted'],
    [{ [R]: 'granted', [V]: 'denied' }, 'denied'],
    [{ [R]: 'denied', [V]: 'denied' }, 'denied'],
    [{ [R]: 'never_ask_again', [V]: 'granted' }, 'blocked'],
    [{ [R]: 'granted', [V]: 'never_ask_again' }, 'blocked'],
    [{ [R]: 'granted' }, 'denied'], // RECEIVE_SMS missing: the live listener cannot run
    [
      { [R]: 'granted', [V]: 'granted', 'android.permission.POST_NOTIFICATIONS': 'never_ask_again' },
      'granted',
    ],
    [{}, 'denied'],
    [null, 'denied'],
  ])('%j → %s', (res, want) => expect(smsPermissionState(res)).toBe(want));

  test('banner: blocked wins; flag on without permission → needed; granted / iOS → none', () => {
    const b = { platform: 'android', flag: true, permission: false, lastState: 'blocked' };
    expect(smsBanner(b)).toBe('blocked');
    expect(smsBanner({ ...b, flag: false })).toBe('blocked');
    expect(smsBanner({ ...b, lastState: 'denied' })).toBe('needed');
    expect(smsBanner({ ...b, lastState: 'denied', flag: false })).toBeNull();
    expect(smsBanner({ ...b, permission: true })).toBeNull();
    expect(smsBanner({ ...b, platform: 'ios' })).toBeNull();
  });
});
