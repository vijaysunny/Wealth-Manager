/**
 * Loan detail (Phase 13 C3, docs/design/16-loan-detail*.png). Route 'LoanDetail', params { loanId }.
 * Principal still owed (C6 ledger) · paid this financial year + CSV · payments (assumed EMIs grouped)
 * · next EMI · Part-prepay (reduce EMI / end sooner) · Mark as closed. Card EMIs: no Part-prepay.
 */
import React, { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { AppButton, Card, IconButton, ScreenHeader, Segmented } from '../components/ui';
import { formatMoney, parseAmount } from '../utils/Format';
import { shortAccountName } from '../utils/TransactionList';
import { shortDate } from '../utils/CardView';
import { formatDmy, parseDmy } from '../utils/LoanForm';
import { groupAssumed, kindLabel, ledger, loanCsv } from '../utils/LoanLedger';
import { addPrepayment, closeLoan, loadLoanWithTxs, reopenLoan } from '../utils/LoanService';
import { shareCsv } from '../utils/HistoryExport';
import { isCardEmi } from '../utils/LoanCalculator';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
const RATE_KIND = { Reducing: 'reducing', 'Flat Rate': 'flat', 'No Cost EMI': 'no-cost' };

export default function LoanDetailScreen({ navigation, route }) {
  const t = useTokens();
  const loanId = route.params?.loanId;
  const [data, setData] = useState(null);
  const [prepay, setPrepay] = useState(null); // { amount, date, mode }

  const load = useCallback(async () => {
    const d = await loadLoanWithTxs(loanId);
    if (!d.loan) {
      Alert.alert('Loan', 'This item no longer exists.');
      navigation.goBack();
      return;
    }
    setData(d);
  }, [loanId, navigation]);
  useFocusEffect(
    useCallback(() => {
      load().catch((e) => Alert.alert('Loan', e.message));
    }, [load])
  );

  if (!data) return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} />;
  const { loan, accounts, txs } = data;
  const now = new Date();
  const l = ledger(loan, txs, now);
  const inCard = isCardEmi(loan);
  const closed = loan.status === 'closed';
  const original = Number(loan.originalAmount) || 0;
  const repaid = original ? Math.min(1, Math.max(0, (original - l.principalOwed) / original)) : 0;
  const byId = Object.fromEntries(accounts.map((a) => [String(a.id), a]));
  const txById = Object.fromEntries(txs.map((x) => [String(x.id), x]));
  const groups = groupAssumed([...l.rows].reverse());

  const subtitle = [
    original ? `${formatMoney(original)} at ${Number(loan.interestRate) || 0}%` : null,
    RATE_KIND[loan.loanType] || null,
    inCard ? 'in card balance' : l.fromLinks ? 'from linked payments' : 'from the schedule',
  ]
    .filter(Boolean)
    .join(' · ');

  const exportCsv = async () => {
    try {
      const name = String(loan.name || 'loan').replace(/[^A-Za-z0-9]+/g, '_');
      await shareCsv(
        `${name}_FY${l.fy.start.getFullYear()}-${String(l.fy.end.getFullYear()).slice(2)}.csv`,
        loanCsv(l)
      );
    } catch (e) {
      Alert.alert('Export', e.message);
    }
  };
  const markClosed = () =>
    Alert.alert('Mark as closed?', 'What you owe on this loan becomes ₹0. You can reopen it later.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark as closed',
        onPress: async () => {
          await closeLoan(loan.id);
          load();
        },
      },
    ]);
  const reopen = async () => {
    await reopenLoan(loan.id);
    load();
  };
  const savePrepay = async () => {
    try {
      await addPrepayment(loan.id, {
        amount: parseAmount(prepay.amount),
        date: parseDmy(prepay.date),
        mode: prepay.mode,
      });
      setPrepay(null);
      load();
    } catch (e) {
      Alert.alert('Part-prepay', e.message);
    }
  };

  const tile = (label, value, testID) => (
    <View
      key={label}
      style={{ flex: 1, backgroundColor: t.inkCard, borderRadius: radius.md, padding: space.md }}
    >
      <Text style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 13 }}>{label}</Text>
      <Text
        testID={testID}
        adjustsFontSizeToFit
        numberOfLines={1}
        style={{ color: '#FFFFFF', fontFamily: fonts.displaySemi, fontSize: 17, marginTop: 4 }}
      >
        {value}
      </Text>
    </View>
  );
  const chip = (label, bg, fg) => (
    <View
      key={label}
      style={{ backgroundColor: bg, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2 }}
    >
      <Text style={{ color: fg, fontFamily: fonts.semibold, fontSize: 13 }}>{label}</Text>
    </View>
  );
  const sourceText = (row) => {
    const tx = row.txId != null ? txById[String(row.txId)] : null;
    const acc = tx && tx.accountId != null ? byId[String(tx.accountId)] : null;
    return [
      row.source === 'sms'
        ? 'from SMS'
        : row.prepaymentId
          ? 'manual'
          : acc
            ? shortAccountName(acc.name, acc.last4)
            : 'manual',
      row.note,
    ]
      .filter(Boolean)
      .join(' · ');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        title={loan.name || 'Loan'}
        onBack={() => navigation.goBack()}
        right={
          <IconButton
            icon="create-outline"
            label="Edit loan"
            onPress={() => navigation.navigate('LoanEdit', { loanId: loan.id })}
          />
        }
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}>
        <View
          testID="loan-summary"
          style={{ backgroundColor: t.ink, borderRadius: radius.xl, padding: space.xl }}
        >
          <Text style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 15 }}>
            {closed ? 'Closed' : 'Principal still owed'}
          </Text>
          <Text
            testID="principal-owed"
            style={{ color: '#FFFFFF', fontFamily: fonts.display, fontSize: 38, marginTop: space.xs }}
          >
            {formatMoney(l.principalOwed)}
          </Text>
          <Text style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 14, marginTop: 2 }}>
            {subtitle}
          </Text>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.inkCard, marginTop: space.lg }}>
            <View
              style={{
                width: `${Math.round(repaid * 100)}%`,
                height: 8,
                borderRadius: 4,
                backgroundColor: '#5CC998',
              }}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
            {tile('EMI', formatMoney(l.emi), 'tile-emi')}
            {tile(
              'Paid',
              l.tenureNow ? `${l.paidCount} of ${l.tenureNow}` : String(l.paidCount),
              'tile-paid'
            )}
            {tile('Ends', l.endDate ? monthYear(l.endDate) : '—', 'tile-ends')}
          </View>
        </View>

        {!inCard ? (
          <Card testID="fy-card" style={{ marginTop: space.lg }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 19 }}>
                Paid this financial year
              </Text>
              <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14 }}>
                {monthYear(l.fy.start)} – {monthYear(l.fy.end)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.md }}>
              {[
                ['Principal', l.fy.principal, t.incomeBg, t.income, 'fy-principal'],
                ['Interest', l.fy.interest, t.dangerBg, t.dangerText, 'fy-interest'],
              ].map(([label, value, bg, fg, id]) => (
                <View
                  key={label}
                  style={{ flex: 1, backgroundColor: bg, borderRadius: radius.md, padding: space.md }}
                >
                  <Text style={{ color: fg, fontFamily: fonts.body, fontSize: 14 }}>{label}</Text>
                  <Text
                    testID={id}
                    adjustsFontSizeToFit
                    numberOfLines={1}
                    style={{ color: fg, fontFamily: fonts.display, fontSize: 21 }}
                  >
                    {formatMoney(value)}
                  </Text>
                </View>
              ))}
            </View>
            <AppButton
              title="Export for tax filing (CSV)"
              variant="secondary"
              style={{ marginTop: space.md }}
              onPress={exportCsv}
            />
          </Card>
        ) : null}

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: space.xl,
            marginBottom: space.sm,
          }}
        >
          <Text accessibilityRole="header" style={{ color: t.text, fontFamily: fonts.display, fontSize: 20 }}>
            Payments
          </Text>
        </View>
        <Card padding={0}>
          {groups.length === 0 ? (
            <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 15, padding: space.lg }}>
              No EMI is due yet.
            </Text>
          ) : null}
          {groups.map((g, i) => {
            const border = i < groups.length - 1 ? { borderBottomWidth: 1, borderColor: t.divider } : null;
            if (g.type === 'assumed') {
              const span =
                g.firstNo === g.lastNo
                  ? `${shortDate(g.from)} · EMI ${g.firstNo}`
                  : `${shortDate(g.from)} – ${shortDate(g.to)} · EMIs ${g.firstNo}–${g.lastNo}`;
              return (
                <View
                  key={`a${g.firstNo}`}
                  testID={`assumed-${g.firstNo}-${g.lastNo}`}
                  style={[{ padding: space.lg }, border]}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: t.text2, fontFamily: fonts.semibold, fontSize: 16 }}>{span}</Text>
                    <Text style={{ color: t.text2, fontFamily: fonts.displaySemi, fontSize: 16 }}>
                      {formatMoney(g.amount)}
                    </Text>
                  </View>
                  {!inCard ? (
                    <Text
                      style={{ color: t.warnText, fontFamily: fonts.semibold, fontSize: 14, marginTop: 4 }}
                    >
                      No SMS seen: counted from the schedule. Link them if you have them.
                    </Text>
                  ) : null}
                </View>
              );
            }
            const row = g.row;
            return (
              <View
                key={`${row.kind}${row.txId || row.prepaymentId || row.emiNo}`}
                testID={`payment-${row.txId || row.prepaymentId}`}
                style={[{ padding: space.lg }, border]}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 16 }}>
                    {shortDate(row.date)} · {kindLabel(row)}
                  </Text>
                  <Text style={{ color: t.text, fontFamily: fonts.displaySemi, fontSize: 16 }}>
                    {formatMoney(row.amount)}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: space.sm,
                    marginTop: 6,
                  }}
                >
                  {row.principal > 0
                    ? chip(`Principal ${formatMoney(row.principal)}`, t.incomeBg, t.income)
                    : null}
                  {row.interest > 0
                    ? chip(
                        `${row.kind === 'charges' ? 'Charges' : 'Interest'} ${formatMoney(row.interest)}`,
                        t.dangerBg,
                        t.dangerText
                      )
                    : null}
                  <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }}>
                    {sourceText(row)}
                  </Text>
                </View>
              </View>
            );
          })}
        </Card>

        {l.nextEmi && !closed ? (
          <Card testID="next-emi" style={{ marginTop: space.lg }}>
            <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 17 }}>
              Next: {shortDate(l.nextEmi.date)} · {formatMoney(l.nextEmi.amount)}
            </Text>
            {!inCard || Number(loan.interestRate) > 0 ? (
              <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14, marginTop: 2 }}>
                Principal {formatMoney(l.nextEmi.principal)} · Interest {formatMoney(l.nextEmi.interest)}
              </Text>
            ) : null}
          </Card>
        ) : null}

        <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
          {!inCard && !closed ? (
            <AppButton
              title="Part-prepay"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => setPrepay({ amount: '', date: formatDmy(now), mode: 'endSooner' })}
            />
          ) : null}
          <AppButton
            title={closed ? 'Reopen' : 'Mark as closed'}
            variant="secondary"
            style={{ flex: 1 }}
            onPress={closed ? reopen : markClosed}
          />
        </View>
      </ScrollView>

      <Modal visible={!!prepay} transparent animationType="slide" onRequestClose={() => setPrepay(null)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => setPrepay(null)}
          style={{ flex: 1, backgroundColor: 'rgba(14,23,38,0.45)' }}
        />
        {prepay ? (
          <View
            style={{
              backgroundColor: t.card,
              borderTopLeftRadius: radius.xxl,
              borderTopRightRadius: radius.xxl,
              padding: space.xl,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{ color: t.text, fontFamily: fonts.display, fontSize: 20 }}
            >
              Part-prepay
            </Text>
            {[
              ['amount', 'Amount prepaid (₹)', 'numeric'],
              ['date', 'Date (DD/MM/YYYY)', 'numbers-and-punctuation'],
            ].map(([key, label, kb]) => (
              <View key={key} style={{ marginTop: space.md }}>
                <Text
                  style={{ color: t.text2, fontFamily: fonts.semibold, fontSize: 15, marginBottom: space.xs }}
                >
                  {label}
                </Text>
                <TextInput
                  accessibilityLabel={label}
                  value={prepay[key]}
                  onChangeText={(v) => setPrepay((p) => ({ ...p, [key]: v }))}
                  keyboardType={kb}
                  style={{
                    borderWidth: 1,
                    borderColor: t.inputBorder,
                    borderRadius: radius.md,
                    paddingHorizontal: space.lg,
                    minHeight: 48,
                    color: t.text,
                    fontFamily: fonts.medium,
                    fontSize: 17,
                  }}
                />
              </View>
            ))}
            <Text
              style={{
                color: t.text2,
                fontFamily: fonts.semibold,
                fontSize: 15,
                marginTop: space.md,
                marginBottom: space.xs,
              }}
            >
              After the prepayment
            </Text>
            <Segmented
              value={prepay.mode}
              onChange={(mode) => setPrepay((p) => ({ ...p, mode }))}
              options={[
                { value: 'endSooner', label: 'End sooner' },
                { value: 'reduceEmi', label: 'Reduce EMI' },
              ]}
            />
            <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13, marginTop: space.xs }}>
              {prepay.mode === 'endSooner' ? 'Same EMI, fewer months.' : 'Lower EMI over the same months.'}{' '}
              Ask your lender which one they applied.
            </Text>
            <AppButton
              title="Save prepayment"
              size="lg"
              style={{ marginTop: space.lg }}
              onPress={savePrepay}
            />
          </View>
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}
