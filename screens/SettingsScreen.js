import { putAccount, deleteAccount } from '../data/Collections';
import { Text, View, TouchableOpacity, TextInput, ScrollView, SafeAreaView } from '../components/Theme';
import SecurityPanel from '../components/SecurityPanel';
/**
 * SettingsScreen.js  (Enhanced v2)
 * Adds: Gmail OAuth sync, Import screen navigation, Gmail status indicator.
 */

import React, { useState, useEffect } from 'react';
import { StyleSheet, Alert, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '../data/Storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { sendBudgetAlert } from '../utils/NotificationService';
import { importAxioData } from '../utils/AxioImporter';
import { APP_VERSION } from '../utils/appInfo';
import { setSmsTracking } from '../utils/SmsTracking';
import { requestSmsPermission } from '../components/RealSmsReader';
import { buildBackup, validateBackup, formatSummary, restoreBackup } from '../utils/BackupService';
import {
  signInWithGoogle,
  signOutGmail,
  isGmailConnected,
  syncGmailTransactions,
} from '../utils/GmailTracker';
import { isGmailEnabled } from '../utils/Features';
const DEFAULT_CATS = [
  'Food',
  'Transport',
  'Shopping',
  'Bills',
  'Health',
  'Education',
  'Entertainment',
  'Salary',
  'Business',
  'Investment',
  'Loan/EMI',
  'Insurance',
  'Rent',
  'UPI Transfer',
  'General',
];

// Defined at module level (NOT inside SettingsScreen): components declared inside
// the render function get a new identity every render, which remounts them and
// makes TextInputs lose focus after every keystroke.
const SectionCard = ({ title, children }) => (
  <View style={styles.card}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);
const RowButton = ({ icon, color, label, onPress, right }) => (
  <TouchableOpacity style={styles.rowBtn} onPress={onPress}>
    <Ionicons name={icon} size={20} color={color || '#2196F3'} />
    <Text
      style={[
        styles.rowBtnText,
        color === '#F44336' && {
          color,
        },
      ]}
    >
      {label}
    </Text>
    {right && (
      <View
        style={{
          marginLeft: 'auto',
        }}
      >
        {right}
      </View>
    )}
  </TouchableOpacity>
);
export default function SettingsScreen({ navigation }) {
  const [name, setName] = useState('User');
  const [isEditingName, setIsEditingName] = useState(false);
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [newCat, setNewCat] = useState('');
  const [newAcc, setNewAcc] = useState('');
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailSyncing, setGmailSyncing] = useState(false);
  const [smsAutoTrack, setSmsAutoTrack] = useState(true);
  useEffect(() => {
    loadSettings();
  }, []);
  const loadSettings = async () => {
    const savedName = await AsyncStorage.getItem('user_name');
    if (savedName) setName(savedName);
    const savedCats = await AsyncStorage.getItem('user_categories');
    setCategories(savedCats ? JSON.parse(savedCats) : DEFAULT_CATS);
    const savedWealth = await AsyncStorage.getItem('user_wealth_accounts');
    setAccounts(savedWealth ? JSON.parse(savedWealth) : []);
    const gmailOk = isGmailEnabled() && (await isGmailConnected());
    setGmailConnected(gmailOk);
    const smsEnabled = await AsyncStorage.getItem('sms_auto_track_enabled');
    setSmsAutoTrack(smsEnabled !== 'false');
  };
  const saveName = async () => {
    if (!name.trim()) return;
    await AsyncStorage.setItem('user_name', name.trim());
    setIsEditingName(false);
  };
  const addItem = async (type) => {
    if (type === 'cat') {
      if (!newCat.trim()) return;
      if (categories.includes(newCat.trim())) {
        Alert.alert('Error', 'Category already exists');
        return;
      }
      const updated = [...categories, newCat.trim()];
      setCategories(updated);
      await AsyncStorage.setItem('user_categories', JSON.stringify(updated));
      setNewCat('');
    } else {
      if (!newAcc.trim()) return;
      if (accounts.some((a) => a.name === newAcc.trim())) {
        Alert.alert('Error', 'Account already exists');
        return;
      }
      const newAsset = {
        id: Date.now(),
        name: newAcc.trim(),
        type: 'Cash',
        balance: 0,
      };
      const updated = [...accounts, newAsset];
      setAccounts(updated);
      await putAccount(newAsset);
      setNewAcc('');
    }
  };
  const deleteItem = async (type, item) => {
    const label = type === 'cat' ? item : item.name;
    Alert.alert('Delete', `Remove '${label}'?`, [
      {
        text: 'Cancel',
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (type === 'cat') {
            const updated = categories.filter((c) => c !== item);
            setCategories(updated);
            await AsyncStorage.setItem('user_categories', JSON.stringify(updated));
          } else {
            const updated = accounts.filter((a) => a.id !== item.id);
            setAccounts(updated);
            await deleteAccount(item.id);
          }
        },
      },
    ]);
  };

  // ── Gmail ──────────────────────────────────────────────────────────────

  const handleGmailConnect = async () => {
    if (gmailConnected) {
      Alert.alert('Disconnect Gmail', 'Stop syncing Gmail bank emails?', [
        {
          text: 'Cancel',
        },
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
      'This allows WealthManager to read your bank transaction emails (read-only).\n\nRequired: Set up Google OAuth in app.json with your Client ID.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Connect',
          onPress: async () => {
            const result = await signInWithGoogle();
            if (result.success) {
              setGmailConnected(true);
              Alert.alert('✅ Connected!', 'Gmail sync is now active. Syncing transactions…');
              handleGmailSync(true);
            } else if (result.error === 'not_configured') {
              Alert.alert(
                'Setup Required',
                'Configure EXPO_PUBLIC_GOOGLE_CLIENT_ID and the Google OAuth redirect before connecting.'
              );
            } else {
              Alert.alert('Failed', `Could not connect: ${result.error}`);
            }
          },
        },
      ]
    );
  };
  const handleGmailSync = async (justConnected = false) => {
    if (!gmailConnected && justConnected !== true) {
      Alert.alert('Not Connected', 'Connect Gmail first.');
      return;
    }
    setGmailSyncing(true);
    const result = await syncGmailTransactions();
    setGmailSyncing(false);
    if (result.success) {
      Alert.alert(
        'Sync Complete',
        `Added: ${result.added} transactions\nSkipped duplicates: ${result.skipped}`
      );
    } else if (result.error === 'token_expired') {
      setGmailConnected(false);
      Alert.alert('Session Expired', 'Please reconnect Gmail.');
    } else {
      Alert.alert('Sync Error', result.error || 'Unknown error');
    }
  };

  // ── SMS toggle ─────────────────────────────────────────────────────────

  const toggleSmsTracking = async (val) => {
    if (val) {
      // Turning ON: the permission prompt must come from the UI, not from background code
      const ok = await requestSmsPermission();
      if (!ok) {
        setSmsAutoTrack(false);
        await setSmsTracking(false);
        Alert.alert('Permission needed', 'Allow SMS access in system settings to use auto-tracking.');
        return;
      }
    }
    setSmsAutoTrack(val);
    await setSmsTracking(val); // saves the flag and starts / stops the listener right now
  };

  // ── Backup / Restore ───────────────────────────────────────────────────

  const backupData = async () => {
    try {
      const data = await buildBackup();
      const uri = FileSystem.documentDirectory + 'wealthmanager_backup.json';
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(data, null, 2));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
    } catch (_e) {
      Alert.alert('Backup Error', _e.message);
    }
  };
  const restoreData = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
      });
      if (result.canceled) return;
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      let data;
      try {
        data = JSON.parse(content);
      } catch {
        Alert.alert('Restore Error', 'This file is not valid JSON.');
        return;
      }
      const check = validateBackup(data);
      if (!check.ok) {
        Alert.alert('Cannot restore', check.errors.join('\n'));
        return;
      }
      const note = check.warnings.length ? `\n\n${check.warnings.join('\n')}` : '';
      Alert.alert(
        'Restore this backup?',
        `Backup from ${data.date ? new Date(data.date).toLocaleString('en-IN') : 'unknown date'} contains:\n\n${formatSummary(data)}${note}\n\nThis overwrites the matching data on this device.`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Restore',
            style: 'destructive',
            onPress: async () => {
              try {
                await restoreBackup(data);
                Alert.alert('✅ Restored', 'Restart the app for changes to take effect.');
              } catch (_e) {
                Alert.alert('Restore Error', _e.message);
              }
            },
          },
        ]
      );
    } catch (_e) {
      Alert.alert('Restore Error', 'Could not read the backup file.');
    }
  };
  const resetApp = () => {
    Alert.alert('Factory Reset', 'Delete ALL data permanently?', [
      {
        text: 'Cancel',
      },
      {
        text: 'DELETE EVERYTHING',
        style: 'destructive',
        onPress: async () => {
          await setSmsTracking(false);
          await signOutGmail();
          await AsyncStorage.clear();
          setGmailConnected(false);
          setSmsAutoTrack(false);
          setCategories(DEFAULT_CATS);
          setAccounts([]);
          setName('User');
          Alert.alert('Done', 'App has been reset.');
        },
      },
    ]);
  };
  const handleAxioImport = async () => {
    Alert.alert('Import Axio Data', 'Select your Axio Excel/CSV file.', [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'Select File',
        onPress: async () => {
          const res = await importAxioData();
          if (res.success) Alert.alert('✅ Imported', `${res.count} transactions imported.`);
          else Alert.alert('Error', 'Could not read file.');
        },
      },
    ]);
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="settings" size={24} color="#2196F3" />
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* PROFILE */}
        <SectionCard title="Profile">
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
            </View>
            {isEditingName ? (
              <View style={styles.nameEdit}>
                <TextInput style={styles.nameInput} value={name} onChangeText={setName} autoFocus />
                <TouchableOpacity style={styles.saveNameBtn} onPress={saveName}>
                  <Text style={styles.saveNameText}>Save</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.nameRow}>
                <Text style={styles.nameText}>{name}</Text>
                <TouchableOpacity onPress={() => setIsEditingName(true)}>
                  <Ionicons
                    name="pencil"
                    size={16}
                    color="#999"
                    style={{
                      marginLeft: 8,
                    }}
                  />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </SectionCard>

        <SectionCard title="Money tools">
          <RowButton
            icon="swap-horizontal"
            label="Transfers, review, history and wealth tools"
            onPress={() => navigation.navigate('Tools')}
          />
        </SectionCard>
        {/* AUTO-SYNC */}
        <SectionCard title="Auto-Tracking">
          {/* SMS */}
          <View style={styles.rowBtn}>
            <Ionicons name="chatbubble-ellipses" size={20} color="#4CAF50" />
            <Text style={styles.rowBtnText}>SMS Auto-Tracking</Text>
            <Switch
              style={{
                marginLeft: 'auto',
              }}
              value={smsAutoTrack}
              onValueChange={toggleSmsTracking}
              trackColor={{
                false: '#ddd',
                true: '#4CAF5080',
              }}
              thumbColor={smsAutoTrack ? '#4CAF50' : '#999'}
            />
          </View>
          <View style={styles.divider} />

          {/* Gmail (feature-flagged off, plan B1) */}
          {isGmailEnabled() && (
            <RowButton
              icon="mail"
              color={gmailConnected ? '#4CAF50' : '#2196F3'}
              label={gmailConnected ? 'Gmail Connected ✓' : 'Connect Gmail'}
              onPress={handleGmailConnect}
              right={
                gmailConnected ? (
                  <TouchableOpacity onPress={handleGmailSync} disabled={gmailSyncing}>
                    <Text style={styles.syncNowText}>{gmailSyncing ? 'Syncing…' : 'Sync Now'}</Text>
                  </TouchableOpacity>
                ) : null
              }
            />
          )}
          {isGmailEnabled() && gmailConnected && (
            <Text style={styles.gmailNote}>
              Auto-reads bank transaction emails. Duplicates are skipped automatically.
            </Text>
          )}
        </SectionCard>

        {/* IMPORT */}
        <SectionCard title="Import Transactions">
          <RowButton
            icon="cloud-upload-outline"
            color="#9C27B0"
            label="Import Bank Statement (Excel/PDF)"
            onPress={() => navigation.navigate('Import')}
          />
          <View style={styles.divider} />
          <RowButton
            icon="document-text-outline"
            color="#FF9800"
            label="Import Axio Report"
            onPress={handleAxioImport}
          />
        </SectionCard>

        {/* CATEGORIES */}
        <SectionCard title="Manage Categories">
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Add Category"
              value={newCat}
              onChangeText={setNewCat}
            />
            <TouchableOpacity onPress={() => addItem('cat')} style={styles.addBtn}>
              <Ionicons name="add" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          <View style={styles.chipContainer}>
            {categories.map((c, i) => (
              <View key={i} style={styles.chip}>
                <Text style={styles.chipText}>{c}</Text>
                <TouchableOpacity onPress={() => deleteItem('cat', c)}>
                  <Ionicons name="close-circle" size={18} color="#999" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </SectionCard>

        {/* ACCOUNTS */}
        <SectionCard title="Manage Accounts">
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Add Account (e.g. Cash)"
              value={newAcc}
              onChangeText={setNewAcc}
            />
            <TouchableOpacity onPress={() => addItem('acc')} style={styles.addBtn}>
              <Ionicons name="add" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          <View style={styles.chipContainer}>
            {accounts.map((a, i) => (
              <View key={i} style={styles.chip}>
                <Text style={styles.chipText}>{a.name}</Text>
                <TouchableOpacity onPress={() => deleteItem('acc', a)}>
                  <Ionicons name="close-circle" size={18} color="#999" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </SectionCard>

        <SecurityPanel />
        {/* DATA */}
        <SectionCard title="Data Management">
          <RowButton icon="cloud-upload" color="#2196F3" label="Backup All Data" onPress={backupData} />
          <View style={styles.divider} />
          <RowButton
            icon="cloud-download"
            color="#4CAF50"
            label="Restore from Backup"
            onPress={restoreData}
          />
          <View style={styles.divider} />
          <RowButton icon="trash" color="#F44336" label="Factory Reset" onPress={resetApp} />
        </SectionCard>

        {/* DEBUG */}
        <SectionCard title="Debug & Tools">
          <RowButton
            icon="notifications"
            color="#FF9800"
            label="Test Notification"
            onPress={async () => {
              await sendBudgetAlert('Test Notification 🔔', true);
              Alert.alert('Sent', 'Check your notification tray.');
            }}
          />
          <View style={styles.divider} />
          <RowButton
            icon="information-circle"
            color="#607D8B"
            label={`App Version ${APP_VERSION} (Android 16 Ready)`}
            onPress={() => {}}
          />
        </SectionCard>

        <View
          style={{
            height: 30,
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
    elevation: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginLeft: 12,
    color: '#333',
  },
  card: {
    backgroundColor: '#fff',
    margin: 12,
    marginBottom: 4,
    padding: 16,
    borderRadius: 16,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 14,
    color: '#2c3e50',
  },
  // Profile
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2196F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 14,
  },
  nameText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
  },
  nameEdit: {
    flex: 1,
    flexDirection: 'row',
    marginLeft: 14,
    gap: 8,
  },
  nameInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#2196F3',
    borderRadius: 8,
    padding: 8,
    fontSize: 15,
  },
  saveNameBtn: {
    backgroundColor: '#2196F3',
    borderRadius: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  saveNameText: {
    color: '#fff',
    fontWeight: '600',
  },
  // Rows
  rowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  rowBtnText: {
    marginLeft: 14,
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginVertical: 2,
  },
  syncNowText: {
    color: '#2196F3',
    fontWeight: '600',
    fontSize: 13,
  },
  gmailNote: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
    marginLeft: 34,
  },
  // Input
  inputRow: {
    flexDirection: 'row',
    marginBottom: 14,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#eee',
    fontSize: 14,
  },
  addBtn: {
    backgroundColor: '#2196F3',
    padding: 10,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    width: 42,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  chipText: {
    color: '#555',
    fontSize: 13,
    marginRight: 4,
  },
});
