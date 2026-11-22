/**
 * Card detail (Phase 13 B5, docs/design/12-credit-card*.png).
 * Header (back · name · ⋯ · settings) · dark "You owe in total" with source line and a 3-part bar
 * · Bill card (Record payment / Remind me, or "Add this month's bill") · This cycle · EMIs on
 * this card · On this card (latest 5, See all).
 */
import React, { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { AppButton, Card, IconButton, ScreenHeader } from '../components/ui';
import { formatMoney, parseAmount } from '../utils/Format';
import { shortAccountName } from '../utils/TransactionList';
import { payeeOf } from '../components/ui/TransactionRow';
import {
  cardOwed,
  currentBill,
  cycleSpend,
  dueDateFor,
  isCardSetUp,
  lastStatementDate,
  owedParts,
} from '../utils/CardMath';
import { billBadge, cycleTag, overpaidLine, owedSourceLine, shortDate, weekdayDate } from '../utils/CardView';
import { loadCard, remindCardBill, saveCardStatement } from '../utils/CardService';
import { paidCount } from '../utils/LoanCalculator';

const PART_COLORS = { billed: '#F4A29B', thisCycle: '#F5D48A', other: '#A9BCFF' };

const touchesCard = (tx, id) => String(tx.accountId) === String(id) || String(tx.toAccountId) === String(id);

const parseDay = (text) => {
  const m = String(text || '')
    .trim()
    .match(/^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return d.getDate() === Number(m[1]) ? d : null;
};
const ddmmyyyy = (d) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

export default function CardDetailScreen({ navigation, route }) {
  const t = useTokens();
  const cardId = route.params?.cardId;
  const [data, setData] = useState(null);
  const [billForm, setBillForm] = useState(null); // { total, min, due }

  const load = useCallback(async () => {
    const d = await loadCard(cardId);
    if (!d.card) {
      Alert.alert('Card', 'This item no longer exists.');
      navigation.goBack();
      return;
    }
    setData(d);
  }, [cardId, navigation]);
  useFocusEffect(
    useCallback(() => {
      load().catch((e) => Alert.alert('Card', e.message));
    }, [load])
  );

  if (!data) return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} />;
  const { card, txs, loans, accounts } = data;
  const now = new Date();
  const owed = cardOwed(card, txs, now);
  const parts = owedParts(card, txs, now, owed);
  const bill = currentBill(card, txs, now);
  const cycle = card.statementDay ? cycleSpend(card, txs, now, loans) : null;
  const badge = billBadge(bill);
  const emis = loans.filter(
    (l) => l.loanKind === 'cardEmi' && String(l.onCardId) === String(card.id) && l.status !== 'closed'
  );
  const recent = txs.filter((x) => touchesCard(x, card.id)).slice(0, 5);
  const name = shortAccountName(card.name, card.last4);
  const overpaid = overpaidLine(owed);

  const recordPayment = () => {
    const bank = accounts.find((a) => a.type === 'Bank Account');
    navigation.navigate('MoneyTool', {
      tab: 'Transfers',
      prefill: { fromId: bank?.id ?? null, toId: card.id, amount: bill ? bill.left : 0 },
    });
  };
  const remind = async () => {
    try {
      const date = await remindCardBill(card.id);
      Alert.alert(
        'Reminder',
        date ? `We'll remind you on ${weekdayDate(date)}.` : 'Nothing to pay, so no reminder is needed.'
      );
      load();
    } catch (e) {
      Alert.alert('Reminder', e.message);
    }
  };
  const openBillForm = () => {
    const st = card.statementDay ? lastStatementDate(card.statementDay, now) : now;
    setBillForm({ total: '', min: '', due: ddmmyyyy(dueDateFor(card, st)), date: st });
  };
  const saveBill = async () => {
    const total = parseAmount(billForm.total);
    const due = parseDay(billForm.due);
    if (!total) return Alert.alert('Bill', 'Enter the total due.');
    if (!due) return Alert.alert('Bill', 'Enter the due date as DD/MM/YYYY.');
    try {
      await saveCardStatement(card.id, {
        date: billForm.date,
        totalDue: total,
        minDue: parseAmount(billForm.min) || 0,
        dueDate: due,
        source: 'manual',
      });
      setBillForm(null);
      load();
    } catch (e) {
      Alert.alert('Bill', e.message);
    }
  };
  const more = () =>
    Alert.alert(name, undefined, [
      { text: 'Rename / delete', onPress: () => navigation.navigate('EditAsset', { asset: card }) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const toneColors = {
    warn: [t.warnBg, t.warnBorder, t.warnText],
    danger: [t.dangerBg, t.dangerBorder, t.dangerText],
    income: [t.card, t.border, t.income],
  };
  const tile = (label, value, color) => (
    <View
      key={label}
      style={{ flex: 1, backgroundColor: t.divider, borderRadius: radius.md, padding: space.md }}
    >
      <Text style={{ color: t.text2, fontFamily: fonts.body, fontSize: 14 }}>{label}</Text>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={{ color: color || t.text, fontFamily: fonts.display, fontSize: 19, marginTop: 4 }}
      >
        {value}
      </Text>
    </View>
  );
  const cycleLine = (label, value, color, testID) => (
    <View
      key={label}
      testID={testID}
      style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.md }}
    >
      <Text style={{ flex: 1, color: t.text2, fontFamily: fonts.body, fontSize: 16 }}>{label}</Text>
      <Text style={{ color: color || t.text, fontFamily: fonts.semibold, fontSize: 16 }}>{value}</Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        title={name}
        onBack={() => navigation.goBack()}
        right={
          <View style={{ flexDirection: 'row' }}>
            <IconButton icon="ellipsis-horizontal" label="More" onPress={more} />
            <IconButton
              icon="settings-outline"
              label="Card settings"
              onPress={() => navigation.navigate('CardSetup', { cardId: card.id })}
            />
          </View>
        }
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}>
        <View
          testID="owed-card"
          style={{
            backgroundColor: t.ink,
            borderRadius: radius.xxl,
            padding: space.xl,
            marginBottom: space.md,
          }}
        >
          <Text style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 15 }}>You owe in total</Text>
          <Text
            testID="owed-total"
            adjustsFontSizeToFit
            numberOfLines={1}
            style={{ color: '#FFFFFF', fontFamily: fonts.display, fontSize: 38, marginTop: 4 }}
          >
            {formatMoney(owed.owed)}
          </Text>
          <Text style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 14, marginTop: 4 }}>
            {owedSourceLine(card, owed)}
          </Text>
          {overpaid ? (
            <Text
              accessibilityRole="link"
              onPress={() => navigation.navigate('CardSetup', { cardId: card.id })}
              style={{ color: '#F5D48A', fontFamily: fonts.medium, fontSize: 14, marginTop: space.sm }}
            >
              {overpaid}
            </Text>
          ) : null}
          {parts && owed.owed > 0 ? (
            <View testID="owed-parts">
              <View
                style={{
                  flexDirection: 'row',
                  height: 8,
                  borderRadius: 4,
                  overflow: 'hidden',
                  backgroundColor: t.inkCard,
                  marginTop: space.lg,
                }}
              >
                {['billed', 'thisCycle', 'other'].map((k) =>
                  parts[k] > 0 ? (
                    <View key={k} style={{ flex: parts[k], backgroundColor: PART_COLORS[k] }} />
                  ) : null
                )}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: space.sm }}>
                {[
                  ['billed', `Billed ${formatMoney(parts.billed)}`],
                  ['thisCycle', `This cycle ${formatMoney(parts.thisCycle)}`],
                  ['other', `EMIs & older ${formatMoney(parts.other)}`],
                ].map(([k, label]) => (
                  <View
                    key={k}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      marginRight: space.md,
                      marginTop: 4,
                    }}
                  >
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        backgroundColor: PART_COLORS[k],
                        marginRight: 6,
                      }}
                    />
                    <Text style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 14 }}>{label}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          {!isCardSetUp(card) ? (
            <AppButton
              title="Set up card"
              variant="secondary"
              size="sm"
              style={{ alignSelf: 'flex-start', marginTop: space.md }}
              onPress={() => navigation.navigate('CardSetup', { cardId: card.id })}
            />
          ) : null}
        </View>

        <Card testID="bill-card">
          {bill ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 20 }}>
                    Bill of {shortDate(bill.statement.date)}
                  </Text>
                  <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 15, marginTop: 2 }}>
                    Pay by {weekdayDate(bill.dueDate)}
                  </Text>
                </View>
                {badge ? (
                  <View
                    testID="bill-badge"
                    style={{
                      backgroundColor: toneColors[badge.tone][0],
                      borderColor: toneColors[badge.tone][1],
                      borderWidth: 1,
                      borderRadius: radius.pill,
                      paddingHorizontal: space.md,
                      paddingVertical: 6,
                    }}
                  >
                    <Text
                      style={{ color: toneColors[badge.tone][2], fontFamily: fonts.semibold, fontSize: 14 }}
                    >
                      {badge.label}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
                {tile('Total due', formatMoney(bill.statement.totalDue))}
                {tile('Minimum', formatMoney(bill.statement.minDue || 0))}
                {tile('Paid', formatMoney(bill.paid), t.income)}
              </View>
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
                <AppButton
                  title="Record payment"
                  style={{ flex: 1 }}
                  disabled={bill.left <= 0}
                  onPress={recordPayment}
                />
                <AppButton title="Remind me" variant="secondary" style={{ flex: 1 }} onPress={remind} />
              </View>
            </>
          ) : (
            <>
              <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 20 }}>No bill yet</Text>
              <Text
                style={{
                  color: t.muted,
                  fontFamily: fonts.body,
                  fontSize: 15,
                  marginTop: 2,
                  marginBottom: space.md,
                }}
              >
                Copy the total, minimum and due date from this month&apos;s statement.
              </Text>
              <AppButton title="Add this month's bill" variant="secondary" onPress={openBillForm} />
            </>
          )}
        </Card>

        {cycle ? (
          <Card testID="cycle-card">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 20 }}>This cycle</Text>
              <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14 }}>
                {shortDate(cycle.start)} – {shortDate(cycle.end)}
              </Text>
            </View>
            {cycleLine(
              `Spent (${cycle.count} transaction${cycle.count === 1 ? '' : 's'})`,
              formatMoney(cycle.spent)
            )}
            {cycleLine('Refunds', formatMoney(cycle.refunds), t.income)}
            {cycle.emis.map((e) =>
              cycleLine(
                `${e.name} added on ${shortDate(e.date)}`,
                formatMoney(e.amount),
                null,
                `emi-line-${e.id}`
              )
            )}
            <View style={{ height: 1, backgroundColor: t.divider, marginTop: space.md }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.md }}>
              <Text style={{ color: t.text, fontFamily: fonts.bold, fontSize: 17 }}>Next bill so far</Text>
              <Text testID="next-bill" style={{ color: t.text, fontFamily: fonts.display, fontSize: 18 }}>
                {formatMoney(cycle.spent - cycle.refunds + cycle.emiDue)}
              </Text>
            </View>
          </Card>
        ) : (
          <Card>
            <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 15 }}>
              Set the statement date in card settings to see this cycle.
            </Text>
          </Card>
        )}

        {emis.length ? (
          <Pressable
            testID="card-emis"
            accessibilityRole="button"
            accessibilityLabel="EMIs on this card"
            onPress={() => navigation.navigate('Main', { screen: 'AccountsTab' })}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: t.card,
              borderColor: t.border,
              borderWidth: 1,
              borderRadius: radius.lg,
              padding: space.lg,
              marginBottom: space.md,
            }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: radius.md,
                backgroundColor: t.primarySoft,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: space.md,
              }}
            >
              <Ionicons name="calendar-outline" size={22} color={t.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 17 }}>
                EMIs on this card
              </Text>
              <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14, marginTop: 2 }}>
                {emis
                  .map((l) => `${l.name} · ${Math.max(0, (Number(l.tenure) || 0) - paidCount(l, now))} left`)
                  .join(', ')}{' '}
                · managed in Liabilities
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={t.muted} />
          </Pressable>
        ) : null}

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: space.md,
            marginBottom: space.sm,
          }}
        >
          <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 20 }}>On this card</Text>
          <Text
            accessibilityRole="link"
            onPress={() => navigation.navigate('Transactions', { accountId: card.id })}
            style={{
              color: t.primary,
              fontFamily: fonts.semibold,
              fontSize: 16,
              textDecorationLine: 'underline',
            }}
          >
            See all
          </Text>
        </View>
        <Card padding={0}>
          {recent.length ? (
            recent.map((x, i) => {
              const out =
                x.type === 'expense' ||
                (x.type === 'transfer' && String(x.accountId) === String(card.id) && x.flow !== 'in');
              return (
                <Pressable
                  key={String(x.id)}
                  accessibilityRole="button"
                  onPress={() => navigation.navigate('TransactionDetail', { transaction: x })}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: space.lg,
                    borderTopWidth: i ? 1 : 0,
                    borderColor: t.divider,
                  }}
                >
                  <View style={{ flex: 1, paddingRight: space.sm }}>
                    <Text
                      numberOfLines={1}
                      style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 17 }}
                    >
                      {payeeOf(x)}
                    </Text>
                    <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14, marginTop: 2 }}>
                      {[
                        shortDate(x.fullDate),
                        x.type === 'transfer' ? 'Payment' : x.category,
                        cycleTag(card, x, now),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Text
                    style={{ color: out ? t.expense : t.income, fontFamily: fonts.semibold, fontSize: 17 }}
                  >
                    {out ? '−' : '+'}
                    {formatMoney(x.amount)}
                  </Text>
                </Pressable>
              );
            })
          ) : (
            <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 15, padding: space.lg }}>
              No transactions yet.
            </Text>
          )}
        </Card>
      </ScrollView>

      <Modal visible={!!billForm} transparent animationType="fade" onRequestClose={() => setBillForm(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: t.card,
              borderTopLeftRadius: radius.xxl,
              borderTopRightRadius: radius.xxl,
              padding: space.xl,
            }}
          >
            <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 20, marginBottom: space.md }}>
              Add this month&apos;s bill
            </Text>
            {[
              ['total', 'Total due (₹)', 'numeric'],
              ['min', 'Minimum due (₹)', 'numeric'],
              ['due', 'Due date (DD/MM/YYYY)', 'numbers-and-punctuation'],
            ].map(([k, label, kb]) => (
              <View key={k} style={{ marginBottom: space.md }}>
                <Text style={{ color: t.text2, fontFamily: fonts.semibold, fontSize: 14, marginBottom: 4 }}>
                  {label}
                </Text>
                <TextInput
                  accessibilityLabel={label}
                  value={billForm?.[k] ?? ''}
                  onChangeText={(v) => setBillForm((f) => ({ ...f, [k]: v }))}
                  keyboardType={kb}
                  style={{
                    borderWidth: 1,
                    borderColor: t.inputBorder,
                    borderRadius: radius.md,
                    padding: space.md,
                    color: t.text,
                    fontFamily: fonts.body,
                    fontSize: 16,
                  }}
                />
              </View>
            ))}
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <AppButton
                title="Cancel"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => setBillForm(null)}
              />
              <AppButton title="Save bill" style={{ flex: 1 }} onPress={saveBill} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
