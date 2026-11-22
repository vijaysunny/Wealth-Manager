/**
 * Add or edit a loan or EMI (Phase 13 C2, docs/design/14-add-loan-card-emi.png).
 * Route 'LoanEdit', params { loanId?, prefill? } (prefill from "Track as EMI": kind, name, amount,
 * payFromId, firstEmi, sourceTxId). The EMI is worked out with the reducing-balance formula until
 * the owner types their own (they copy it from the lender's app).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { AppButton, Card, Chip, OptionSheet, ScreenHeader } from '../components/ui';
import { formatMoney, parseAmount } from '../utils/Format';
import { shortAccountName } from '../utils/TransactionList';
import { emiFor } from '../utils/LoanCalculator';
import { LOAN_KINDS, formFromLoan, loanFormCheck, longDate, parseDmy } from '../utils/LoanForm';
import { deleteLoan, loadLoan, saveLoan } from '../utils/LoanService';

const BLANK = {
  kind: 'personal',
  name: '',
  amount: '',
  months: '',
  rate: '',
  firstEmi: '',
  emi: '',
  payFromId: null,
};
const BANKISH = ['Bank Account', 'Savings Account', 'Current Account'];

export default function LoanEditScreen({ navigation, route }) {
  const t = useTokens();
  const loanId = route.params?.loanId ?? null;
  const prefill = route.params?.prefill || null;
  const [ready, setReady] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [f, setF] = useState(BLANK);
  const [emiTyped, setEmiTyped] = useState(false);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadLoan(loanId)
      .then(({ loan, accounts: list }) => {
        if (loanId != null && !loan) {
          Alert.alert('Loan', 'This item no longer exists.');
          navigation.goBack();
          return;
        }
        setAccounts(list);
        if (loan) {
          setF(formFromLoan(loan));
          setEmiTyped(true);
        } else if (prefill) setF({ ...BLANK, ...prefill });
        setReady(true);
      })
      .catch((e) => Alert.alert('Loan', e.message));
  }, [loanId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (v) => setF((o) => ({ ...o, [k]: v }));
  const isCardEmi = f.kind === 'cardEmi';
  const workedOut = emiFor(parseAmount(f.amount), Number(f.rate) || 0, Number(f.months));
  const emiText = emiTyped ? f.emi : workedOut ? String(workedOut) : '';
  const first = parseDmy(f.firstEmi);
  const values = useMemo(
    () => ({
      kind: f.kind,
      name: f.name,
      amount: parseAmount(f.amount),
      months: Number(f.months),
      rate: f.rate === '' ? 0 : Number(f.rate),
      firstEmi: first,
      emi: parseAmount(emiText),
      payFromId: f.payFromId,
      sourceTxId: f.sourceTxId,
    }),
    [f, first, emiText]
  );
  const check = loanFormCheck(values);
  const payOptions = accounts
    .filter((a) => (isCardEmi ? a.type === 'Credit Card' : BANKISH.includes(a.type)))
    .map((a) => ({ value: a.id, label: shortAccountName(a.name, a.last4) }));
  const payFrom = accounts.find((a) => String(a.id) === String(f.payFromId));
  const pickKind = (k) =>
    setF((o) => {
      const was = accounts.find((a) => String(a.id) === String(o.payFromId));
      const keep = was && (k === 'cardEmi' ? was.type === 'Credit Card' : was.type !== 'Credit Card');
      return { ...o, kind: k, payFromId: keep ? o.payFromId : null };
    });

  const save = async () => {
    if (check.error) {
      Alert.alert('Loan', check.error);
      return;
    }
    setSaving(true);
    try {
      await saveLoan(values, loanId);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Loan', e.message);
    } finally {
      setSaving(false);
    }
  };
  const remove = () =>
    Alert.alert('Delete this loan?', 'Its schedule and linked payments are removed. Transactions stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteLoan(loanId);
          navigation.navigate('Main', { screen: 'AccountsTab' });
        },
      },
    ]);

  if (!ready) return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} />;
  const label = { color: t.text2, fontFamily: fonts.semibold, fontSize: 15, marginBottom: space.sm };
  const box = {
    borderWidth: 1,
    borderColor: t.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
  };
  const inputText = { flex: 1, color: t.text, fontFamily: fonts.medium, fontSize: 18 };
  const field = (key, title, props = {}, prefix, suffix) => (
    <View style={{ flex: 1 }}>
      <Text style={label}>{title}</Text>
      <View style={box}>
        {prefix ? (
          <Text style={{ color: t.text2, fontFamily: fonts.medium, fontSize: 18, marginRight: space.sm }}>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel={title}
          value={f[key]}
          onChangeText={set(key)}
          placeholderTextColor={t.placeholder}
          style={inputText}
          {...props}
        />
        {suffix ? (
          <Text style={{ color: t.muted, fontFamily: fonts.medium, fontSize: 18 }}>{suffix}</Text>
        ) : null}
      </View>
    </View>
  );
  const note = isCardEmi
    ? {
        bg: t.warnBg,
        border: t.warnBorder,
        fg: t.warnText,
        title: 'Already in your card balance',
        body: `The bank billed the full ${
          values.amount ? formatMoney(values.amount) : 'amount'
        } on the card and adds the EMI to each bill. This entry only tracks months left; it is not added to Liabilities again.`,
      }
    : {
        bg: t.primarySoft,
        border: t.primarySoft,
        fg: t.text,
        title: 'How the EMI is counted',
        body: 'Each EMI date that has passed counts as paid, from the schedule. Link the bank debits to this loan to see what went to principal and to interest.',
      };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        title={loanId != null ? (isCardEmi ? 'Edit EMI' : 'Edit loan') : 'Add loan or EMI'}
        backIcon="close"
        backLabel="Close"
        onBack={() => navigation.goBack()}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={label}>Type</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }}>
            {LOAN_KINDS.map((k) => (
              <Chip
                key={k.value}
                testID={`kind-${k.value}`}
                label={k.label}
                selected={f.kind === k.value}
                onPress={() => pickKind(k.value)}
              />
            ))}
          </View>

          <Card>
            {field('name', 'Name', { placeholder: isCardEmi ? 'e.g. Phone EMI' : 'e.g. Bajaj Finance' })}
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
              {field('amount', 'Amount', { keyboardType: 'numeric', placeholder: '0' }, '₹')}
              {field('months', 'Months', { keyboardType: 'number-pad', placeholder: '12' })}
            </View>
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
              {field(
                'rate',
                'Interest % a year',
                { keyboardType: 'decimal-pad', placeholder: '0' },
                null,
                '%'
              )}
              {field('firstEmi', 'First EMI', {
                placeholder: 'DD/MM/YYYY',
                keyboardType: 'numbers-and-punctuation',
              })}
            </View>
            {first ? (
              <Text
                style={{
                  color: t.muted,
                  fontFamily: fonts.body,
                  fontSize: 13,
                  marginTop: space.xs,
                  textAlign: 'right',
                }}
              >
                {longDate(first)}
              </Text>
            ) : null}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                borderTopWidth: 1,
                borderColor: t.divider,
                marginTop: space.lg,
                paddingTop: space.md,
              }}
            >
              <Text style={{ flex: 1, color: t.muted, fontFamily: fonts.body, fontSize: 15 }}>
                EMI (worked out, edit if different)
              </Text>
              <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 22 }}>₹</Text>
              <TextInput
                testID="loan-emi"
                accessibilityLabel="EMI"
                value={emiText}
                onChangeText={(v) => {
                  setEmiTyped(true);
                  set('emi')(v);
                }}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={t.placeholder}
                style={{
                  minWidth: 90,
                  color: t.text,
                  fontFamily: fonts.display,
                  fontSize: 22,
                  textAlign: 'right',
                }}
              />
            </View>
            {emiTyped && workedOut && Math.abs(parseAmount(emiText) - workedOut) >= 1 ? (
              <Text
                accessibilityRole="button"
                onPress={() => {
                  setEmiTyped(false);
                  set('emi')('');
                }}
                style={{ color: t.primary, fontFamily: fonts.semibold, fontSize: 14, textAlign: 'right' }}
              >
                Use worked-out {formatMoney(workedOut)}
              </Text>
            ) : null}
          </Card>

          <Pressable
            testID="pay-from"
            accessibilityRole="button"
            accessibilityLabel={`Paid from, ${payFrom ? shortAccountName(payFrom.name, payFrom.last4) : 'not set'}`}
            onPress={() => setPicker(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: t.card,
              borderColor: t.border,
              borderWidth: 1,
              borderRadius: radius.lg,
              padding: space.lg,
              marginTop: space.lg,
            }}
          >
            <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 15, width: 96 }}>Paid from</Text>
            <Text
              style={{ flex: 1, color: payFrom ? t.text : t.muted, fontFamily: fonts.semibold, fontSize: 17 }}
            >
              {payFrom
                ? shortAccountName(payFrom.name, payFrom.last4)
                : isCardEmi
                  ? 'Pick the card'
                  : 'Optional'}
            </Text>
            <Ionicons name="chevron-forward" size={20} color={t.muted} />
          </Pressable>

          <View
            testID="loan-note"
            style={{
              backgroundColor: note.bg,
              borderColor: note.border,
              borderWidth: 1,
              borderRadius: radius.lg,
              padding: space.lg,
              marginTop: space.lg,
            }}
          >
            <Text style={{ color: note.fg, fontFamily: fonts.bold, fontSize: 15 }}>{note.title}</Text>
            <Text
              style={{ color: note.fg, fontFamily: fonts.body, fontSize: 15, lineHeight: 22, marginTop: 2 }}
            >
              {note.body}
            </Text>
          </View>

          {check.warn ? (
            <Text
              testID="loan-warn"
              style={{ color: t.warnText, fontFamily: fonts.medium, fontSize: 14, marginTop: space.md }}
            >
              {check.warn}
            </Text>
          ) : null}
          {check.error && f.amount && f.months ? (
            <Text
              testID="loan-error"
              style={{ color: t.dangerText, fontFamily: fonts.medium, fontSize: 14, marginTop: space.md }}
            >
              {check.error}
            </Text>
          ) : null}
          {loanId != null ? (
            <AppButton
              title={isCardEmi ? 'Delete EMI' : 'Delete loan'}
              variant="danger"
              style={{ marginTop: space.xl }}
              onPress={remove}
            />
          ) : null}
        </ScrollView>
        <View style={{ padding: space.lg, borderTopWidth: 1, borderColor: t.border, backgroundColor: t.bg }}>
          <AppButton title="Save" size="lg" loading={saving} disabled={saving} onPress={save} />
        </View>
      </KeyboardAvoidingView>

      <OptionSheet
        visible={picker}
        title={isCardEmi ? 'Which card?' : 'Paid from'}
        options={payOptions}
        value={f.payFromId}
        onSelect={(id) => {
          set('payFromId')(id);
          setPicker(false);
        }}
        onClose={() => setPicker(false)}
      />
    </SafeAreaView>
  );
}
