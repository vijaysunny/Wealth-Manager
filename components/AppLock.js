import { View, Text } from './Theme';
import React, { useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import AppButton from './ui/AppButton';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
export const LOCK_KEY = 'wealthmanager_app_lock';
export const enableAppLock = async (enabled) => {
  if (enabled) {
    if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync()))
      throw new Error('Set up biometrics in device settings first');
    if (
      !(
        await LocalAuthentication.authenticateAsync({
          promptMessage: 'Enable app lock',
          disableDeviceFallback: true,
        })
      ).success
    )
      throw new Error('Authentication cancelled');
  } else if ((await SecureStore.getItemAsync(LOCK_KEY)) === 'true') {
    if (
      !(
        await LocalAuthentication.authenticateAsync({
          promptMessage: 'Disable app lock',
          disableDeviceFallback: true,
        })
      ).success
    )
      throw new Error('Authentication cancelled');
  }
  await SecureStore.setItemAsync(LOCK_KEY, String(enabled));
};
export default function AppLock({ children }) {
  const [locked, setLocked] = useState(true),
    [loaded, setLoaded] = useState(false),
    [hidden, setHidden] = useState(false),
    [error, setError] = useState('');
  const prompting = useRef(false);
  const unlock = async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock WealthManager',
        disableDeviceFallback: true,
      });
      setLocked(!result.success);
      setError(result.success ? '' : 'Authentication cancelled or failed. Try again.');
    } catch (e) {
      setError(e.message);
    } finally {
      prompting.current = false;
    }
  };
  useEffect(() => {
    SecureStore.getItemAsync(LOCK_KEY)
      .then((value) => {
        setLocked(value === 'true');
        setLoaded(true);
      })
      .catch(() => setError('Could not load app lock settings.'));
    const subscription = AppState.addEventListener('change', (state) => {
      setHidden(state !== 'active');
      if (state === 'background' && !prompting.current) {
        setLocked(true);
        SecureStore.getItemAsync(LOCK_KEY)
          .then((value) => setLocked(value === 'true'))
          .catch(() => setLocked(true));
      }
    });
    return () => subscription.remove();
  }, []);
  if (!loaded || hidden || locked)
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#20242B' }}>
        <Text style={{ color: 'white', fontSize: 20 }}>WealthManager {loaded ? 'locked' : 'loading'}</Text>
        <Text style={{ color: 'white' }}>{error}</Text>
        {loaded && !hidden ? <AppButton title="Unlock" onPress={unlock} /> : null}
      </View>
    );
  return children;
}
