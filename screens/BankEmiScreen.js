/**
 * Bank EMI found in SMS (Phase 13 C4, docs/design/15-bank-emi-loan.png). Route 'BankEmi',
 * params { payee } (the suggestion key from LoanLink.emiSuggestions). One amount at a time:
 * New loan (EMI, EMIs left, rate, debit day) or Existing loan, then its debits are linked and
 * later ones link by themselves. "Not a loan" stops suggesting that payee and amount.
 */
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { AppButton, Card, ScreenHeader, Segmented } from '../components/ui';
import { formatMoney, parseAmount } from '../utils/Format';
import { shortAccountName } from '../utils/TransactionList';
import { shortDate } from '../utils/CardView';
import { isCardEmi } from '../utils/LoanCalculator';
import { emiSuggestions, loanFromDebits } from '../utils/LoanLink';
import {
  dismissEmiSuggestion,
  linkDebitsToLoan,
  loadDismissed,
  loadLoanWithTxs,
  saveLoan,
} from '../utils/LoanService';

export default function BankEmiScreen({ navigation, route }) {
  const t = useTokens();
  const key = route.params?.payee;
  const [data, setData] = useState(null);
  const [mode, setMode] = useState('new');
  const [emi, setEmi] = useState('');
  const [left, setLeft] = useState('');
  const [rate, setRate] = useState('');
  const [day, setDay] = useState('');
  const [existing, setExisting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await loadLoanWithTxs(null);
    const byId = Object.fromEntries(d.accounts.map((a) => [String(a.id), a]));
    const s = emiSuggestions(d.txs, byId, await loadDismissed()).find((x) => x.key === key) || null;
    setData({ ...d, byId, s });
    if (s) {
      setEmi(String(s.loans[0].amount));
      setDay(String(s.loans[0].debitDay));
      setLeft('');
      setRate('');
    }
  }, [key]);
  useFocusEffect(
    useCallback(() => {
      load().catch((e) => Alert.alert('Loan', e.message));
    }, [load])
  );

  if (!data) return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} />;
  const { s, byId } = data;
  if (!s) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ScreenHeader title="Loan EMI" onBack={() => navigation.goBack()} />
        <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 16, padding: space.xl }}>
          Nothing left to link here.
        </Text>
      </SafeAreaView>
    );
  }
  const cluster = s.loans[0];
  const loans = data.accounts.filter((a) => a.type === 'Loan' && !isCardEmi(a) && a.status !== 'closed');
  const acc = (id) => byId[String(id)];
  const afterSave = async () => {
    await load();
    const still = emiSuggestions((await loadLoanWithTxs(null)).txs, byId, await loadDismissed()).find(
      (x) => x.key === key
    );
    if (!still) navigation.goBack();
  };

  const link = async () => {
    setBusy(true);
    try {
      let loanId = existing;
      if (mode === 'new') {
        const n = Number(left);
        const d = Number(day);
        const r = rate === '' ? 0 : Number(rate);
        if (!Number.isInteger(n) || n < 0 || n > 360)
          throw new Error('Enter how many EMIs are left (0–360).');
        if (!Number.isInteger(d) || d < 1 || d > 31) throw new Error('Debit day must be between 1 and 31.');
        if (!(r >= 0 && r <= 60)) throw new Error('Interest must be between 0 and 60 % a year.');
        const values = loanFromDebits(
          {
            payee: s.payee,
            emi: parseAmount(emi),
            left: n,
            rate: r,
            debitDay: d,
            accountId: cluster.accountId,
            debits: cluster.debits,
          },
          new Date()
        );
        const loan = await saveLoan(values);
        loanId = loan.id;
      } else if (!loanId) throw new Error('Pick the loan these debits pay.');
      await linkDebitsToLoan(loanId, {
        payee: s.key,
        amount: cluster.amount,
        accountId: cluster.accountId,
        debits: cluster.debits,
      });
      await afterSave();
    } catch (e) {
      Alert.alert('Loan', e.message);
    } finally {
      setBusy(false);
    }
  };
  const notALoan = async () => {
    await dismissEmiSuggestion(cluster.dismissKey);
    await afterSave();
  };

  const field = (label, value, set, props = {}, prefix, suffix) => (
    <View style={{ flex: 1 }}>
      <Text style={{ color: t.text2, fontFamily: fonts.semibold, fontSize: 15, marginBottom: space.xs }}>
        {label}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: t.inputBorder,
          borderRadius: radius.md,
          paddingHorizontal: space.md,
          minHeight: 52,
        }}
      >
        {prefix ? (
          <Text style={{ color: t.text2, fontFamily: fonts.medium, fontSize: 17, marginRight: 6 }}>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={set}
          placeholderTextColor={t.placeholder}
          style={{ flex: 1, color: t.text, fontFamily: fonts.medium, fontSize: 17 }}
          {...props}
        />
        {suffix ? (
          <Text style={{ color: t.muted, fontFamily: fonts.medium, fontSize: 17 }}>{suffix}</Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title={`${s.payee} EMI`} onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <Card>
          <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 19, marginBottom: space.sm }}>
            Auto-debits found in your SMS
          </Text>
          {s.debits.map((d) => {
            const a = acc(d.accountId);
            return (
              <View
                key={d.id}
                style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs }}
              >
                <Text style={{ color: t.text2, fontFamily: fonts.body, fontSize: 15 }}>
                  {[
                    shortDate(d.fullDate),
                    d.channel || 'Debit',
                    a ? shortAccountName(a.name, a.last4) : d.account,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 15 }}>
                  {formatMoney(d.amount)}
                </Text>
              </View>
            );
          })}
          {s.mixed ? (
            <Text
              testID="mixed-note"
              style={{ color: t.warnText, fontFamily: fonts.semibold, fontSize: 14, marginTop: space.md }}
            >
              Different amounts: these may be two loans. Link each to its own loan.
            </Text>
          ) : null}
        </Card>

        <Card style={{ marginTop: space.lg }}>
          <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 19, marginBottom: space.md }}>
            Loan for the {formatMoney(cluster.amount)} EMI
          </Text>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'new', label: 'New loan' },
              { value: 'existing', label: 'Existing loan' },
            ]}
          />
          {mode === 'new' ? (
            <>
              <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
                {field('EMI', emi, setEmi, { keyboardType: 'decimal-pad' }, '₹')}
                {field('EMIs left', left, setLeft, { keyboardType: 'number-pad', placeholder: 'e.g. 8' })}
              </View>
              <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
                {field(
                  'Interest % a year',
                  rate,
                  setRate,
                  { keyboardType: 'decimal-pad', placeholder: '0 if no-cost' },
                  null,
                  '%'
                )}
                {field('Debit day', day, setDay, { keyboardType: 'number-pad' })}
              </View>
              <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14, marginTop: space.md }}>
                From your loan app or agreement. We work out what you still owe.
              </Text>
            </>
          ) : (
            <View style={{ marginTop: space.md }}>
              {loans.length === 0 ? (
                <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 15 }}>
                  No loans yet. Use New loan.
                </Text>
              ) : null}
              {loans.map((l) => {
                const on = String(existing) === String(l.id);
                return (
                  <Pressable
                    key={l.id}
                    accessibilityRole="radio"
                    accessibilityLabel={l.name}
                    accessibilityState={{ checked: on }}
                    onPress={() => setExisting(l.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      minHeight: 48,
                      borderBottomWidth: 1,
                      borderColor: t.divider,
                    }}
                  >
                    <Ionicons
                      name={on ? 'radio-button-on' : 'radio-button-off'}
                      size={22}
                      color={on ? t.primary : t.muted}
                    />
                    <Text
                      style={{
                        color: t.text,
                        fontFamily: fonts.semibold,
                        fontSize: 16,
                        marginLeft: space.sm,
                      }}
                    >
                      {l.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </Card>

        <View
          style={{
            backgroundColor: t.primarySoft,
            borderRadius: radius.lg,
            padding: space.lg,
            marginTop: space.lg,
          }}
        >
          <Text style={{ color: t.primary, fontFamily: fonts.bold, fontSize: 15 }}>How it is counted</Text>
          <Text
            style={{ color: t.primary, fontFamily: fonts.body, fontSize: 15, lineHeight: 22, marginTop: 2 }}
          >
            Budget: the full {formatMoney(cluster.amount)} is Loan/EMI spending each month. Net worth: the
            loan goes down by the principal part, so nothing is counted twice. A missed debit on day{' '}
            {day || cluster.debitDay} gets a reminder.
          </Text>
        </View>
      </ScrollView>
      <View
        style={{
          flexDirection: 'row',
          gap: space.md,
          padding: space.lg,
          borderTopWidth: 1,
          borderColor: t.border,
          backgroundColor: t.bg,
        }}
      >
        <AppButton
          title="Not a loan"
          variant="secondary"
          size="lg"
          style={{ flex: 1 }}
          disabled={busy}
          onPress={notALoan}
        />
        <AppButton
          title="Link to loan"
          size="lg"
          style={{ flex: 1.6 }}
          loading={busy}
          disabled={busy}
          onPress={link}
        />
      </View>
    </SafeAreaView>
  );
}
