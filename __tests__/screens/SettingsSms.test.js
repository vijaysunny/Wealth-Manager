/**
 * D4 / A8: Settings shows the SMS-blocked banner when Android answers never_ask_again, and
 * "Open App info" opens the system settings. The switch shows flag && permission.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return { useFocusEffect: (cb) => R.useEffect(cb, []), useNavigation: () => ({ navigate: jest.fn() }) };
});
jest.mock('react-native-webview', () => () => null);
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  AndroidNotificationPriority: { HIGH: 'high' },
  SchedulableTriggerInputTypes: { DAILY: 'daily', WEEKLY: 'weekly' },
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
jest.mock('react-native-get-sms-android', () => ({ list: jest.fn() }));
jest.mock('react-native-android-sms-listener', () => ({
  addListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const RN = require('react-native');
const Storage = require('../../data/Storage').default;

let answer;
beforeEach(async () => {
  await Storage.clear();
  RN.Platform.OS = 'android';
  answer = 'never_ask_again';
  jest.spyOn(RN.PermissionsAndroid, 'check').mockImplementation(async () => answer === 'granted');
  jest
    .spyOn(RN.PermissionsAndroid, 'requestMultiple')
    .mockImplementation(async (perms) => Object.fromEntries(perms.map((p) => [p, answer])));
  jest.spyOn(RN.Linking, 'openSettings').mockImplementation(async () => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  RN.Platform.OS = 'ios';
});

const SettingsScreen = () => require('../../screens/SettingsScreen').default;
const smsSwitch = async () => {
  await screen.findByText('Read bank SMS automatically');
  return screen
    .UNSAFE_getAllByType(RN.Switch)
    .find((x) => x.props.accessibilityLabel === 'Read bank SMS automatically');
};
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), addListener: () => () => {} });

test('requesting both SMS permissions; never_ask_again → blocked banner; Open App info', async () => {
  const S = SettingsScreen();
  render(<S navigation={nav()} />);
  const sw = await smsSwitch();
  expect(sw.props.value).toBe(false); // flag defaults on, but there is no permission
  fireEvent(sw, 'valueChange', true);
  expect(await screen.findByText('SMS tracking is blocked')).toBeTruthy();
  const [perms] = RN.PermissionsAndroid.requestMultiple.mock.calls[0];
  expect(perms).toEqual([
    RN.PermissionsAndroid.PERMISSIONS.READ_SMS,
    RN.PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
  ]);
  // the owner's choice is kept so tracking starts as soon as Android allows it
  expect(await Storage.getItem('sms_auto_track_enabled')).toBe('true');
  fireEvent.press(screen.getByRole('button', { name: 'Open App info' }));
  expect(RN.Linking.openSettings).toHaveBeenCalled();
});

test('a previous block is remembered: the banner shows on open', async () => {
  await Storage.setItem('sms_permission_state', 'blocked');
  const S = SettingsScreen();
  render(<S navigation={nav()} />);
  expect(await screen.findByTestId('sms-blocked-banner')).toBeTruthy();
});

test('granted → no banner and the switch is on', async () => {
  answer = 'granted';
  const S = SettingsScreen();
  render(<S navigation={nav()} />);
  await smsSwitch();
  await waitFor(async () => expect((await smsSwitch()).props.value).toBe(true));
  expect(screen.queryByTestId('sms-blocked-banner')).toBeNull();
  expect(screen.queryByTestId('sms-needed-banner')).toBeNull();
});

describe('C5.8 Settings layout', () => {
  test('grouped sections; rows open their screens; backup status shown', async () => {
    const n = nav();
    const S = SettingsScreen();
    render(<S navigation={n} />);
    expect(await screen.findByText('Capture')).toBeTruthy();
    expect(screen.getByText('Money')).toBeTruthy();
    expect(screen.getByText('Security & backup')).toBeTruthy();
    expect(await screen.findByText('Never backed up')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: /^Backup & restore/ }));
    expect(n.navigate).toHaveBeenCalledWith('Backup');
    fireEvent.press(screen.getByRole('button', { name: /^Categories/ }));
    expect(n.navigate).toHaveBeenCalledWith('Categories');
    fireEvent.press(screen.getByRole('button', { name: 'Scan old SMS now' }));
    expect(n.navigate).toHaveBeenCalledWith('ScanSms');
    expect(screen.getByText('15')).toBeTruthy(); // default category count
  });
});

describe('C5.8 Categories and Backup screens', () => {
  test('add and remove a category', async () => {
    const Categories = require('../../screens/CategoriesScreen').default;
    const Storage = require('../../data/Storage').default;
    const alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    render(<Categories navigation={nav()} />);
    await screen.findByText('Food');
    fireEvent.changeText(screen.getByTestId('new-category'), 'Pets');
    fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    await waitFor(async () => expect(JSON.parse(await Storage.getItem('user_categories'))).toContain('Pets'));
    fireEvent.changeText(screen.getByTestId('new-category'), 'pets');
    fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    expect(alert).toHaveBeenCalledWith('Category', expect.stringMatching(/already/));
    fireEvent.press(screen.getByRole('button', { name: 'Remove Pets' }));
    await alert.mock.calls
      .at(-1)[2]
      .find((b) => b.text === 'Remove')
      .onPress();
    await waitFor(async () =>
      expect(JSON.parse(await Storage.getItem('user_categories'))).not.toContain('Pets')
    );
  });

  test('Backup screen shows Never backed up and the actions', async () => {
    const Backup = require('../../screens/BackupScreen').default;
    render(<Backup navigation={nav()} />);
    expect(await screen.findByText('Never backed up')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restore or merge a backup' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete all data' })).toBeTruthy();
  });
});

test('B1: a backup over 50 MB of files asks first and offers Without files', async () => {
  const { addMany } = require('../../data/TransactionRepo');
  await addMany(
    [
      {
        id: 'big',
        type: 'expense',
        amount: 1,
        fullDate: '2026-11-01T00:00:00Z',
        attachments: [{ id: 'f', name: 'scan.pdf', size: 60 * 1048576 }],
      },
    ],
    { dedup: false }
  );
  const alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
  const Backup = require('../../screens/BackupScreen').default;
  render(<Backup navigation={nav()} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Back up now' }));
  await waitFor(() =>
    expect(alert).toHaveBeenCalledWith('Large backup', expect.stringMatching(/60\.0 MB/), expect.any(Array))
  );
  const buttons = alert.mock.calls.find((c) => c[0] === 'Large backup')[2].map((b) => b.text);
  expect(buttons).toEqual(['Cancel', 'Without files', 'With files']);
});

test('E4: Your UPI ID is saved for People reminders', async () => {
  const S = SettingsScreen();
  render(<S navigation={nav()} />);
  await smsSwitch();
  fireEvent.press(screen.getByRole('button', { name: /Your UPI ID/ }));
  fireEvent.changeText(screen.getByTestId('upi-input'), ' me@okaxis ');
  await act(async () => fireEvent.press(screen.getAllByRole('button', { name: 'Save' })[0]));
  expect(await Storage.getItem('owner_upi_id')).toBe('me@okaxis');
  expect(await screen.findByText('me@okaxis')).toBeTruthy();
});
