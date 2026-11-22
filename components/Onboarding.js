import React, { useEffect, useState } from 'react';
import { PermissionsAndroid, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from './Theme';
import { fonts, space, type } from './tokens';
import AppButton from './ui/AppButton';
import Storage from '../data/Storage';
import { setSmsTracking, recordSmsPermissionState } from '../utils/SmsTracking';
import { smsPermissionState } from '../utils/PermissionHealth';
export default function Onboarding({ children }) {
  const { t } = useAppTheme();
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
  // A3: own background, so dark text never lands on a dark system window.
  if (complete === null) return <View testID="onboarding-root" style={{ flex: 1, backgroundColor: t.bg }} />;
  if (!complete)
    return (
      <SafeAreaView testID="onboarding-root" style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.xxl }}>
          <Text style={[type.title, { color: t.text, fontSize: 28 }]}>Welcome to WealthManager</Text>
          <Text style={[type.body, { color: t.text2, lineHeight: 22, marginTop: space.lg }]}>
            Your finances stay on this device. SMS access lets the app capture bank payments, and
            notifications show spending alerts.
          </Text>
          <Text
            style={[
              type.body,
              { color: t.muted, lineHeight: 22, marginTop: space.sm, marginBottom: space.xxl },
            ]}
          >
            You can use manual entry without SMS access and turn tracking on later in Settings.
          </Text>
          <AppButton disabled={busy} title="Enable bank SMS tracking" onPress={() => finish(true)} />
          <View style={{ height: space.md }} />
          <AppButton
            disabled={busy}
            variant="secondary"
            title="Use manual entry"
            onPress={() => finish(false)}
          />
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: t.muted, marginTop: space.lg }}>
            Nothing is uploaded. AI features are off until you add a key.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  return children;
}
