import { View, Text, TextInput, ScrollView, SafeAreaView, useTokens } from '../components/Theme';
import React, { useCallback, useState } from 'react';
import { Alert, Switch } from 'react-native';
import AppButton from '../components/ui/AppButton';
import ScreenHeader from '../components/ui/ScreenHeader';

import { useFocusEffect } from '@react-navigation/native';
import Storage from '../data/Storage';
import { add, getAll } from '../data/TransactionRepo';
import { bulkUpdate, bulkDelete, contributeToGoal, saveNetWorthSnapshot } from '../utils/FeatureService';
import { filterHistory, xirr, amortize } from '../utils/FinanceTools';
import { exportHistory } from '../utils/HistoryExport';
import { parseAmount, parseNonNegative, formatMoney } from '../utils/Format';
import { mutateList } from '../data/Collections';
import { scheduleCardReminder } from '../utils/CardReminders';
// C4: the Money tools hub is gone. Each section is its own screen (route MoneyTool, param tab),
// opened from where it belongs; review lives in Review accounts.
export const TOOL_TITLES = {
  Transfers: 'New transfer',
  Rules: 'Category rules',
  History: 'Bulk edit & export',
  Goals: 'Goal contributions',
  Wealth: 'Money calculators',
};
const Field = ({ label, value, onChangeText, number = false }) => (
  <View style={{ marginVertical: 6 }}>
    <Text>{label}</Text>
    <TextInput
      value={value}
      onChangeText={onChangeText}
      keyboardType={number ? 'numeric' : 'default'}
      style={{ borderWidth: 1, borderColor: '#999', padding: 10, borderRadius: 8 }}
    />
  </View>
);
const Choices = ({ items, value, onChange }) => (
  <ScrollView horizontal>
    {items.map((item) => (
      <AppButton
        key={String(item.id)}
        title={item.name}
        variant={String(value) === String(item.id) ? 'primary' : 'secondary'}
        size="sm"
        style={{ marginRight: 8 }}
        onPress={() => onChange(item.id)}
      />
    ))}
  </ScrollView>
);
export default function ToolsScreen({ navigation, route }) {
  const t = useTokens();
  const tab = TOOL_TITLES[route.params?.tab] ? route.params.tab : 'Transfers';
  const [accounts, setAccounts] = useState([]),
    [rows, setRows] = useState([]),
    [goals, setGoals] = useState([]),
    [rules, setRules] = useState([]),
    [snapshots, setSnapshots] = useState([]);
  // B5: Card detail → Record payment pre-fills bank → card and the amount left on the bill.
  const prefill = route.params?.prefill || {};
  const [from, setFrom] = useState(prefill.fromId ?? ''),
    [to, setTo] = useState(prefill.toId ?? ''),
    [amount, setAmount] = useState(prefill.amount ? String(prefill.amount) : '');
  const [pattern, setPattern] = useState(''),
    [category, setCategory] = useState('');
  const [query, setQuery] = useState(''),
    [accountFilter, setAccountFilter] = useState(''),
    [min, setMin] = useState(''),
    [max, setMax] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [selected, setSelected] = useState([]);
  const [goalId, setGoalId] = useState(route.params?.goalId ? String(route.params.goalId) : ''),
    [contribution, setContribution] = useState('');
  const [flows, setFlows] = useState(''),
    [principal, setPrincipal] = useState(''),
    [rate, setRate] = useState(''),
    [emi, setEmi] = useState(''),
    [prepayment, setPrepayment] = useState('0'),
    [result, setResult] = useState('');
  const [card, setCard] = useState(''),
    [due, setDue] = useState('');
  const load = useCallback(async () => {
    const values = Object.fromEntries(
      await Storage.multiGet(['user_wealth_accounts', 'user_goals', 'category_rules', 'networth_history'])
    );
    setAccounts(JSON.parse(values.user_wealth_accounts || '[]'));
    setGoals(JSON.parse(values.user_goals || '[]'));
    setRules(JSON.parse(values.category_rules || '[]'));
    setSnapshots(JSON.parse(values.networth_history || '[]'));
    setRows(await getAll());
  }, []);
  useFocusEffect(
    useCallback(() => {
      load().catch((error) => Alert.alert('Load error', error.message));
    }, [load])
  );
  const run = async (action) => {
    try {
      await action();
      await load();
    } catch (error) {
      Alert.alert('Cannot complete', error.message);
    }
  };
  const filtered = filterHistory(rows, {
    text: query,
    account: accountFilter,
    min: min ? parseAmount(min) : null,
    max: max ? parseAmount(max) : null,
    from: start,
    to: end,
  });
  const spendable = accounts.filter((a) =>
    ['Cash', 'Bank Account', 'Wallet', 'Credit Card'].includes(a.type)
  );
  const selectedGoal = goals.find((g) => String(g.id) === String(goalId));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title={TOOL_TITLES[tab]} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
        {tab === 'Transfers' && (
          <View>
            {accounts
              .filter((w) => w.type === 'Wallet')
              .map((w) => {
                const bank = accounts.find((b) => String(b.id) === String(w.linkedBankId));
                return (
                  <View key={`short_${w.id}`} style={{ flexDirection: 'row', marginBottom: 6 }}>
                    <AppButton
                      title={`Top-up ${w.name}`}
                      disabled={!bank}
                      onPress={() => {
                        setFrom(bank.id);
                        setTo(w.id);
                      }}
                    />
                    <AppButton
                      title="Withdraw to bank"
                      disabled={!bank}
                      onPress={() => {
                        setFrom(w.id);
                        setTo(bank.id);
                      }}
                    />
                  </View>
                );
              })}
            <Text>From account</Text>
            <Choices items={spendable} value={from} onChange={setFrom} />
            <Text>To account</Text>
            <Choices items={spendable} value={to} onChange={setTo} />
            <Field label="Amount (₹)" value={amount} onChangeText={setAmount} number />
            <AppButton
              title="Save transfer"
              onPress={() =>
                run(async () => {
                  const value = parseAmount(amount),
                    source = accounts.find((a) => String(a.id) === String(from)),
                    destination = accounts.find((a) => String(a.id) === String(to));
                  if (!value || !source || !destination || String(from) === String(to))
                    throw new Error('Choose different accounts and a valid amount');
                  const walletKind =
                    destination.type === 'Wallet'
                      ? 'wallet_topup'
                      : source.type === 'Wallet'
                        ? 'wallet_withdraw'
                        : destination.type === 'Credit Card'
                          ? 'cc_payment'
                          : null;
                  await add({
                    id: `transfer_${Date.now()}`,
                    type: 'transfer',
                    ...(walletKind ? { transferKind: walletKind, source: 'manual' } : {}),
                    title: `${source.name} → ${destination.name}`,
                    category: 'Transfer',
                    amount: value,
                    account: source.name,
                    accountId: source.id,
                    toAccountId: destination.id,
                    fullDate: new Date().toISOString(),
                  });
                  setAmount('');
                  Alert.alert('Saved', 'Both account balances updated.');
                })
              }
            />
          </View>
        )}
        {tab === 'Rules' && (
          <View>
            <Text style={{ fontWeight: 'bold' }}>Category rules (first match wins)</Text>
            <Field label="Merchant / VPA / text contains" value={pattern} onChangeText={setPattern} />
            <Field label="Category" value={category} onChangeText={setCategory} />
            <AppButton
              title="Add rule"
              onPress={() =>
                run(async () => {
                  if (!pattern.trim() || !category.trim())
                    throw new Error('Enter matching text and category');
                  await mutateList('category_rules', (list) => [
                    ...list,
                    { id: Date.now(), pattern: pattern.trim(), category: category.trim() },
                  ]);
                  setPattern('');
                })
              }
            />
            {rules.map((rule) => (
              <View key={rule.id}>
                <Text>
                  {rule.pattern} → {rule.category}
                </Text>
                <AppButton
                  title="Remove rule"
                  onPress={() =>
                    run(() => mutateList('category_rules', (list) => list.filter((r) => r.id !== rule.id)))
                  }
                />
              </View>
            ))}
          </View>
        )}
        {tab === 'History' && (
          <View>
            <Field
              label="Search description, merchant, category or tags"
              value={query}
              onChangeText={setQuery}
            />
            <Field label="Minimum amount" value={min} onChangeText={setMin} number />
            <Field label="Maximum amount" value={max} onChangeText={setMax} number />
            <Field label="From date (YYYY-MM-DD)" value={start} onChangeText={setStart} />
            <Field label="To date (YYYY-MM-DD)" value={end} onChangeText={setEnd} />
            <Choices
              items={[
                { id: '', name: 'All accounts' },
                ...accounts.map((a) => ({ id: a.name, name: a.name })),
              ]}
              value={accountFilter}
              onChange={setAccountFilter}
            />
            <Text>
              {filtered.length} matches · {selected.length} selected
            </Text>
            <AppButton title="Export matching CSV" onPress={() => run(() => exportHistory(filtered))} />
            <AppButton
              title="Export matching Excel"
              onPress={() => run(() => exportHistory(filtered, 'xlsx'))}
            />
            <AppButton title="Select matching rows" onPress={() => setSelected(filtered.map((t) => t.id))} />
            <AppButton title="Clear selection" onPress={() => setSelected([])} />
            <Field label="New category for selected rows" value={category} onChangeText={setCategory} />
            <AppButton
              title="Apply category to selection"
              onPress={() =>
                run(async () => {
                  if (!selected.length || !category.trim())
                    throw new Error('Select rows and enter a category');
                  await bulkUpdate(selected, { category: category.trim() });
                  setSelected([]);
                })
              }
            />
            <AppButton
              title="Delete selected"
              variant="danger"
              onPress={() => {
                if (!selected.length) return;
                Alert.alert(
                  'Delete selection?',
                  `Delete ${selected.length} transactions and reverse balances?`,
                  [
                    { text: 'Cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () =>
                        run(async () => {
                          await bulkDelete(selected);
                          setSelected([]);
                        }),
                    },
                  ]
                );
              }}
            />
            {filtered.map((tx) => (
              <View key={tx.id} style={{ borderBottomWidth: 1, borderColor: '#ccc', padding: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Switch
                    value={selected.includes(tx.id)}
                    onValueChange={(value) =>
                      setSelected(value ? [...selected, tx.id] : selected.filter((id) => id !== tx.id))
                    }
                  />
                  <Text style={{ flex: 1 }}>
                    {tx.date} · {tx.title} · {formatMoney(tx.amount)} · {tx.type}
                  </Text>
                </View>
                <AppButton
                  title="Edit"
                  onPress={() => navigation.navigate('TransactionDetail', { transaction: tx })}
                />
              </View>
            ))}
          </View>
        )}
        {tab === 'Goals' && (
          <View>
            <Text>
              Contributions track savings allocated to a goal. Use a transfer separately when money moves
              between accounts.
            </Text>
            <Choices items={goals} value={goalId} onChange={setGoalId} />
            {selectedGoal && (
              <View>
                <Text>
                  {selectedGoal.name}: {formatMoney(selectedGoal.savedAmount)} /{' '}
                  {formatMoney(selectedGoal.targetAmount)}
                </Text>
                <AppButton
                  title="Edit goal or linked account"
                  onPress={() => navigation.navigate('AddGoal', { goal: selectedGoal })}
                />
                <Field label="Contribution (₹)" value={contribution} onChangeText={setContribution} number />
                <AppButton
                  title="Record contribution"
                  onPress={() =>
                    run(async () => {
                      const value = parseAmount(contribution);
                      if (!value) throw new Error('Enter a valid contribution');
                      await contributeToGoal(goalId, value);
                      setContribution('');
                    })
                  }
                />
                {(selectedGoal.contributions || []).map((row) => (
                  <Text key={row.id}>
                    {new Date(row.date).toLocaleDateString('en-IN')} · {formatMoney(row.amount)}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}
        {tab === 'Wealth' && (
          <View>
            <AppButton
              title="Save today’s net worth snapshot"
              onPress={() => run(() => saveNetWorthSnapshot())}
            />
            {snapshots
              .slice(-12)
              .reverse()
              .map((s) => (
                <Text key={s.date}>
                  {s.date} · {formatMoney(s.netWorth)}
                </Text>
              ))}
            <Text style={{ fontWeight: 'bold', marginTop: 16 }}>Investment XIRR</Text>
            <Text>
              One flow per line: YYYY-MM-DD, signed amount. Contributions negative, withdrawals and current
              value positive. Multiple sign changes can produce multiple roots.
            </Text>
            <TextInput
              multiline
              value={flows}
              onChangeText={setFlows}
              style={{ minHeight: 100, borderWidth: 1, borderColor: '#999', padding: 10 }}
              placeholder={'2025-01-01,-10000\n2026-01-01,11000'}
            />
            <AppButton
              title="Calculate XIRR"
              onPress={() =>
                run(async () => {
                  const parsed = flows
                    .trim()
                    .split('\n')
                    .map((line) => {
                      const [date, amount] = line.split(',');
                      return { date: date.trim(), amount: Number(amount) };
                    });
                  const value = xirr(parsed);
                  setResult(
                    value === null
                      ? 'Cannot determine XIRR for these flows'
                      : `XIRR: ${(value * 100).toFixed(2)}%`
                  );
                })
              }
            />
            <Text style={{ fontWeight: 'bold', marginTop: 16 }}>Loan prepayment simulation</Text>
            <Field label="Outstanding principal" value={principal} onChangeText={setPrincipal} number />
            <Field label="Annual interest %" value={rate} onChangeText={setRate} number />
            <Field label="Monthly EMI" value={emi} onChangeText={setEmi} number />
            <Field label="Immediate prepayment" value={prepayment} onChangeText={setPrepayment} number />
            <AppButton
              title="Compare repayment plans"
              onPress={() =>
                run(async () => {
                  const args = {
                    principal: parseAmount(principal),
                    annualRate: parseNonNegative(rate),
                    emi: parseAmount(emi),
                    prepayment: parseNonNegative(prepayment),
                  };
                  const normal = amortize({ ...args, prepayment: 0 }),
                    changed = amortize(args);
                  setResult(
                    `Normal: ${normal.months} months, ${formatMoney(normal.totalInterest)} interest\nPrepaid: ${changed.months} months, ${formatMoney(changed.totalInterest)} interest\nInterest saved: ${formatMoney(normal.totalInterest - changed.totalInterest)}\nFirst payments:\n${changed.schedule
                      .slice(0, 12)
                      .map(
                        (r) =>
                          `${r.month}: principal ${formatMoney(r.principal)}, interest ${formatMoney(r.interest)}, balance ${formatMoney(r.balance)}`
                      )
                      .join('\n')}`
                  );
                })
              }
            />
            <Text>{result}</Text>
            <Text style={{ fontWeight: 'bold', marginTop: 16 }}>Credit card due-date reminders</Text>
            <Choices
              items={accounts.filter((a) => a.type === 'Credit Card')}
              value={card}
              onChange={setCard}
            />
            <Field label="Monthly due day (1–31)" value={due} onChangeText={setDue} number />
            <AppButton
              title="Schedule reminders for 12 months"
              onPress={() =>
                run(async () => {
                  const account = accounts.find((a) => String(a.id) === String(card));
                  if (!account) throw new Error('Choose a credit card');
                  await scheduleCardReminder(account, Number(due));
                  Alert.alert(
                    'Scheduled',
                    'Review your bill each month; reminder dates clamp to the last day in shorter months.'
                  );
                })
              }
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
