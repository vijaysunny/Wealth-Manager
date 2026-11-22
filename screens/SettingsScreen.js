/**
 * Settings (Phase 12 C5.8, docs/design/Settings.png).
 * SMS banners (A8) · Capture · Money · Security & backup · More.
 * Categories and Backup & restore are their own screens; AI settings live in AI assistant.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import Storage from '../data/Storage';
import {
  sendBudgetAlert,
  setWalletReconcileReminder,
  WALLET_REMINDER_KEY,
} from '../utils/NotificationService';
import { importAxioData } from '../utils/AxioImporter';
import { APP_VERSION } from '../utils/appInfo';
import {
  setSmsTracking,
  hasReceivePermission,
  smsPermissionStatus,
  syncTrackingWithFlag,
} from '../utils/SmsTracking';
import { smsBanner } from '../utils/PermissionHealth';
import { requestSmsPermission } from '../components/RealSmsReader';
import {
  signInWithGoogle,
  signOutGmail,
  isGmailConnected,
  syncGmailTransactions,
} from '../utils/GmailTracker';
import { isGmailEnabled, isAiAvailable } from '../utils/Features';
import { backupStatus, LAST_BACKUP_KEY } from '../utils/BackupReminder';
import { loadAiSettings, getApiKey, aiSummary } from '../utils/ai/AiConfig';
import { PROVIDERS } from '../utils/ai/AiProviders';
import { LOCK_KEY, enableAppLock } from '../components/AppLock';
import { useAppTheme } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { AppButton, AppSwitch, Banner, ListRow, Section } from '../components/ui';
import { loadCategories } from './CategoriesScreen';
import { suppressNextLock } from '../utils/LockSuppress';

const Group = ({ children, t }) => (
  <View
    style={{
      backgroundColor: t.card,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: radius.lg,
      paddingHorizontal: space.lg,
    }}
  >
    {children}
  </View>
);
const Divider = ({ t }) => <View style={{ height: 1, backgroundColor: t.divider }} />;

export default function SettingsScreen({ navigation }) {
  const { dark, setDark, t } = useAppTheme();
  const [name, setName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [catCount, setCatCount] = useState(0);
  const [accCount, setAccCount] = useState(0);
  const [smsAutoTrack, setSmsAutoTrack] = useState(true); // the saved flag
  const [smsPermission, setSmsPermission] = useState(false);
  const [smsLastState, setSmsLastState] = useState('denied');
  const [walletReminder, setWalletReminder] = useState(false);
  const [locked, setLocked] = useState(false);
  const [backup, setBackup] = useState(null);
  const [aiLine, setAiLine] = useState('');
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailSyncing, setGmailSyncing] = useState(false);

  const load = useCallback(async () => {
    setName((await Storage.getItem('user_name')) || '');
    setCatCount((await loadCategories()).length);
    setAccCount(JSON.parse((await Storage.getItem('user_wealth_accounts')) || '[]').length);
    setSmsAutoTrack((await Storage.getItem('sms_auto_track_enabled')) !== 'false');
    setSmsPermission(await hasReceivePermission());
    setSmsLastState(await smsPermissionStatus());
    setWalletReminder((await Storage.getItem(WALLET_REMINDER_KEY)) === 'true');
    setBackup(backupStatus(await Storage.getItem(LAST_BACKUP_KEY)));
    setLocked((await SecureStore.getItemAsync(LOCK_KEY).catch(() => null)) === 'true');
    setGmailConnected(isGmailEnabled() && (await isGmailConnected()));
    if (isAiAvailable()) {
      const keys = Object.fromEntries(
        await Promise.all(Object.keys(PROVIDERS).map(async (id) => [id, !!(await getApiKey(id))]))
      );
      setAiLine(aiSummary(await loadAiSettings(), keys));
    }
  }, []);

  useEffect(() => {
    load().catch((e) => console.warn('Settings load failed:', e?.message || e));
    const unsubscribe = navigation?.addListener?.('focus', () => load().catch(() => {}));
    // A8: re-check when the owner comes back from App info, and start the listener if now allowed
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      try {
        setSmsPermission(await hasReceivePermission());
        setSmsLastState(await smsPermissionStatus());
        await syncTrackingWithFlag();
      } catch {
        // ignore: the next focus reloads
      }
    });
    return () => {
      sub.remove();
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [load, navigation]);

  const toggleSmsTracking = async (val) => {
    if (val && !smsPermission) {
      // Turning ON: the permission prompt must come from the UI, not from background code.
      // Both READ_SMS and RECEIVE_SMS are needed; if Android blocks them, keep the owner's choice
      // and show the banner with the steps instead of silently turning the switch off (A8).
      const perm = await requestSmsPermission();
      setSmsPermission(perm.granted);
      setSmsLastState(perm.state);
    }
    setSmsAutoTrack(val);
    await setSmsTracking(val); // saves the flag and starts / stops the listener right now
  };

  const saveName = async () => {
    await Storage.setItem('user_name', name.trim());
    setEditingName(false);
  };

  const gmailPress = async () => {
    if (gmailConnected) {
      Alert.alert('Disconnect Gmail', 'Stop syncing Gmail bank emails?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await signOutGmail();
            setGmailConnected(false);
          },
        },
      ]);
      return;
    }
    Alert.alert(
      'Connect Gmail',
      'WealthManager reads your bank transaction emails (read-only). Google OAuth must be set up first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Connect',
          onPress: async () => {
            const result = await signInWithGoogle();
            if (result.success) {
              setGmailConnected(true);
              await gmailSync();
            } else if (result.error === 'not_configured') {
              Alert.alert(
                'Setup required',
                'Set EXPO_PUBLIC_GOOGLE_CLIENT_ID and the Google OAuth redirect first.'
              );
            } else {
              Alert.alert('Could not connect', String(result.error));
            }
          },
        },
      ]
    );
  };

  const gmailSync = async () => {
    setGmailSyncing(true);
    const result = await syncGmailTransactions();
    setGmailSyncing(false);
    if (result.success)
      Alert.alert('Gmail synced', `Added ${result.added}. Skipped ${result.skipped} duplicates.`);
    else if (result.error === 'token_expired') {
      setGmailConnected(false);
      Alert.alert('Session expired', 'Connect Gmail again.');
    } else Alert.alert('Sync error', result.error || 'Unknown error');
  };

  const axioImport = () =>
    Alert.alert('Import Axio data', 'Select your Axio Excel or CSV file.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Select file',
        onPress: async () => {
          const res = await importAxioData();
          if (res.success) Alert.alert('Imported', `${res.count} transactions imported.`);
          else Alert.alert('Import failed', 'Could not read the file.');
        },
      },
    ]);

  const smsBannerKind = smsBanner({
    platform: Platform.OS,
    flag: smsAutoTrack,
    permission: smsPermission,
    lastState: smsLastState,
  });

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          accessibilityRole="header"
          style={{
            color: t.text,
            fontFamily: fonts.display,
            fontSize: 30,
            paddingTop: space.lg,
            paddingBottom: space.md,
          }}
        >
          Settings
        </Text>

        {smsBannerKind === 'blocked' && (
          <Banner
            testID="sms-blocked-banner"
            tone="danger"
            title="SMS tracking is blocked"
            body="Android blocks SMS access for apps installed from an APK. Open App info, tap ⋮, then Allow restricted settings. Then allow SMS under Permissions."
            action={{ label: 'Open App info', onPress: () => (suppressNextLock(), Linking.openSettings()) }}
          />
        )}
        {smsBannerKind === 'needed' && (
          <Banner
            testID="sms-needed-banner"
            tone="warn"
            title="SMS permission needed"
            body="Auto-tracking is on but the app cannot read or receive SMS. Allow Read and Receive SMS."
            action={{ label: 'Allow SMS', onPress: () => toggleSmsTracking(true) }}
          />
        )}

        <Section title="Capture">
          <Group t={t}>
            <AppSwitch
              label="Read bank SMS automatically"
              sublabel="Needs Read + Receive SMS"
              value={smsAutoTrack && smsPermission}
              onValueChange={toggleSmsTracking}
            />
            <Divider t={t} />
            <ListRow label="Scan old SMS now" onPress={() => navigation.navigate('ScanSms')} />
            <Divider t={t} />
            <ListRow
              label="Review captured transactions"
              onPress={() => navigation.navigate('ReviewAccounts', { tab: 'check' })}
            />
            {isAiAvailable() && (
              <>
                <Divider t={t} />
                <ListRow
                  label="AI assistant"
                  sublabel={aiLine}
                  onPress={() => navigation.navigate('AiAssistant')}
                />
              </>
            )}
            <Divider t={t} />
            <AppSwitch
              label="Weekly wallet reconcile reminder"
              value={walletReminder}
              onValueChange={async (on) => {
                setWalletReminder(on);
                if (!(await setWalletReconcileReminder(on))) {
                  setWalletReminder(!on);
                  Alert.alert(
                    'Reminder',
                    'Could not change the reminder. Check the notification permission.'
                  );
                }
              }}
            />
            {isGmailEnabled() && (
              <>
                <Divider t={t} />
                <ListRow
                  label={gmailConnected ? 'Gmail connected' : 'Connect Gmail'}
                  sublabel={
                    gmailSyncing ? 'Syncing…' : 'Reads bank transaction emails; duplicates are skipped'
                  }
                  onPress={gmailPress}
                />
                {gmailConnected && (
                  <>
                    <Divider t={t} />
                    <ListRow label="Sync Gmail now" onPress={() => !gmailSyncing && gmailSync()} />
                  </>
                )}
              </>
            )}
          </Group>
        </Section>

        <Section title="Money">
          <Group t={t}>
            <ListRow
              label="Accounts & cards"
              value={String(accCount)}
              onPress={() => navigation.navigate('Main', { screen: 'AccountsTab' })}
            />
            <Divider t={t} />
            <ListRow
              label="Categories"
              value={String(catCount)}
              onPress={() => navigation.navigate('Categories')}
            />
            <Divider t={t} />
            <ListRow
              label="Category rules"
              onPress={() => navigation.navigate('MoneyTool', { tab: 'Rules' })}
            />
            <Divider t={t} />
            <ListRow
              label="New transfer between accounts"
              onPress={() => navigation.navigate('MoneyTool', { tab: 'Transfers' })}
            />
            <Divider t={t} />
            <ListRow label="Recurring transactions" onPress={() => navigation.navigate('Recurring')} />
            <Divider t={t} />
            <ListRow
              label="Import bank statement"
              sublabel="Excel or PDF"
              onPress={() => navigation.navigate('Import')}
            />
            <Divider t={t} />
            <ListRow label="Import Axio report" onPress={axioImport} />
          </Group>
        </Section>

        <Section title="Security & backup">
          <Group t={t}>
            <AppSwitch label="Dark mode" value={dark} onValueChange={(v) => setDark(v)} />
            <Divider t={t} />
            <AppSwitch
              label="Fingerprint lock"
              value={locked}
              onValueChange={async (v) => {
                try {
                  await enableAppLock(v);
                  setLocked(v);
                } catch (e) {
                  Alert.alert('App lock', e.message);
                }
              }}
            />
            <Divider t={t} />
            <ListRow
              label="Backup & restore"
              sublabel={backup ? (backup.days === null ? 'Never backed up' : backup.label) : null}
              onPress={() => navigation.navigate('Backup')}
            />
          </Group>
        </Section>

        <Section title="More">
          <Group t={t}>
            {editingName ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: space.sm }}>
                <TextInput
                  testID="name-input"
                  accessibilityLabel="Your name"
                  value={name}
                  onChangeText={setName}
                  autoFocus
                  onSubmitEditing={saveName}
                  style={{
                    flex: 1,
                    color: t.text,
                    fontFamily: fonts.body,
                    fontSize: 16,
                    borderBottomWidth: 1,
                    borderColor: t.primary,
                    paddingVertical: space.sm,
                  }}
                />
                <AppButton title="Save" size="sm" onPress={saveName} />
              </View>
            ) : (
              <ListRow label="Your name" value={name || 'Not set'} onPress={() => setEditingName(true)} />
            )}
            <Divider t={t} />
            <ListRow
              label="Send a test notification"
              onPress={async () => {
                await sendBudgetAlert('Test notification', true);
                Alert.alert('Sent', 'Check your notification tray.');
              }}
            />
            <Divider t={t} />
            <ListRow label="Version" value={APP_VERSION} />
          </Group>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
