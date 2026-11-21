/** PermissionHealth.js (plan B11) - pure: which user-visible warnings a permission state needs. */

/** Storage key for the last SMS permission answer from Android (A8). */
export const SMS_PERMISSION_STATE_KEY = 'sms_permission_state';

export const permissionWarnings = ({ platform, smsEnabled, smsPermission, notificationsGranted }) => {
  const out = [];
  if (platform !== 'android') return out;
  if (smsEnabled && !smsPermission)
    out.push({
      key: 'sms',
      text: 'SMS access was turned off, so new transactions are not being tracked. Allow SMS in system settings.',
    });
  if (notificationsGranted === false)
    out.push({
      key: 'notifications',
      text: 'Notifications are blocked: you will not see capture or budget alerts.',
    });
  return out;
};

/**
 * A8: state of the SMS permissions from a PermissionsAndroid.requestMultiple() result map.
 * 'blocked' when Android answered never_ask_again for either (Android 13+ "restricted setting"
 * for apps installed from an APK: no dialog is shown at all), 'granted' when READ_SMS and
 * RECEIVE_SMS are both granted, else 'denied'. Only SMS keys count; other keys are ignored.
 */
export const smsPermissionState = (results = {}) => {
  const entries = Object.entries(results || {}).filter(([k]) => /READ_SMS|RECEIVE_SMS/.test(k));
  const values = entries.map(([, v]) => v);
  if (values.includes('never_ask_again')) return 'blocked';
  const granted = (name) => entries.some(([k, v]) => k.includes(name) && v === 'granted');
  return granted('READ_SMS') && granted('RECEIVE_SMS') ? 'granted' : 'denied';
};

/** Which SMS banner Settings shows: 'blocked' | 'needed' | null. */
export const smsBanner = ({ platform, flag, permission, lastState }) => {
  if (platform !== 'android' || permission) return null;
  if (lastState === 'blocked') return 'blocked';
  return flag ? 'needed' : null;
};
