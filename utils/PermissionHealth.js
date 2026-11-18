/** PermissionHealth.js (plan B11) - pure: which user-visible warnings a permission state needs. */
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
