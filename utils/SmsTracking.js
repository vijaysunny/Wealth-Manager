/**
 * SmsTracking.js  (Phase 6)
 * Owns the single real-time SMS listener so Settings can start/stop it immediately
 * and App.js can re-apply the saved flag on start / when returning to the foreground.
 */
import AsyncStorage from '../data/Storage';
import { PermissionsAndroid, Platform } from 'react-native';
import { startSmsListener } from './InstantSmsListener';
import { SMS_FLAG_KEY } from './SmsSync';

let subscription = null;

export const isTrackingActive = () => subscription !== null;

export const stopTracking = () => {
  if (subscription) {
    try { subscription.remove(); } catch (e) { console.log('Listener remove error:', e); }
    subscription = null;
  }
};

export const startTracking = () => {
  if (subscription) return;                 // never register two listeners
  subscription = startSmsListener();
};

export const isTrackingEnabled = async () => (await AsyncStorage.getItem(SMS_FLAG_KEY)) !== 'false';

const hasReceivePermission = async () => {
  if (Platform.OS !== 'android') return false;
  try {
    const [read, recv] = await Promise.all([
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS),
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS),
    ]);
    return read && recv;
  } catch { return false; }
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
