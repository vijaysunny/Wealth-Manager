import { View, Text } from './Theme';
import React, { useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import AppButton from './ui/AppButton';
import Storage from '../data/Storage';
import { setSmsTracking, recordSmsPermissionState } from '../utils/SmsTracking';
import { smsPermissionState } from '../utils/PermissionHealth';
export default function Onboarding({ children }) {
  const [complete, setComplete] = useState(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    Storage.getItem('onboarding_complete')
      .then((value) => setComplete(value === 'true'))
      .catch(() => setComplete(false));
  }, []);
  const finish = async (enable) => {
    if (busy) return;
    setBusy(true);
    try {
      let allowed = false;
      if (enable && Platform.OS === 'android') {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_SMS,
          PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        ]);
        const state = smsPermissionState(result);
        await recordSmsPermissionState(state);
        allowed = state === 'granted';
      }
      await setSmsTracking(allowed);
      await Storage.setItem('onboarding_complete', 'true');
      setComplete(true);
    } finally {
      setBusy(false);
    }
  };
  if (complete === null) return <View />;
  if (!complete)
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 26, fontWeight: 'bold' }}>Welcome to WealthManager</Text>
        <Text style={{ marginVertical: 20 }}>
          Your finances stay on this device. SMS access lets the app capture bank payments and notifications
          show spending alerts. You can use manual entry without SMS access.
        </Text>
        <AppButton disabled={busy} title="Enable bank SMS tracking" onPress={() => finish(true)} />
        <AppButton disabled={busy} title="Use manual entry" onPress={() => finish(false)} />
      </View>
    );
  return children;
}
