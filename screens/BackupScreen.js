/**
 * Backup & restore (C5.8; moved out of Settings and the old SecurityPanel).
 * Back up now (plain JSON, shared out of the app), encrypted backup with a passphrase,
 * restore or merge (plain or encrypted), factory reset.
 */
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect } from '@react-navigation/native';
import Storage from '../data/Storage';
import { buildFullBackup, validateBackup, formatSummary, restoreBackup } from '../utils/BackupService';
import { attachmentsSize, restoreAttachmentFiles, sizeLabel, BACKUP_WARN_BYTES } from '../utils/Attachments';
import { getAll } from '../data/TransactionRepo';
import { encryptBackup, decryptBackup } from '../utils/EncryptedBackup';
import { mergeRestore } from '../utils/FeatureService';
import { backupStatus, LAST_BACKUP_KEY } from '../utils/BackupReminder';
import { setSmsTracking } from '../utils/SmsTracking';
import { signOutGmail } from '../utils/GmailTracker';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { AppButton, Banner, Card, ScreenHeader, Section } from '../components/ui';

export default function BackupScreen({ navigation }) {
  const t = useTokens();
  const [status, setStatus] = useState(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => setStatus(backupStatus(await Storage.getItem(LAST_BACKUP_KEY))), []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const run = async (label, task) => {
    if (busy) return;
    setBusy(label);
    try {
      await task();
    } catch (e) {
      Alert.alert('Could not complete', e.message);
    } finally {
      setBusy(null);
      load();
    }
  };

  const share = async (uri, data) => {
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(data));
    // The file must leave the app sandbox: uninstalling deletes everything inside it.
    if (!(await Sharing.isAvailableAsync()))
      throw new Error('Sharing is not available, so the backup would stay inside the app.');
    await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Save WealthManager backup' });
    await Storage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
  };

  // B1: files are included by default; above 50 MB ask first and offer a backup without them.
  const withFileChoice = async (go) => {
    const bytes = attachmentsSize(await getAll());
    if (bytes <= BACKUP_WARN_BYTES) return go(true);
    Alert.alert(
      'Large backup',
      `Your files add about ${sizeLabel(bytes)}. A backup this size can be slow to share.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Without files', onPress: () => go(false) },
        { text: 'With files', onPress: () => go(true) },
      ]
    );
  };

  const build = async (includeAttachments) => {
    const { data, missing } = await buildFullBackup({ includeAttachments });
    if (missing)
      Alert.alert(
        'Some files are missing',
        `${missing} attached file${missing === 1 ? ' was' : 's were'} not found and are left out.`
      );
    return data;
  };

  const backupPlain = () =>
    withFileChoice((files) =>
      run('plain', async () =>
        share(FileSystem.documentDirectory + 'wealthmanager_backup.json', await build(files))
      )
    );

  const backupEncrypted = () =>
    withFileChoice((files) =>
      run('encrypted', async () => {
        await share(
          FileSystem.cacheDirectory + 'wealthmanager_encrypted.json',
          encryptBackup(await build(files), password)
        );
        setPassword('');
      })
    );

  const restore = () =>
    run('restore', async () => {
      const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
      if (picked.canceled) return;
      let content;
      try {
        content = JSON.parse(await FileSystem.readAsStringAsync(picked.assets[0].uri));
      } catch {
        throw new Error('This file is not a WealthManager backup.');
      }
      const raw = content.encrypted ? decryptBackup(content, password) : content;
      const check = validateBackup(raw);
      if (!check.ok) throw new Error(check.errors.join('\n'));
      const fileCount = Object.keys(raw.attachmentFiles || {}).length;
      // B1: the backup's files are written into this phone's folder only after Merge / Replace
      const withFiles = () => restoreAttachmentFiles(raw);
      const note = check.warnings.length ? `\n\n${check.warnings.join('\n')}` : '';
      Alert.alert(
        'Restore backup?',
        `${formatSummary(raw)}${fileCount ? `\n• Files: ${fileCount}` : ''}${note}\n\nMerge keeps current balances and settings, adds new rows and skips duplicates. Replace overwrites what is in the backup.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Merge',
            onPress: () =>
              run('merge', async () => {
                const r = await mergeRestore(await withFiles());
                setPassword('');
                Alert.alert('Merged', `${r.added} transactions added; ${r.skipped} skipped.`);
              }),
          },
          {
            text: 'Replace',
            style: 'destructive',
            onPress: () =>
              run('replace', async () => {
                await restoreBackup(await withFiles());
                setPassword('');
                Alert.alert('Restored', 'Restart the app to load the restored data.');
              }),
          },
        ]
      );
    });

  const reset = () =>
    Alert.alert(
      'Delete all data?',
      'Every transaction, account, goal and setting on this phone is deleted. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () =>
            run('reset', async () => {
              await setSmsTracking(false);
              await signOutGmail().catch(() => {});
              await Storage.clear();
              Alert.alert('Done', 'All data was deleted.');
            }),
        },
      ]
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title="Backup & restore" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        {status ? (
          <Banner
            testID="backup-status"
            tone={status.stale ? 'warn' : 'info'}
            title={status.days === null ? 'Never backed up' : status.label}
            body="Your data lives only on this phone. Save a backup to Drive or another place you trust."
          />
        ) : null}
        <Card>
          <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 17 }}>Back up now</Text>
          <Text
            style={{
              color: t.text2,
              fontFamily: fonts.body,
              fontSize: 15,
              lineHeight: 22,
              marginTop: space.xs,
            }}
          >
            Makes one file with everything, including attached bills and files, and opens Share so you can
            save it outside the app.
          </Text>
          <AppButton
            title="Back up now"
            icon="cloud-upload-outline"
            loading={busy === 'plain'}
            style={{ marginTop: space.md }}
            onPress={backupPlain}
          />
        </Card>
        <Section title="Encrypted backup">
          <Card>
            <Text style={{ color: t.text2, fontFamily: fonts.body, fontSize: 15, lineHeight: 22 }}>
              Passphrase of at least 10 characters. Keep it safe: an encrypted backup cannot be opened without
              it.
            </Text>
            <TextInput
              testID="passphrase"
              accessibilityLabel="Backup passphrase"
              secureTextEntry
              autoCapitalize="none"
              value={password}
              onChangeText={setPassword}
              placeholder="Passphrase"
              placeholderTextColor={t.placeholder}
              style={{
                borderWidth: 1,
                borderColor: t.inputBorder,
                borderRadius: radius.md,
                padding: space.md,
                marginTop: space.md,
                color: t.text,
                fontFamily: fonts.body,
                fontSize: 16,
              }}
            />
            <AppButton
              title="Export encrypted backup"
              variant="secondary"
              icon="lock-closed-outline"
              loading={busy === 'encrypted'}
              style={{ marginTop: space.md }}
              onPress={backupEncrypted}
            />
          </Card>
        </Section>
        <Section title="Restore">
          <Card>
            <Text style={{ color: t.text2, fontFamily: fonts.body, fontSize: 15, lineHeight: 22 }}>
              Pick a backup file. For an encrypted file, type its passphrase above first.
            </Text>
            <AppButton
              title="Restore or merge a backup"
              variant="secondary"
              icon="cloud-download-outline"
              loading={busy === 'restore'}
              style={{ marginTop: space.md }}
              onPress={restore}
            />
          </Card>
        </Section>
        <Section title="Danger zone">
          <View>
            <AppButton title="Delete all data" variant="danger" icon="trash-outline" onPress={reset} />
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
