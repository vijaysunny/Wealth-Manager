/**
 * SmsTracking.js  (Phase 6)
 * Owns the single real-time SMS listener so Settings can start/stop it immediately
 * and App.js can re-apply the saved flag on start / when returning to the foreground.
 */
import AsyncStorage from '../data/Storage';
import { PermissionsAndroid, Platform } from 'react-native';
import { startSmsListener } from './InstantSmsListener';
import { SMS_FLAG_KEY } from './SmsSync';
import { SMS_PERMISSION_STATE_KEY } from './PermissionHealth';

let subscription = null;

export const isTrackingActive = () => subscription !== null;

export const stopTracking = () => {
  if (subscription) {
    try {
      subscription.remove();
    } catch (e) {
      console.log('Listener remove error:', e);
    }
    subscription = null;
  }
};

export const startTracking = () => {
  if (subscription) return; // never register two listeners
  subscription = startSmsListener();
};

export const isTrackingEnabled = async () => (await AsyncStorage.getItem(SMS_FLAG_KEY)) !== 'false';

export const hasReceivePermission = async () => {
  if (Platform.OS !== 'android') return false;
  try {
    const [read, recv] = await Promise.all([
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS),
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS),
    ]);
    return read && recv;
  } catch {
    return false;
  }
};

// A8: the last answer from Android, so Settings can keep showing "blocked" after the request
export const recordSmsPermissionState = (state) =>
  AsyncStorage.setItem(SMS_PERMISSION_STATE_KEY, String(state));
/** 'granted' when both permissions are held now; otherwise the last recorded answer. */
export const smsPermissionStatus = async () => {
  if (await hasReceivePermission()) return 'granted';
  const last = await AsyncStorage.getItem(SMS_PERMISSION_STATE_KEY);
  return last === 'blocked' ? 'blocked' : 'denied';
};

/** Make the listener match (saved flag AND permission). Returns whether it is now running. */
export const syncTrackingWithFlag = async () => {
  if ((await isTrackingEnabled()) && (await hasReceivePermission())) startTracking();
  else stopTracking();
  return isTrackingActive();
};

/** Called by the Settings switch: persist the flag and apply it right away. */
export const setSmsTracking = async (enabled) => {
  await AsyncStorage.setItem(SMS_FLAG_KEY, enabled ? 'true' : 'false');
  return syncTrackingWithFlag();
};
