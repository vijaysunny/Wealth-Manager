/**
 * Scan old SMS (C5.1/C5.8): reads the last 30 days of bank SMS, shows what is new (duplicates
 * removed), and stores the confirmed rows as captures. Moved here from the old Home screen;
 * opened from Settings → Capture → Scan old SMS now.
 */
import React, { useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scanBankSms, requestSmsPermission } from '../components/RealSmsReader';
import { getAll } from '../data/TransactionRepo';
import { saveWithDedup, createDedupIndex } from '../utils/DeduplicationEngine';
import { useTokens } from '../components/Theme';
import { fonts, space } from '../components/tokens';
import { AppButton, Card, ScreenHeader, TransactionRow, EmptyState } from '../components/ui';

const DAYS = 30;

/** Scanned SMS → capture rows that are not already stored. Pure apart from ids. */
export const newCapturesFrom = (smsItems, existing) => {
  const dedup = createDedupIndex(existing);
  const out = [];
  smsItems.forEach((sms, i) => {
    if (!sms.amount) return;
    const when = new Date(sms.date);
    const item = {
      id: `scan_${when.getTime()}_${i}`,
      smsId: sms.smsId,
      bodyHash: sms.bodyHash,
      refNo: sms.refNo,
      title: sms.category,
      amount: parseFloat(sms.amount),
      type: sms.type,
      date: when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      category: sms.category,
      account: sms.bankName !== 'Unknown Bank' ? sms.bankName : 'Cash',
      tags: ['auto-sync'],
      fullDate: when.toISOString(),
      extractedBalance: sms.currentBalance ? parseFloat(sms.currentBalance) : null,
      ...(sms.captured || {}),
    };
    if (!dedup.check(item)) out.push(item);
  });
  return out.sort((a, b) => new Date(b.fullDate) - new Date(a.fullDate));
};

export default function ScanSmsScreen({ navigation }) {
  const t = useTokens();
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState(null); // null = not scanned yet

  const scan = async () => {
    const perm = await requestSmsPermission();
    if (!perm.granted) {
      Alert.alert(
        'Permission needed',
        perm.blocked
          ? 'Android blocked SMS access for this app. See the steps at the top of Settings.'
          : 'Allow SMS access to scan your bank messages.'
      );
      return;
    }
    setBusy(true);
    try {
      const res = await scanBankSms(Date.now() - DAYS * 24 * 60 * 60 * 1000);
      if (!res.ok) {
        Alert.alert('Scan failed', 'Could not read SMS messages. Check the SMS permission and try again.');
        return;
      }
      setFound(newCapturesFrom(res.items, await getAll()));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const { added, skipped } = await saveWithDedup(found, { balanceMode: 'captured' });
      Alert.alert('Done', `Added ${added}. Skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}.`);
      navigation.goBack();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title="Scan old SMS" onBack={() => navigation.goBack()} />
      <View style={{ flex: 1, paddingHorizontal: space.xl }}>
        {found === null ? (
          <Card>
            <Text style={{ color: t.text2, fontFamily: fonts.body, fontSize: 15, lineHeight: 22 }}>
              Reads bank SMS from the last {DAYS} days and shows the ones not saved yet. Nothing is stored
              until you confirm.
            </Text>
            <AppButton
              title="Scan now"
              icon="search"
              loading={busy}
              style={{ marginTop: space.md }}
              onPress={scan}
            />
          </Card>
        ) : found.length === 0 ? (
          <EmptyState
            icon="checkmark-circle-outline"
            title="Up to date"
            body="No new bank transactions in your SMS."
          />
        ) : (
          <>
            <Text style={{ color: t.muted, fontFamily: fonts.body, marginBottom: space.sm }}>
              {found.length} new. Duplicates are skipped.
            </Text>
            <FlatList
              data={found}
              keyExtractor={(x) => x.id}
              renderItem={({ item }) => <TransactionRow tx={item} />}
              contentContainerStyle={{ paddingBottom: 100 }}
            />
          </>
        )}
      </View>
      {found && found.length > 0 ? (
        <View style={{ padding: space.xl, borderTopWidth: 1, borderColor: t.border, backgroundColor: t.bg }}>
          <AppButton title={`Save ${found.length} transactions`} size="lg" loading={busy} onPress={save} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}
