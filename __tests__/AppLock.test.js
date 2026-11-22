/** Phase 13 A6: the app is never unmounted by AppLock; the lock is an overlay after 30 s away. */
import React, { useEffect } from 'react';
import { AppState, Pressable, Text } from 'react-native';
import { render, screen, act, fireEvent } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import AppLock, { LOCK_AFTER_MS, shouldLockOnReturn, enableAppLock } from '../components/AppLock';
import { suppressNextLock, isLockSuppressed, FORGIVE_MS } from '../utils/LockSuppress';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(async () => {}) }));
jest.mock('expo-local-authentication', () => ({
  authenticateAsync: jest.fn(async () => ({ success: false })),
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
}));

let emit;
let events;
let presses;
beforeEach(() => {
  events = [];
  presses = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, fn) => {
    emit = fn;
    return { remove: jest.fn() };
  });
  LocalAuthentication.authenticateAsync.mockClear();
  SecureStore.getItemAsync.mockClear();
  LocalAuthentication.authenticateAsync.mockResolvedValue({ success: false });
});
afterEach(() => jest.restoreAllMocks());

function Child() {
  useEffect(() => {
    events.push('mount');
    return () => events.push('unmount');
  }, []);
  return (
    <Pressable testID="child" onPress={() => (presses += 1)}>
      <Text>APP</Text>
    </Pressable>
  );
}

const mount = async (lock) => {
  SecureStore.getItemAsync.mockResolvedValue(lock ? 'true' : 'false');
  render(
    <AppLock>
      <Child />
    </AppLock>
  );
  await act(async () => {});
};
const away = async (ms) => {
  const now = Date.now();
  const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
  await act(async () => emit('inactive'));
  await act(async () => emit('background'));
  spy.mockReturnValue(now + ms);
  await act(async () => emit('active'));
  spy.mockRestore();
};

test('pure rule: lock only when on and away longer than LOCK_AFTER_MS', () => {
  expect(shouldLockOnReturn({ enabled: true, backgroundAt: 0, now: LOCK_AFTER_MS + 1 })).toBe(true);
  expect(shouldLockOnReturn({ enabled: true, backgroundAt: 1, now: LOCK_AFTER_MS })).toBe(false);
  expect(shouldLockOnReturn({ enabled: false, backgroundAt: 1, now: 1e9 })).toBe(false);
  expect(shouldLockOnReturn({ enabled: true, backgroundAt: null, now: 1e9 })).toBe(false);
});

test('lock off: child stays mounted through background → active, no overlay', async () => {
  await mount(false);
  expect(screen.queryByTestId('app-lock-overlay')).toBeNull();
  await away(60 * 1000);
  expect(events).toEqual(['mount']);
  expect(screen.queryByTestId('app-lock-overlay')).toBeNull();
  expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(1);
});

test('the privacy cover shows while not active, without unmounting', async () => {
  await mount(false);
  await act(async () => emit('inactive'));
  expect(screen.getByTestId('app-lock-overlay')).toBeTruthy();
  await act(async () => emit('active'));
  expect(screen.queryByTestId('app-lock-overlay')).toBeNull();
  expect(events).toEqual(['mount']);
});

test('lock on, 10 s away: still mounted and not locked', async () => {
  LocalAuthentication.authenticateAsync.mockResolvedValue({ success: true });
  await mount(true); // cold start: locked, prompt succeeds
  await act(async () => {});
  expect(screen.queryByTestId('app-lock-overlay')).toBeNull();
  await away(10 * 1000);
  expect(screen.queryByTestId('app-lock-overlay')).toBeNull();
  expect(events).toEqual(['mount']);
});

test('lock on, 31 s away: mounted, overlay shown, child not pressable until unlocked', async () => {
  LocalAuthentication.authenticateAsync.mockResolvedValueOnce({ success: true });
  await mount(true);
  await act(async () => {});
  LocalAuthentication.authenticateAsync.mockResolvedValue({ success: false });
  await away(31 * 1000);
  expect(events).toEqual(['mount']);
  expect(screen.getByTestId('app-lock-overlay')).toBeTruthy();
  expect(screen.getByText('WealthManager locked')).toBeTruthy();
  // Hidden from accessibility and not pressable behind the overlay.
  expect(screen.queryByTestId('child')).toBeNull();
  fireEvent.press(screen.getByTestId('child', { includeHiddenElements: true }));
  expect(presses).toBe(0);
  LocalAuthentication.authenticateAsync.mockResolvedValue({ success: true });
  await act(async () => fireEvent.press(screen.getByText('Unlock')));
  expect(screen.queryByTestId('app-lock-overlay')).toBeNull();
  fireEvent.press(screen.getByTestId('child'));
  expect(presses).toBe(1);
});

test('after suppressNextLock() a long picker round-trip does not lock', async () => {
  LocalAuthentication.authenticateAsync.mockResolvedValueOnce({ success: true });
  await mount(true);
  await act(async () => {});
  suppressNextLock();
  await away(5 * 60 * 1000);
  expect(screen.queryByTestId('app-lock-overlay')).toBeNull();
  expect(isLockSuppressed()).toBe(false); // cleared on return
});

test('a suppression not used within a minute expires: Home later and 3 h away still locks', async () => {
  await mount(true);
  await act(async () => {});
  const t0 = Date.now();
  suppressNextLock(t0); // share sheet opened and dismissed without leaving the app
  const spy = jest.spyOn(Date, 'now').mockReturnValue(t0 + 2 * 60 * 1000);
  LocalAuthentication.authenticateAsync.mockResolvedValue({ success: false });
  await act(async () => emit('background'));
  spy.mockReturnValue(t0 + 3 * 60 * 60 * 1000);
  await act(async () => emit('active'));
  spy.mockRestore();
  expect(screen.getByText('WealthManager locked')).toBeTruthy();
});

test('a forgiven picker trip still locks after FORGIVE_MS; the next trip is not forgiven', async () => {
  await mount(true);
  await act(async () => {});
  LocalAuthentication.authenticateAsync.mockResolvedValue({ success: false });
  suppressNextLock();
  await away(FORGIVE_MS + 1000);
  expect(screen.getByText('WealthManager locked')).toBeTruthy();
  expect(shouldLockOnReturn({ enabled: true, backgroundAt: 0, now: FORGIVE_MS, forgiven: true })).toBe(false);
  expect(shouldLockOnReturn({ enabled: true, backgroundAt: 0, now: FORGIVE_MS + 1, forgiven: true })).toBe(
    true
  );
});

test('turning the lock on in Settings reaches a mounted AppLock without re-reading', async () => {
  await mount(false);
  LocalAuthentication.authenticateAsync.mockResolvedValueOnce({ success: true });
  await act(async () => enableAppLock(true));
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('wealthmanager_app_lock', 'true');
  LocalAuthentication.authenticateAsync.mockResolvedValue({ success: false });
  await away(31 * 1000);
  expect(screen.getByText('WealthManager locked')).toBeTruthy();
  expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(1);
});
