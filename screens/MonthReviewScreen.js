/**
 * MonthReviewScreen (Phase 14 E6, docs/design/27-month-summary.png): "November in review".
 * Opens last month by default (route param month 'YYYY-MM'); any past month from the header menu.
 * Share sends a plain-text summary (totals and categories, never single payees).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Storage from '../data/Storage';
import { getAll } from '../data/TransactionRepo';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { IconButton, OptionSheet, ScreenHeader } from '../components/ui';
import { getMonthlyBudget } from '../utils/MonthlyBudgets';
import { LAST_BACKUP_KEY } from '../utils/BackupReminder';
import {
  review,
  deltaLine,
  shareText,
  monthFromKey,
  monthKeyOf,
  monthName,
  prevMonth,
} from '../utils/MonthReview';
import { formatMoney } from '../utils/Format';
import { monthDate } from '../utils/TransactionQuery';
import { suppressNextLock } from '../utils/LockSuppress';

const BAR_COLORS = ['#0E7C4A', '#A6530F', '#6D3FD0', '#1F5FD1'];

/** The last 12 months before this one, newest first. */
export const pastMonths = (now = new Date(), n = 12) =>
  Array.from({ length: n }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 1 - i, 1));

export default function MonthReviewScreen({ navigation, route }) {
  const t = useTokens();
  const [month, setMonth] = useState(() => monthFromKey(route.params?.month) || prevMonth(new Date()));
  const [data, setData] = useState(null);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    const txs = await getAll();
    setData({
      txs,
      budgets: await getMonthlyBudget(month, txs),
      accounts: JSON.parse((await Storage.getItem('user_wealth_accounts')) || '[]'),
      lastBackupAt: await Storage.getItem(LAST_BACKUP_KEY),
    });
  }, [month]);
  useFocusEffect(
    useCallback(() => {
      load().catch((e) => Alert.alert('Load error', e.message));
    }, [load])
  );

  const r = useMemo(
    () =>
      data
        ? review(month, data.txs, data.budgets, { accounts: data.accounts, lastBackupAt: data.lastBackupAt })
        : null,
    [data, month]
  );
  const title = `${monthName(month)} in review`;

  const share = async () => {
    suppressNextLock();
    await Share.share({ message: shareText(r, formatMoney) });
  };

  const header = (
    <ScreenHeader
      title={title}
      onBack={() => navigation.goBack()}
      right={
        <View style={{ flexDirection: 'row' }}>
          <IconButton icon="calendar-outline" label="Choose month" onPress={() => setPicking(true)} />
          {r ? (
            <IconButton
              icon="share-outline"
              label="Share summary"
              onPress={() => share().catch((e) => Alert.alert('Cannot share', e.message))}
            />
          ) : null}
        </View>
      }
    />
  );
  const picker = (
    <OptionSheet
      visible={picking}
      title="Month"
      value={monthKeyOf(month)}
      options={pastMonths().map((m) => ({
        value: monthKeyOf(m),
        label: m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      }))}
      onSelect={(k) => {
        setPicking(false);
        setMonth(monthFromKey(k));
      }}
      onClose={() => setPicking(false)}
    />
  );
  if (!r)
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        {header}
        {picker}
      </SafeAreaView>
    );

  const delta = deltaLine(r, formatMoney);
  const card = (children, extra) => (
    <View
      style={{
        backgroundColor: t.card,
        borderColor: t.border,
        borderWidth: 1,
        borderRadius: radius.xl,
        padding: space.lg,
        marginTop: space.md,
        ...extra,
      }}
    >
      {children}
    </View>
  );
  const mini = (label, value) => (
    <View style={{ flex: 1, backgroundColor: t.inkCard, borderRadius: radius.lg, padding: space.md }}>
      <Text style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 14 }}>{label}</Text>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={{
          color: label === 'Income' ? '#5CC998' : '#FFFFFF',
          fontFamily: fonts.display,
          fontSize: 20,
          marginTop: 4,
        }}
      >
        {value}
      </Text>
    </View>
  );
  const over = r.overBudget[0];
  const otherBudgets = r.overBudget.length - 1 + r.underCount;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {header}
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}>
        <View style={{ backgroundColor: t.ink, borderRadius: radius.xxl, padding: space.xl }}>
          <Text style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 15 }}>You spent</Text>
          <Text
            testID="review-spent"
            adjustsFontSizeToFit
            numberOfLines={1}
            style={{ color: '#FFFFFF', fontFamily: fonts.display, fontSize: 40, marginVertical: space.xs }}
          >
            {formatMoney(r.spent)}
          </Text>
          {delta ? (
            <Text
              style={{
                color: r.delta > 0 ? '#F08A80' : '#5CC998',
                fontFamily: fonts.semibold,
                fontSize: 15,
                marginBottom: space.md,
              }}
            >
              {delta}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.md }}>
            {mini('Income', formatMoney(r.income))}
            {mini('Saved', r.savedPct == null ? '—' : `${formatMoney(r.saved)} · ${r.savedPct}%`)}
          </View>
        </View>

        {r.top.length
          ? card(
              <View>
                <Text
                  style={{
                    color: t.text,
                    fontFamily: fonts.displaySemi,
                    fontSize: 18,
                    marginBottom: space.sm,
                  }}
                >
                  Where it went
                </Text>
                {r.top.map((c, i) => (
                  <Pressable
                    key={c.category}
                    accessibilityRole="button"
                    accessibilityLabel={`${c.category} ${formatMoney(c.amount)}. Show transactions`}
                    onPress={() =>
                      navigation.navigate('Transactions', {
                        query: {
                          date: monthDate(month),
                          categories: [c.category],
                          types: ['expense'],
                        },
                      })
                    }
                    style={{ paddingVertical: space.sm }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: t.text, fontFamily: fonts.body, fontSize: 16 }}>
                        {c.category}
                      </Text>
                      <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 16 }}>
                        {formatMoney(c.amount)}
                      </Text>
                    </View>
                    <View style={{ height: 8, borderRadius: 4, backgroundColor: t.divider, marginTop: 6 }}>
                      <View
                        style={{
                          width: `${Math.max(2, Math.round(c.share * 100))}%`,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                        }}
                      />
                    </View>
                  </Pressable>
                ))}
                {r.restCount ? (
                  <View
                    style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: space.sm }}
                  >
                    <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 16 }}>
                      {`Everything else (${r.restCount} categor${r.restCount === 1 ? 'y' : 'ies'})`}
                    </Text>
                    <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 16 }}>
                      {formatMoney(r.restTotal)}
                    </Text>
                  </View>
                ) : null}
              </View>
            )
          : card(
              <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 15 }}>
                {`No spending recorded in ${monthName(month)}.`}
              </Text>
            )}

        {over
          ? card(
              <View>
                <Text style={{ color: t.dangerText, fontFamily: fonts.bold, fontSize: 17 }}>
                  {`Over budget: ${r.overBudget.map((o) => `${o.category} by ${formatMoney(o.by)}`).join(', ')}`}
                </Text>
                <Text style={{ color: t.dangerText, fontFamily: fonts.body, fontSize: 15, marginTop: 2 }}>
                  {[
                    r.overBudget.length === 1 ? `Budget ${formatMoney(over.budget)}` : null,
                    otherBudgets > 0 ? `${r.underCount} of ${otherBudgets} other budgets stayed under` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>,
              { backgroundColor: t.dangerBg, borderColor: t.dangerBorder }
            )
          : r.underCount
            ? card(
                <Text style={{ color: t.income, fontFamily: fonts.semibold, fontSize: 16 }}>
                  {`All ${r.underCount} budget${r.underCount === 1 ? '' : 's'} stayed under`}
                </Text>,
                { backgroundColor: t.incomeBg, borderColor: t.incomeBg }
              )
            : null}

        {r.notes.length
          ? card(
              <View>
                <Text
                  style={{
                    color: t.text,
                    fontFamily: fonts.displaySemi,
                    fontSize: 18,
                    marginBottom: space.xs,
                  }}
                >
                  Worth a look
                </Text>
                <Text style={{ color: t.text2, fontFamily: fonts.body, fontSize: 15, lineHeight: 22 }}>
                  {r.notes.map((n) => n.text).join(' · ')}
                </Text>
              </View>
            )
          : null}
      </ScrollView>
      {picker}
    </SafeAreaView>
  );
}
