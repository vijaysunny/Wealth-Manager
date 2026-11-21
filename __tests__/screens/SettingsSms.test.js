/**
 * D4 / A8: Settings shows the SMS-blocked banner when Android answers never_ask_again, and
 * "Open App info" opens the system settings. The switch shows flag && permission.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

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
