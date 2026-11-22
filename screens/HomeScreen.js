/**
 * Home (Phase 12 C5.1, docs/design/Home.png).
 * Header · backup banner · dark month card (Spent, Income, Transfers) · accounts-found card ·
 * quick actions · 3 recent rows with See all.
 * Card bills and wallet top-ups are transfers, so they never count as spending.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Storage from '../data/Storage';
import { getAll } from '../data/TransactionRepo';
import { shiftMonth, formatMoney } from '../utils/Format';
import { backupStatus, LAST_BACKUP_KEY } from '../utils/BackupReminder';
import { permissionWarnings } from '../utils/PermissionHealth';
import { hasReceivePermission, isTrackingEnabled } from '../utils/SmsTracking';
import { notificationsAllowed } from '../utils/NotificationService';
import { discoverAccounts, waitingCount } from '../utils/AccountDiscovery';
import { monthSummary, headerDate, monthLabel } from '../utils/HomeSummary';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { Banner, Card, IconButton, TransactionRow } from '../components/ui';
import { suppressNextLock } from '../utils/LockSuppress';

// Scan bill (B1): camera, then a new expense with the photo attached. Old SMS scan is in Settings.
const QUICK = [
  { key: 'expense', label: 'Expense', icon: 'arrow-up', tone: 'expense', route: 'Expense' },
  { key: 'income', label: 'Income', icon: 'arrow-down', tone: 'income', route: 'Income' },
  {
    key: 'scan',
    label: 'Scan bill',
    icon: 'scan-outline',
    tone: 'primary',
    route: 'Expense',
    params: { scanBill: true },
  },
  { key: 'import', label: 'Import', icon: 'archive-outline', tone: 'text', route: 'Import' },
];

const isSameMonth = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

export default function HomeScreen({ navigation }) {
  const t = useTokens();
  const [transactions, setTransactions] = useState([]);
  const [month, setMonth] = useState(new Date());
  const [userName, setUserName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [backup, setBackup] = useState(null);
  const [permWarnings, setPermWarnings] = useState([]);

  const loadData = useCallback(async () => {
    setBackup(backupStatus(await Storage.getItem(LAST_BACKUP_KEY)));
    setPermWarnings(
      permissionWarnings({
        platform: Platform.OS,
        smsEnabled: await isTrackingEnabled(),
        smsPermission: await hasReceivePermission(),
        notificationsGranted: await notificationsAllowed(),
      })
    );
    setUserName((await Storage.getItem('user_name')) || '');
    const rows = await getAll();
    rows.sort((a, b) => new Date(b.fullDate) - new Date(a.fullDate));
    setTransactions(rows);
    setLoaded(true);
  }, []);
  useFocusEffect(
    useCallback(() => {
      loadData().catch((e) => console.warn('Home load failed:', e?.message || e));
    }, [loadData])
  );

  const summary = useMemo(() => monthSummary(transactions, month), [transactions, month]);
  const discovered = useMemo(() => discoverAccounts(transactions), [transactions]);
  const waiting = waitingCount(discovered);
  const isCurrentMonth = isSameMonth(month, new Date());

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}>
        {/* 1. Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 15 }}>{headerDate()}</Text>
            <Text
              testID="greeting"
              accessibilityRole="header"
              style={{ color: t.text, fontFamily: fonts.display, fontSize: 30 }}
            >
              Hi{userName ? ` ${userName}` : ''}
            </Text>
          </View>
          <View style={[styles.searchBtn, { backgroundColor: t.card, borderColor: t.border }]}>
            <IconButton
              icon="search-outline"
              label="Search transactions"
              onPress={() => navigation.navigate('Transactions', { focusSearch: true })}
            />
          </View>
        </View>

        {permWarnings.map((w) => (
          <Banner
            key={w.key}
            tone="danger"
            body={w.text}
            action={{ label: 'Open settings', onPress: () => (suppressNextLock(), Linking.openSettings()) }}
          />
        ))}

        {/* 2. Backup */}
        {loaded && backup?.stale && (
          <Banner
            testID="backup-banner"
            tone="warn"
            body={
              backup.days === null
                ? 'No backup yet. Your data lives only on this phone.'
                : `${backup.label}. Your data lives only on this phone.`
            }
            action={{
              label: 'Back up',
              onPress: () => navigation.navigate('Backup'),
            }}
          />
        )}

        {/* 3. Month summary */}
        <View testID="summary-card" style={[styles.summary, { backgroundColor: t.ink }]}>
          <View style={styles.monthRow}>
            <IconButton
              icon="chevron-back"
              label="Previous month"
              color={t.inkMuted}
              onPress={() => setMonth(shiftMonth(month, -1))}
            />
            <Text style={{ color: t.inkMuted, fontFamily: fonts.displaySemi, fontSize: 17 }}>
              {monthLabel(month)}
            </Text>
            <IconButton
              icon="chevron-forward"
              label="Next month"
              color={isCurrentMonth ? t.inkCard : t.inkMuted}
              onPress={() => !isCurrentMonth && setMonth(shiftMonth(month, 1))}
            />
          </View>
          <Text style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 15, marginTop: space.md }}>
            Spent this month
          </Text>
          <Text
            testID="spent-amount"
            adjustsFontSizeToFit
            numberOfLines={1}
            style={{ color: '#FFFFFF', fontFamily: fonts.display, fontSize: 40, marginTop: space.xs }}
          >
            {formatMoney(summary.spent)}
          </Text>
          <Text style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 13, marginTop: space.xs }}>
            Card bills and wallet top-ups are transfers, not spending
          </Text>
          <View style={styles.twoUp}>
            <View style={[styles.mini, { backgroundColor: t.inkCard }]}>
              <Text style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 13 }}>Income</Text>
              <Text style={{ color: '#5CC998', fontFamily: fonts.display, fontSize: 20, marginTop: 4 }}>
                {formatMoney(summary.income)}
              </Text>
            </View>
            <View style={[styles.mini, { backgroundColor: t.inkCard }]}>
              <Text style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 13 }}>Transfers</Text>
              <Text
                testID="transfers-amount"
                style={{ color: '#FFFFFF', fontFamily: fonts.display, fontSize: 20, marginTop: 4 }}
              >
                {formatMoney(summary.transfers)}
              </Text>
            </View>
          </View>
          {summary.savedPct !== null && (
            <Text style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 13, marginTop: space.md }}>
              Saved {summary.savedPct}% of income
            </Text>
          )}
        </View>

        {/* 4. Accounts found in SMS (A2) */}
        {discovered.length > 0 && (
          <Pressable
            testID="review-card"
            accessibilityRole="button"
            accessibilityLabel={`${discovered.length} new accounts found in SMS. Review`}
            onPress={() => navigation.navigate('ReviewAccounts')}
            style={[styles.review, { backgroundColor: t.card, borderColor: t.border }]}
          >
            <View style={[styles.reviewIcon, { backgroundColor: t.primarySoft }]}>
              <Ionicons name="list-outline" size={22} color={t.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 16 }}>
                {discovered.length} new account{discovered.length === 1 ? '' : 's'} found in SMS
              </Text>
              <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14, marginTop: 2 }}>
                {waiting} transaction{waiting === 1 ? '' : 's'} waiting · tap to confirm
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: t.primary }]}>
              <Text style={{ color: t.onPrimary, fontFamily: fonts.bold, fontSize: 14 }}>{waiting}</Text>
            </View>
          </Pressable>
        )}

        {/* 5. Quick actions */}
        <View style={styles.quickRow}>
          {QUICK.map((q) => (
            <Pressable
              key={q.key}
              accessibilityRole="button"
              accessibilityLabel={q.label}
              onPress={() => navigation.navigate(q.route, q.params)}
              style={({ pressed }) => [
                styles.quick,
                { backgroundColor: t.card, borderColor: t.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name={q.icon} size={24} color={t[q.tone]} />
              <Text style={{ color: t.text, fontFamily: fonts.medium, fontSize: 14, marginTop: space.sm }}>
                {q.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* 6. Recent */}
        <View style={styles.recentHead}>
          <Text
            accessibilityRole="header"
            style={{ color: t.text, fontFamily: fonts.displaySemi, fontSize: 18 }}
          >
            Recent
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="See all transactions"
            hitSlop={12}
            onPress={() => navigation.navigate('Transactions')}
          >
            <Text style={{ color: t.primary, fontFamily: fonts.semibold, fontSize: 15 }}>See all</Text>
          </Pressable>
        </View>
        <Card style={{ paddingVertical: space.xs }}>
          {transactions.length === 0 ? (
            <Text style={{ color: t.muted, fontFamily: fonts.body, paddingVertical: space.lg }}>
              No transactions yet. Add one, or turn on bank SMS in Settings.
            </Text>
          ) : (
            transactions
              .slice(0, 3)
              .map((tx, i, arr) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  divider={i < arr.length - 1}
                  onPress={() => navigation.navigate('TransactionDetail', { transaction: tx })}
                />
              ))
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: space.lg, paddingBottom: space.lg },
  searchBtn: {
    borderWidth: 1,
    borderRadius: 28,
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summary: { borderRadius: radius.xxl, padding: space.xl, marginBottom: space.md },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  twoUp: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  mini: { flex: 1, borderRadius: radius.md, padding: space.md },
  review: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
  },
  reviewIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.md,
  },
  badge: {
    minWidth: 32,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    marginLeft: space.sm,
  },
  quickRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.lg },
  quick: {
    flex: 1,
    minHeight: 76,
    borderWidth: 1,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.md,
  },
  recentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
});
