/**
 * Accounts (Phase 12 C5.5, docs/design/Accounts net worth.png).
 * Header with Add · dark net-worth card (total, "N balances missing", Cash & bank /
 * Investments / Owed) · Bank accounts (Set balance) · Credit cards (available limit from SMS,
 * Set due) · Wallets (linked bank) · Investments collapsible (closed by default).
 * Pull to refresh updates live prices, loans and PF interest. Long-press an account to manage it.
 */
import React, { useCallback, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage, { updateAccount as persistAccount } from '../data/Storage';
import { deleteAccount as removeAccount } from '../data/Collections';
import { getAll } from '../data/TransactionRepo';
import { fetchMutualFundNAV, fetchStockPrice } from '../utils/InvestmentApi';
import { calculateOutstandingBalance } from '../utils/LoanCalculator';
import { isWallet } from '../utils/BalanceService';
import { computeReconcile, needsReconcile } from '../utils/WalletReconcile';
import { reconcileWallet } from '../utils/FeatureService';
import { formatMoney } from '../utils/Format';
import { priceStatusLabel } from '../utils/PriceStatus';
import { scheduleCardReminder } from '../utils/CardReminders';
import {
  accountsOverview,
  balanceMissing,
  groupAccounts,
  investmentsSummary,
  latestLimits,
  monthCounts,
} from '../utils/AccountsOverview';
import { shortAccountName, accountInitials } from '../utils/TransactionList';
import { depositValue } from '../utils/DepositValue';
import { useTokens } from '../components/Theme';
import { fonts, radius, space, type } from '../components/tokens';
import { AppButton, Collapsible, Section } from '../components/ui';

const initials = accountInitials;

const INVESTMENT_KINDS = [
  { key: 'mf', title: 'Mutual funds', note: 'NAV updates daily', icon: 'trending-up-outline' },
  { key: 'stocks', title: 'Stocks', note: 'Price on refresh', icon: 'stats-chart-outline' },
  { key: 'fd', title: 'FD / RD', note: 'Interest daily · maturity reminder', icon: 'lock-closed-outline' },
  {
    key: 'other',
    title: 'PF, gold, property',
    note: 'PF adds interest daily',
    icon: 'shield-checkmark-outline',
  },
];

export default function WealthScreen({ navigation }) {
  const t = useTokens();
  const [accounts, setAccounts] = useState([]);
  const [limits, setLimits] = useState({});
  const [counts, setCounts] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [balanceEdit, setBalanceEdit] = useState(null); // { account, text }
  const [dueEdit, setDueEdit] = useState(null); // { account, text }
  const [reconcile, setReconcile] = useState(null); // { account, text, category, requestId }

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    const json = await AsyncStorage.getItem('user_wealth_accounts');
    let accounts = json ? JSON.parse(json) : [];

    // --- LIVE UPDATE LOGIC ---
    if (isRefresh) {
      const processed = await Promise.all(
        accounts.map(async (acc) => {
          // 1. MUTUAL FUNDS (Fix: Check for 'Mutual Fund' type specifically)
          if (acc.type === 'Mutual Fund' && acc.schemeCode) {
            const navData = await fetchMutualFundNAV(acc.schemeCode);
            if (navData) {
              acc.balance = acc.quantity * navData.currentNav;
              acc.lastUpdated = new Date().toISOString();
            }
          }

          // 2. STOCKS & GOLD (Live Prices)
          if (
            (acc.subType === 'Stocks / Equity' || acc.subType === 'Gold / Silver') &&
            acc.symbol &&
            !acc.priceOverride // B3: manual value pauses live updates
          ) {
            const stockData = await fetchStockPrice(acc.symbol);
            if (stockData) {
              acc.priceAsOf = stockData.asOf;
              acc.priceStale = !!stockData.stale;
              const liveRate = stockData.price;
              let val = 0;
              if (acc.subType === 'Gold / Silver' && acc.goldType === 'Jewellery') {
                let purityAdjusted = liveRate * acc.quantity * 0.916;
                val = purityAdjusted * (1 + (acc.makingCharges || 0) / 100);
              } else {
                val = acc.quantity * liveRate;
              }
              acc.balance = val;
            }
          }

          // 3. LOANS (Calculate based on Type)
          if (acc.type === 'Loan') {
            const newBalance = calculateOutstandingBalance(acc);
            acc.balance = newBalance;
          }

          // 4. PROVIDENT FUND (Auto-Interest Simulation)
          // Logic: Calculates interest for days passed since last app open
          if (acc.type === 'Provident Fund') {
            const lastRun = acc.lastInterestCalc ? new Date(acc.lastInterestCalc) : new Date();
            const now = new Date();
            const diffTime = Math.abs(now - lastRun);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            // Only add interest if > 1 day passed to avoid minor floating point spam
            if (diffDays >= 1) {
              const rate = acc.interestRate || 8.25;
              // Daily Interest Formula: Balance * (Rate/100) * (Days/365)
              const interestEarned = (parseFloat(acc.balance) * (rate / 100) * diffDays) / 365;
              acc.balance = parseFloat(acc.balance) + interestEarned;
              acc.lastInterestCalc = now.toISOString(); // Update timestamp
            }
          }

          // 5. FD / RD (B3): value from principal, rate and dates; capped at maturity
          const deposit = depositValue(acc);
          if (deposit !== null && !acc.priceOverride) {
            acc.balance = deposit;
            acc.lastUpdated = new Date().toISOString();
          }

          if (!['Bank Account', 'Credit Card', 'Cash', 'Wallet'].includes(acc.type))
            await persistAccount(acc.id, {
              balance: acc.balance,
              lastUpdated: acc.lastUpdated,
              lastInterestCalc: acc.lastInterestCalc,
            });
          return acc;
        })
      );

      // Save updates back to storage
      accounts = JSON.parse(await AsyncStorage.getItem('user_wealth_accounts'));
      void processed;
    }

    const txs = await getAll();
    setAccounts(accounts);
    setLimits(latestLimits(txs));
    setCounts(monthCounts(txs));
    setRefreshing(false);
  };
  const handleLongPress = (account) => {
    Alert.alert(
      'Edit Account',
      `Manage ${account.name}`,
      [
        { text: 'Update Balance', onPress: () => promptBalance(account) },
        { text: 'Change Type', onPress: () => promptType(account) },
        ...(account.priceOverride
          ? [
              {
                text: 'Resume live price',
                onPress: () => updateAccount(account.id, { priceOverride: false }),
              },
            ]
          : []),
        { text: 'Delete', style: 'destructive', onPress: () => deleteAccount(account) },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true }
    );
  };
  // Alert.prompt is iOS-only, so balance edits use a small Modal (works on Android)
  const promptBalance = (account) => {
    setBalanceEdit({ account, text: String(account.balance ?? '') });
  };
  const saveBalance = () => {
    const value = parseFloat(String(balanceEdit.text).replace(/,/g, ''));
    if (isNaN(value)) {
      Alert.alert('Invalid amount', 'Please enter a valid number.');
      return;
    }
    updateAccount(balanceEdit.account.id, {
      balance: value,
      balanceSetAt: new Date().toISOString(),
      ...(balanceEdit.account.symbol ? { priceOverride: true } : {}),
    });
    setBalanceEdit(null);
  };
  // A4.1: type the balance the UPI app shows; the gap becomes one entry (confirmed first)
  const startReconcile = (account) =>
    setReconcile({ account, text: '', category: '', requestId: `${account.id}_${Date.now()}` });
  const submitReconcile = () => {
    const { account, text, category, requestId } = reconcile;
    let gap;
    try {
      gap = computeReconcile(account, parseFloat(String(text).replace(/,/g, '')));
    } catch (error) {
      Alert.alert('Check the amount', error.message);
      return;
    }
    const save = (mode) =>
      reconcileWallet(account.id, parseFloat(String(text).replace(/,/g, '')), {
        requestId,
        mode,
        category: category.trim() || undefined,
      })
        .then(() => {
          setReconcile(null);
          loadData();
        })
        .catch((error) => Alert.alert('Could not reconcile', error.message));
    if (gap.action === 'none') {
      Alert.alert('Already matching', `${account.name} already shows this balance.`);
      setReconcile(null);
      return;
    }
    if (gap.action === 'expense') {
      Alert.alert(
        'Record unrecorded spends?',
        `${formatMoney(gap.diff)} was spent from ${account.name} without a message. Save it as "Unrecorded wallet spends"${category.trim() ? ` (${category.trim()})` : ''}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save', onPress: () => save('income') },
        ]
      );
      return;
    }
    const options = [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Correction', onPress: () => save('income') },
    ];
    if (account.linkedBankId) options.push({ text: 'Top-up from bank', onPress: () => save('topup') });
    Alert.alert(
      'Balance is higher',
      `${account.name} has ${formatMoney(-gap.diff)} more than tracked. Was it a top-up that was not captured, or a correction?`,
      options
    );
  };
  const promptType = (account) => {
    Alert.alert(
      'Select Type',
      '',
      [
        { text: 'Bank Account', onPress: () => updateAccount(account.id, { type: 'Bank Account' }) },
        { text: 'Credit Card', onPress: () => updateAccount(account.id, { type: 'Credit Card' }) },
        { text: 'Loan', onPress: () => updateAccount(account.id, { type: 'Loan' }) },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true }
    );
  };
  const updateAccount = async (id, updates) => {
    await persistAccount(id, updates);
    loadData();
  };

  const deleteAccount = async (account) => {
    await removeAccount(account.id);
    loadData();
  };
  const saveDue = async () => {
    const day = Number(String(dueEdit.text).trim());
    try {
      await scheduleCardReminder(dueEdit.account, day);
      await updateAccount(dueEdit.account.id, { dueDay: day });
      setDueEdit(null);
    } catch (e) {
      Alert.alert('Due date', e.message);
    }
  };

  const ov = accountsOverview(accounts);
  const g = groupAccounts(accounts);
  const byId = Object.fromEntries(accounts.map((a) => [String(a.id), a]));

  const warnButton = (label, onPress, a11y) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={[styles.warnBtn, { backgroundColor: t.warnBg, borderColor: t.warnBorder }]}
    >
      <Text style={{ color: t.warnText, fontFamily: fonts.semibold, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );

  // The row and its right-hand action are sibling buttons (never nested).
  const row = (a, { sub, right, iconName, tone = 'primary', last }) => (
    <View key={a.id} style={[styles.row, { borderColor: t.divider, borderBottomWidth: last ? 0 : 1 }]}>
      <Pressable
        testID={`account-${a.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${shortAccountName(a.name, a.last4)}, ${sub || a.type}`}
        accessibilityHint="Opens the account. Long-press for more."
        onPress={() => navigation.navigate('EditAsset', { asset: a })}
        onLongPress={() => handleLongPress(a)}
        delayLongPress={500}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
      >
        <View
          style={[
            styles.badge,
            {
              backgroundColor: tone === 'danger' ? t.dangerBg : tone === 'income' ? '#E6F4EC' : t.primarySoft,
            },
          ]}
        >
          {iconName ? (
            <Ionicons
              name={iconName}
              size={22}
              color={tone === 'danger' ? t.dangerText : tone === 'income' ? t.income : t.primary}
            />
          ) : (
            <Text style={{ color: t.dangerText, fontFamily: fonts.bold, fontSize: 15 }}>
              {initials(a.name)}
            </Text>
          )}
        </View>
        <View style={{ flex: 1, paddingRight: space.sm }}>
          <Text numberOfLines={1} style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 17 }}>
            {shortAccountName(a.name, a.last4)}
          </Text>
          {sub ? (
            <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14, marginTop: 2 }}>{sub}</Text>
          ) : null}
          {priceStatusLabel(a) ? (
            <Text style={{ color: t.warnText, fontFamily: fonts.body, fontSize: 12, marginTop: 2 }}>
              {priceStatusLabel(a)}
            </Text>
          ) : null}
          {isWallet(a) ? (
            <View style={{ flexDirection: 'row', marginTop: space.xs }}>
              {needsReconcile(a) ? (
                <Text style={{ color: t.expense, fontFamily: fonts.medium, marginRight: space.md }}>
                  Below zero
                </Text>
              ) : null}
              <Text
                accessibilityRole="button"
                onPress={() => startReconcile(a)}
                style={{ color: t.primary, fontFamily: fonts.semibold, marginRight: space.lg }}
              >
                Reconcile
              </Text>
              <Text
                accessibilityRole="button"
                onPress={() =>
                  navigation.navigate('Expense', {
                    prefill: { amount: '', category: '', accountName: a.name },
                  })
                }
                style={{ color: t.primary, fontFamily: fonts.semibold }}
              >
                Add spend
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      {right}
    </View>
  );

  const amount = (n, color) => (
    <Text style={{ color: color || t.text, fontFamily: fonts.displaySemi, fontSize: 18 }}>
      {formatMoney(Math.round(Number(n) || 0))}
    </Text>
  );

  const card = (children) => (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>{children}</View>
  );

  const empty = accounts.length === 0;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          style={{ flex: 1, color: t.text, fontFamily: fonts.display, fontSize: 30 }}
        >
          Accounts
        </Text>
        <AppButton
          title="Add"
          icon="add"
          style={{ borderRadius: radius.pill, paddingHorizontal: space.lg }}
          onPress={() => navigation.navigate('AddInvestment')}
        />
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} />}
      >
        <View testID="networth-card" style={[styles.nw, { backgroundColor: t.ink }]}>
          <Text style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 15 }}>Net worth</Text>
          <Text
            testID="networth"
            adjustsFontSizeToFit
            numberOfLines={1}
            style={{ color: '#FFFFFF', fontFamily: fonts.display, fontSize: 40, marginTop: space.xs }}
          >
            {formatMoney(ov.netWorth)}
          </Text>
          {ov.missing > 0 ? (
            <Text style={{ color: '#F5D48A', fontFamily: fonts.body, fontSize: 14, marginTop: space.xs }}>
              {ov.missing} balance{ov.missing === 1 ? '' : 's'} missing · set{' '}
              {ov.missing === 1 ? 'it' : 'them'} to see the real figure
            </Text>
          ) : null}
          <View style={styles.threeUp}>
            {[
              ['Cash & bank', ov.cashBank, '#5CC998'],
              ['Investments', ov.investments, '#8AA8FF'],
              ['Owed', ov.owed, '#F08A80'],
            ].map(([label, value, color]) => (
              <View key={label} style={[styles.mini, { backgroundColor: t.inkCard }]}>
                <Text numberOfLines={1} style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 13 }}>
                  {label}
                </Text>
                <Text
                  adjustsFontSizeToFit
                  numberOfLines={1}
                  style={{ color, fontFamily: fonts.display, fontSize: 18, marginTop: 4 }}
                >
                  {formatMoney(Math.round(value))}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {empty ? (
          <Text
            style={{
              color: t.muted,
              fontFamily: fonts.body,
              fontSize: 15,
              lineHeight: 22,
              marginTop: space.lg,
            }}
          >
            No accounts yet. Turn on bank SMS in Settings and they appear for review, or tap Add.
          </Text>
        ) : null}

        {g.banks.length > 0 && (
          <Section title="Bank accounts">
            {card(
              g.banks.map((a, i) =>
                row(a, {
                  sub: [
                    a.subType && a.subType !== a.type ? a.subType : 'Savings',
                    counts[String(a.id)] ? `${counts[String(a.id)]} txns this month` : null,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  last: i === g.banks.length - 1,
                  right: balanceMissing(a)
                    ? warnButton('Set balance', () => promptBalance(a), `Set balance for ${a.name}`)
                    : amount(a.balance),
                })
              )
            )}
          </Section>
        )}

        {g.cards.length > 0 && (
          <Section title="Credit cards">
            {card(
              g.cards.map((a, i) =>
                row(a, {
                  iconName: 'card-outline',
                  tone: i % 2 ? 'primary' : 'danger',
                  sub: Number.isFinite(limits[String(a.id)])
                    ? `Available ${formatMoney(limits[String(a.id)])}`
                    : a.dueDay
                      ? `Due on day ${a.dueDay}`
                      : 'Credit card',
                  last: i === g.cards.length - 1,
                  right: a.dueDay
                    ? amount(a.balance, Number(a.balance) > 0 ? t.expense : t.text)
                    : warnButton(
                        'Set due',
                        () => setDueEdit({ account: a, text: '' }),
                        `Set due date for ${a.name}`
                      ),
                })
              )
            )}
          </Section>
        )}

        {g.wallets.length > 0 && (
          <Section title="Wallets">
            {card(
              g.wallets.map((a, i) => {
                const bank = a.linkedBankId != null ? byId[String(a.linkedBankId)] : null;
                return row(a, {
                  iconName: a.type === 'Cash' ? 'cash-outline' : 'wallet-outline',
                  tone: 'income',
                  sub: bank
                    ? `Topped up from ${shortAccountName(bank.name, bank.last4)}`
                    : a.type === 'Cash'
                      ? 'Cash'
                      : a.subType,
                  last: i === g.wallets.length - 1,
                  right: balanceMissing(a)
                    ? warnButton('Set balance', () => promptBalance(a), `Set balance for ${a.name}`)
                    : amount(a.balance),
                });
              })
            )}
          </Section>
        )}

        {g.loans.length > 0 && (
          <Section title="Loans">
            {card(
              g.loans.map((a, i) =>
                row(a, {
                  iconName: 'document-text-outline',
                  tone: 'danger',
                  sub:
                    [a.loanType, a.interestRate ? `${a.interestRate}%` : null].filter(Boolean).join(' · ') ||
                    'Loan',
                  last: i === g.loans.length - 1,
                  right: amount(a.balance, t.expense),
                })
              )
            )}
          </Section>
        )}

        <View style={{ marginTop: space.lg }}>
          <Collapsible
            testID="investments"
            title="Investments"
            summary={investmentsSummary(g.investments)}
            left={
              <View style={[styles.badge, { backgroundColor: t.primarySoft, marginRight: 0 }]}>
                <Ionicons name="trending-up-outline" size={22} color={t.primary} />
              </View>
            }
            badge={g.investments.length ? formatMoney(Math.round(ov.investments)) : null}
          >
            {g.investments.map((a) =>
              row(a, {
                iconName: a.type === 'Provident Fund' ? 'shield-checkmark-outline' : 'trending-up-outline',
                sub: [a.subType || a.type, a.interestRate ? `${a.interestRate}%` : null]
                  .filter(Boolean)
                  .join(' · '),
                right: amount(a.balance),
              })
            )}
            {INVESTMENT_KINDS.map((k) => (
              <View key={k.key} style={[styles.row, { borderColor: t.divider }]}>
                <Ionicons name={k.icon} size={22} color={t.muted} style={{ marginRight: space.md }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 16 }}>{k.title}</Text>
                  <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }}>{k.note}</Text>
                </View>
                <AppButton
                  title="Add"
                  size="sm"
                  variant="secondary"
                  accessibilityLabel={`Add ${k.title}`}
                  onPress={() => navigation.navigate('AddInvestment', { kind: k.key })}
                />
              </View>
            ))}
            <Text style={[type.meta, { color: t.muted, fontSize: 13, lineHeight: 19, marginTop: space.md }]}>
              Net worth counts only accounts added here; nothing is created from SMS. Mutual funds use the
              daily NAV, stocks and gold the price when you pull to refresh. PF, FD and RD add interest daily
              (FD/RD stop at maturity, with a reminder 7 days before). Loans recompute what is owed. A SIP
              debit becomes a transfer here when the investment’s platform (Groww, Zerodha…) is set.
            </Text>
            <AppButton
              title="Money calculators"
              variant="secondary"
              size="sm"
              icon="calculator-outline"
              style={{ marginTop: space.md }}
              onPress={() => navigation.navigate('MoneyTool', { tab: 'Wealth' })}
            />
          </Collapsible>
        </View>
      </ScrollView>

      <Modal visible={!!reconcile} transparent animationType="fade" onRequestClose={() => setReconcile(null)}>
        <View style={styles.backdrop}>
          <View style={[styles.modal, { backgroundColor: t.card }]}>
            <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 20 }}>Reconcile wallet</Text>
            <Text
              style={{ color: t.muted, fontFamily: fonts.body, marginTop: space.xs, marginBottom: space.md }}
            >
              {reconcile?.account?.name}: tracked {formatMoney(reconcile?.account?.balance || 0)}. Enter the
              balance your UPI app shows.
            </Text>
            <TextInput
              accessibilityLabel="Balance in the app"
              style={[styles.input, { borderColor: t.inputBorder, color: t.text }]}
              value={reconcile?.text ?? ''}
              onChangeText={(v) => setReconcile((prev) => ({ ...prev, text: v }))}
              keyboardType="numeric"
              placeholder="Balance in the app"
              placeholderTextColor={t.placeholder}
              autoFocus
            />
            <TextInput
              accessibilityLabel="Category for unrecorded spends"
              style={[styles.input, { borderColor: t.inputBorder, color: t.text, marginTop: space.sm }]}
              value={reconcile?.category ?? ''}
              onChangeText={(v) => setReconcile((prev) => ({ ...prev, category: v }))}
              placeholder="Category for unrecorded spends (optional)"
              placeholderTextColor={t.placeholder}
            />
            <View style={styles.modalActions}>
              <AppButton
                title="Cancel"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => setReconcile(null)}
              />
              <AppButton title="Continue" style={{ flex: 1 }} onPress={submitReconcile} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!balanceEdit}
        transparent
        animationType="fade"
        onRequestClose={() => setBalanceEdit(null)}
      >
        <View style={styles.backdrop}>
          <View style={[styles.modal, { backgroundColor: t.card }]}>
            <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 20 }}>Set balance</Text>
            <Text
              style={{ color: t.muted, fontFamily: fonts.body, marginTop: space.xs, marginBottom: space.md }}
            >
              {balanceEdit?.account?.name}: the balance your bank app shows today.
            </Text>
            <TextInput
              testID="balance-input"
              accessibilityLabel="Balance"
              style={[styles.input, { borderColor: t.inputBorder, color: t.text }]}
              value={balanceEdit?.text ?? ''}
              onChangeText={(v) => setBalanceEdit((prev) => ({ ...prev, text: v }))}
              keyboardType="numeric"
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.modalActions}>
              <AppButton
                title="Cancel"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => setBalanceEdit(null)}
              />
              <AppButton title="Save" style={{ flex: 1 }} onPress={saveBalance} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!dueEdit} transparent animationType="fade" onRequestClose={() => setDueEdit(null)}>
        <View style={styles.backdrop}>
          <View style={[styles.modal, { backgroundColor: t.card }]}>
            <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 20 }}>Card due date</Text>
            <Text
              style={{ color: t.muted, fontFamily: fonts.body, marginTop: space.xs, marginBottom: space.md }}
            >
              Day of the month the {dueEdit?.account?.name} bill is due (1–31). You get a reminder that
              morning for the next 12 months.
            </Text>
            <TextInput
              testID="due-input"
              accessibilityLabel="Due day"
              style={[styles.input, { borderColor: t.inputBorder, color: t.text }]}
              value={dueEdit?.text ?? ''}
              onChangeText={(v) => setDueEdit((prev) => ({ ...prev, text: v }))}
              keyboardType="number-pad"
              autoFocus
            />
            <View style={styles.modalActions}>
              <AppButton
                title="Cancel"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => setDueEdit(null)}
              />
              <AppButton title="Save" style={{ flex: 1 }} onPress={saveDue} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  nw: { borderRadius: radius.xxl, padding: space.xl },
  threeUp: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  mini: { flex: 1, borderRadius: radius.md, padding: space.md },
  card: { borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: space.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    paddingVertical: space.md,
    borderBottomWidth: 1,
  },
  badge: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.md,
  },
  warnBtn: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(14,23,38,0.45)', justifyContent: 'center', padding: space.xxl },
  modal: { borderRadius: radius.xl, padding: space.xl },
  input: { borderWidth: 1, borderRadius: radius.md, padding: space.md, fontSize: 18, fontFamily: fonts.body },
  modalActions: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
});
