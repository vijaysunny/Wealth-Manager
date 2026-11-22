/**
 * Link to a loan (Phase 13 C6, docs/design/17-link-loan-payment.png).
 * Route 'LoanLink', params { txId?, loanId?, fromTx? }. Without txId it first lists candidate debits
 * for the loan. The split must add up to the amount before Save. After saving from transaction
 * detail it closes that screen too (its form would otherwise save the old category back).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { AppButton, Card, Chip, OptionSheet, ScreenHeader, Segmented } from '../components/ui';
import { formatMoney, parseAmount } from '../utils/Format';
import { shortAccountName } from '../utils/TransactionList';
import { shortDate } from '../utils/CardView';
import { isCardEmi } from '../utils/LoanCalculator';
import { defaultSplit } from '../utils/LoanLedger';
import { LINK_KINDS, candidatesFor, linkError, splitGap } from '../utils/LoanLink';
import { loadLoanWithTxs, saveLink, setBudgetMode, unlinkPayment } from '../utils/LoanService';

const money = (n) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '');

export default function LoanLinkScreen({ navigation, route }) {
  const t = useTokens();
  const params = route.params || {};
  const [data, setData] = useState(null);
  const [txId, setTxId] = useState(params.txId ?? null);
  const [loanId, setLoanId] = useState(params.loanId ?? null);
  const [kind, setKind] = useState('emi');
  const [principal, setPrincipal] = useState('');
  const [interest, setInterest] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState('endSooner');
  const [budget, setBudget] = useState('full');
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadLoanWithTxs(null)
        .then((d) => setData(d))
        .catch((e) => Alert.alert('Link', e.message));
    }, [])
  );

  const loans = useMemo(
    () =>
      data ? data.accounts.filter((a) => a.type === 'Loan' && !isCardEmi(a) && a.status !== 'closed') : [],
    [data]
  );
  const byId = useMemo(
    () => (data ? Object.fromEntries(data.accounts.map((a) => [String(a.id), a])) : {}),
    [data]
  );
  const tx = data && txId != null ? data.txs.find((x) => String(x.id) === String(txId)) || null : null;
  const loan =
    loans.find((l) => String(l.id) === String(loanId)) ||
    (loanId != null ? byId[String(loanId)] : null) ||
    null;
  const txType = tx ? (tx.loanLinkPrev ? tx.loanLinkPrev.type : tx.type) : null;

  const fillSplit = useCallback(
    (k) => {
      if (!tx || !loan) return;
      const s = defaultSplit(loan, data.txs, k, tx.amount, new Date(tx.fullDate), tx.loanLink ? tx : null);
      setPrincipal(money(s.principal));
      setInterest(money(s.interest));
      setNote(s.note);
    },
    [tx, loan, data]
  );

  // First fill: an existing link keeps its numbers; otherwise defaults for the kind.
  useEffect(() => {
    if (!tx) return;
    if (tx.loanLink) {
      setLoanId((id) => id ?? tx.loanLink.loanId);
      setKind(tx.loanLink.kind);
      setPrincipal(money(tx.loanLink.principal));
      setInterest(money(tx.loanLink.interest));
      if (tx.loanLink.mode) setMode(tx.loanLink.mode);
      setNote(tx.loanLink.emiNo ? `EMI ${tx.loanLink.emiNo} · your split` : '');
    } else {
      const k = tx.type === 'income' ? 'disbursal' : 'emi';
      setKind(k);
      if (loan) fillSplit(k);
    }
  }, [txId, data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (loan) setBudget(loan.budgetMode === 'interestOnly' ? 'interestOnly' : 'full');
    if (tx && loan && !(tx.loanLink && String(tx.loanLink.loanId) === String(loan.id))) fillSplit(kind);
  }, [loanId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} />;

  const close = () => (params.fromTx && navigation.pop ? navigation.pop(2) : navigation.goBack());
  const p = parseAmount(principal) || 0;
  const i = parseAmount(interest) || 0;
  const values = { loanId: loan?.id, kind, principal: p, interest: i, mode, emiNo: undefined };
  const error = tx ? linkError({ ...values, amount: tx.amount, txType }) : null;
  const gap = tx ? splitGap(tx.amount, p, i) : 0;

  const save = async () => {
    if (!loan) return Alert.alert('Link', 'Pick a loan.');
    if (error) return Alert.alert('Link', error);
    setSaving(true);
    try {
      const s =
        kind === 'emi'
          ? defaultSplit(loan, data.txs, 'emi', tx.amount, new Date(tx.fullDate), tx.loanLink ? tx : null)
          : {};
      if ((loan.budgetMode === 'interestOnly' ? 'interestOnly' : 'full') !== budget)
        await setBudgetMode(loan.id, budget);
      await saveLink(tx.id, {
        ...values,
        emiNo: s.emiNo,
        source: tx.smsId ? 'sms' : 'manual',
      });
      close();
    } catch (e) {
      Alert.alert('Link', e.message);
    } finally {
      setSaving(false);
    }
  };
  const unlink = async () => {
    try {
      await unlinkPayment(tx.id);
      close();
    } catch (e) {
      Alert.alert('Link', e.message);
    }
  };

  // Step 1 (from Loan detail): pick the payment.
  if (!tx) {
    const list = loan ? candidatesFor(loan, data.txs, byId) : [];
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ScreenHeader
          title="Link a payment"
          backIcon="close"
          backLabel="Close"
          onBack={() => navigation.goBack()}
        />
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}>
          <Text
            style={{
              color: t.text2,
              fontFamily: fonts.body,
              fontSize: 15,
              lineHeight: 22,
              marginBottom: space.md,
            }}
          >
            Bank debits from the same payee, or close to the EMI and near an EMI date.
          </Text>
          <Card padding={0}>
            {list.length === 0 ? (
              <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 15, padding: space.lg }}>
                No matching debit found. Open the debit in Transactions and use Link to loan.
              </Text>
            ) : null}
            {list.map((c, n) => {
              const acc = byId[String(c.accountId)];
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.merchant || c.title}, ${formatMoney(c.amount)}, ${shortDate(c.fullDate)}`}
                  onPress={() => setTxId(c.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: space.lg,
                    borderTopWidth: n ? 1 : 0,
                    borderColor: t.divider,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 16 }}
                    >
                      {c.merchant || c.title}
                    </Text>
                    <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14 }}>
                      {[acc ? shortAccountName(acc.name, acc.last4) : c.account, shortDate(c.fullDate)]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Text style={{ color: t.text, fontFamily: fonts.displaySemi, fontSize: 16 }}>
                    {formatMoney(c.amount)}
                  </Text>
                </Pressable>
              );
            })}
          </Card>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const acc = tx.accountId != null ? byId[String(tx.accountId)] : null;
  const amountBox = (label, value, set, color, a11y) => (
    <View style={{ flex: 1 }}>
      <Text style={{ color, fontFamily: fonts.semibold, fontSize: 15, marginBottom: space.xs }}>{label}</Text>
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
        <Text style={{ color: t.text2, fontFamily: fonts.medium, fontSize: 17, marginRight: 6 }}>₹</Text>
        <TextInput
          accessibilityLabel={a11y}
          value={value}
          onChangeText={set}
          keyboardType="decimal-pad"
          editable={kind !== 'disbursal'}
          style={{ flex: 1, color: t.text, fontFamily: fonts.medium, fontSize: 17 }}
        />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        title="Link to a loan"
        backIcon="close"
        backLabel="Close"
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <Card testID="link-tx">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 17 }}>
                {tx.merchant || tx.title || 'Payment'}
              </Text>
              <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14 }}>
                {[
                  acc ? shortAccountName(acc.name, acc.last4) : tx.account,
                  shortDate(tx.fullDate),
                  tx.smsId ? 'from SMS' : 'manual',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 20 }}>
              {formatMoney(tx.amount)}
            </Text>
          </View>
        </Card>

        <Pressable
          testID="loan-picker"
          accessibilityRole="button"
          accessibilityLabel={`Loan, ${loan ? loan.name : 'not chosen'}`}
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
          <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 15, width: 80 }}>Loan</Text>
          <Text style={{ flex: 1, color: loan ? t.text : t.muted, fontFamily: fonts.semibold, fontSize: 17 }}>
            {loan
              ? `${loan.name}${loan.emiAmount ? ` · ${formatMoney(Number(loan.emiAmount))}/mo` : ''}`
              : loans.length
                ? 'Pick a loan'
                : 'Add a loan first'}
          </Text>
          <Ionicons name="chevron-forward" size={20} color={t.muted} />
        </Pressable>

        <Text
          style={{
            color: t.text2,
            fontFamily: fonts.semibold,
            fontSize: 15,
            marginTop: space.lg,
            marginBottom: space.sm,
          }}
        >
          This payment is
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {LINK_KINDS.map((k) => (
            <Chip
              key={k.value}
              testID={`link-kind-${k.value}`}
              label={k.label}
              selected={kind === k.value}
              onPress={() => {
                setKind(k.value);
                fillSplit(k.value);
              }}
            />
          ))}
        </View>

        <Card style={{ marginTop: space.lg }}>
          <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 19 }}>Split</Text>
          {note ? (
            <Text
              testID="split-note"
              style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14, marginTop: 2 }}
            >
              {note}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.md }}>
            {amountBox('Principal', principal, setPrincipal, t.income, 'Principal')}
            {amountBox('Interest & charges', interest, setInterest, t.dangerText, 'Interest & charges')}
          </View>
          {kind !== 'disbursal' && gap !== 0 ? (
            <Text
              testID="split-gap"
              style={{ color: t.dangerText, fontFamily: fonts.semibold, fontSize: 14, marginTop: space.sm }}
            >
              {gap > 0 ? `${formatMoney(gap)} still to split` : `${formatMoney(-gap)} more than the payment`}
            </Text>
          ) : null}
          <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14, marginTop: space.sm }}>
            {kind === 'disbursal'
              ? 'Money in from the lender is a transfer, not income.'
              : 'Principal lowers what you owe. Interest goes to Interest & charges.'}
          </Text>
          {kind === 'prepayment' ? (
            <View style={{ marginTop: space.md }}>
              <Text
                style={{ color: t.text2, fontFamily: fonts.semibold, fontSize: 15, marginBottom: space.xs }}
              >
                After the prepayment
              </Text>
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'endSooner', label: 'End sooner' },
                  { value: 'reduceEmi', label: 'Reduce EMI' },
                ]}
              />
            </View>
          ) : null}
        </Card>

        {kind !== 'disbursal' ? (
          <Card style={{ marginTop: space.lg }}>
            <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 19, marginBottom: space.md }}>
              Count in budget as
            </Text>
            <Segmented
              value={budget}
              onChange={setBudget}
              options={[
                { value: 'full', label: 'Full payment' },
                { value: 'interestOnly', label: 'Interest only' },
              ]}
            />
            <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14, marginTop: space.sm }}>
              Setting for this loan. Net worth is the same either way.
            </Text>
          </Card>
        ) : null}
        {tx.loanLink ? (
          <AppButton title="Unlink" variant="danger" style={{ marginTop: space.lg }} onPress={unlink} />
        ) : null}
      </ScrollView>
      <View style={{ padding: space.lg, borderTopWidth: 1, borderColor: t.border, backgroundColor: t.bg }}>
        <AppButton
          title="Link payment"
          size="lg"
          loading={saving}
          disabled={saving || !!error || !loan}
          onPress={save}
        />
      </View>
      <OptionSheet
        visible={picker}
        title="Which loan?"
        options={loans.map((l) => ({ value: l.id, label: l.name }))}
        value={loan?.id}
        onSelect={(id) => {
          setLoanId(id);
          setPicker(false);
        }}
        onClose={() => setPicker(false)}
        footer={
          <AppButton
            title="Add a loan"
            variant="secondary"
            icon="add"
            onPress={() => {
              setPicker(false);
              navigation.navigate('LoanEdit');
            }}
          />
        }
      />
    </SafeAreaView>
  );
}
