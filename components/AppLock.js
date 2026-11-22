/**
 * App lock (Phase 13 A6). The app is never unmounted: children always render, and the lock or
 * the privacy cover is an opaque overlay on top. Unmounting rebuilt the navigator on every
 * return from another app, so the owner always came back to Home with their typing lost.
 *
 * - Lock off: the setting is read once at start and again when Settings changes it.
 * - Lock on: locks only after more than LOCK_AFTER_MS in the background. Our own system
 *   dialogs (biometric prompt, pickers, share sheet, settings) call suppressNextLock() first.
 * - While the app is not active (recent-apps view) a plain cover hides the content.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View, Text } from 'react-native';
import AppButton from './ui/AppButton';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { tokens } from './tokens';
import {
  suppressNextLock,
  isLockSuppressed,
  clearLockSuppress,
  whilePrompting,
  isPrompting,
} from '../utils/LockSuppress';

export const LOCK_KEY = 'wealthmanager_app_lock';
export const LOCK_AFTER_MS = 30 * 1000;
export { suppressNextLock };

const settingListeners = new Set();
export const onLockSettingChange = (fn) => {
  settingListeners.add(fn);
  return () => settingListeners.delete(fn);
};

/** Pure: should the app lock when it becomes active again? */
export const shouldLockOnReturn = ({ enabled, backgroundAt, now }) =>
  Boolean(
    enabled && backgroundAt !== null && backgroundAt !== undefined && now - backgroundAt > LOCK_AFTER_MS
  );

const authenticate = (promptMessage) =>
  whilePrompting(() => LocalAuthentication.authenticateAsync({ promptMessage, disableDeviceFallback: true }));

export const enableAppLock = async (enabled) => {
  if (enabled) {
    if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync()))
      throw new Error('Set up biometrics in device settings first');
    if (!(await authenticate('Enable app lock')).success) throw new Error('Authentication cancelled');
  } else if ((await SecureStore.getItemAsync(LOCK_KEY)) === 'true') {
    if (!(await authenticate('Disable app lock')).success) throw new Error('Authentication cancelled');
  }
  await SecureStore.setItemAsync(LOCK_KEY, String(enabled));
  settingListeners.forEach((fn) => fn(enabled));
};

export default function AppLock({ children }) {
  const [enabled, setEnabled] = useState(null); // null until SecureStore answers
  const [locked, setLocked] = useState(false);
  const [covered, setCovered] = useState(false);
  const [error, setError] = useState('');
  const prompting = useRef(false);
  const enabledRef = useRef(null);
  const backgroundAt = useRef(null);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      const result = await authenticate('Unlock WealthManager');
      setLocked(!result.success);
      setError(result.success ? '' : 'Authentication cancelled or failed. Try again.');
    } catch (e) {
      setError(e.message);
    } finally {
      prompting.current = false;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    SecureStore.getItemAsync(LOCK_KEY)
      .then((value) => {
        if (!alive) return;
        const on = value === 'true';
        enabledRef.current = on;
        setEnabled(on);
        setLocked(on); // cold start with the lock on: locked
      })
      .catch(() => {
        if (!alive) return;
        enabledRef.current = false;
        setEnabled(false);
        setError('Could not load app lock settings.');
      });
    const offSetting = onLockSettingChange((on) => {
      enabledRef.current = on;
      setEnabled(on);
    });
    const sub = AppState.addEventListener('change', (state) => {
      const now = Date.now();
      if (state !== 'active') {
        setCovered(true);
        if (
          state === 'background' &&
          backgroundAt.current === null &&
          !isLockSuppressed(now) &&
          !isPrompting()
        )
          backgroundAt.current = now;
        return;
      }
      setCovered(false);
      if (shouldLockOnReturn({ enabled: enabledRef.current, backgroundAt: backgroundAt.current, now }))
        setLocked(true);
      backgroundAt.current = null;
      clearLockSuppress();
    });
    return () => {
      alive = false;
      offSetting();
      sub.remove();
    };
  }, []);

  // Show the fingerprint prompt as soon as the app is locked and visible.
  useEffect(() => {
    if (locked && !covered) unlock();
  }, [locked, covered, unlock]);

  const loading = enabled === null;
  const blocked = loading || locked || covered;
  const bg = tokens.light.ink;
  return (
    <View style={styles.fill}>
      <View
        style={styles.fill}
        pointerEvents={blocked ? 'none' : 'auto'}
        importantForAccessibility={blocked ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={blocked}
      >
        {children}
      </View>
      {blocked ? (
        <View
          testID="app-lock-overlay"
          style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: bg }]}
        >
          {locked ? (
            <>
              <Text style={styles.title}>WealthManager locked</Text>
              {error ? <Text style={styles.body}>{error}</Text> : null}
              {!covered ? <AppButton title="Unlock" onPress={unlock} /> : null}
            </>
          ) : (
            <Text style={styles.title}>WealthManager</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { justifyContent: 'center', padding: 24, gap: 12 },
  title: { color: tokens.light.onPrimary, fontSize: 20 },
  body: { color: tokens.light.inkMuted },
});
