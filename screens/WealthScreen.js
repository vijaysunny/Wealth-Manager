import AsyncStorage, { updateAccount as persistAccount } from '../data/Storage';
import { deleteAccount as removeAccount } from '../data/Collections';
import { Text, View, ScrollView, TouchableOpacity, TextInput, SafeAreaView } from '../components/Theme';
import React, { useState, useCallback } from 'react';
import { StyleSheet, RefreshControl, Alert, Modal } from 'react-native';
import AppButton from '../components/ui/AppButton';

import { Ionicons } from '@expo/vector-icons';
import { fetchMutualFundNAV, fetchStockPrice } from '../utils/InvestmentApi';
import { calculateOutstandingBalance } from '../utils/LoanCalculator'; // <--- Import Calculator
import { useFocusEffect } from '@react-navigation/native';
import { computeNetWorth, isWallet } from '../utils/BalanceService';
import { computeReconcile, needsReconcile } from '../utils/WalletReconcile';
import { reconcileWallet } from '../utils/FeatureService';
import { formatMoney } from '../utils/Format';
import { priceStatusLabel } from '../utils/PriceStatus';

export default function WealthScreen({ navigation }) {
  const [data, setData] = useState({ banks: [], pf: [], liabilities: [], investments: [] });
  const [totals, setTotals] = useState({ netWorth: 0, assets: 0, debt: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [balanceEdit, setBalanceEdit] = useState(null); // { account, text }
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

    // --- CATEGORIZATION & TOTALS ---
    const pf = accounts.filter((a) => a.type === 'Provident Fund');
    const loans = accounts.filter((a) => a.type === 'Loan' || a.type === 'Credit Card');
    const banks = accounts.filter((a) => a.type === 'Bank Account');
    // "Cash & wallets" (A6): cash plus UPI Lite / Paytm Wallet / FASTag ... with their linked bank
    const wallets = accounts
      .filter((a) => a.type === 'Cash' || isWallet(a))
      .map((a) => ({
        ...a,
        linkedBankName: accounts.find((b) => String(b.id) === String(a.linkedBankId))?.name,
      }));
    // Investments: Everything else (Mutual Funds, Stocks, Gold, Real Estate)
    const inv = accounts.filter(
      (a) => !['Provident Fund', 'Loan', 'Credit Card', 'Bank Account', 'Cash', 'Wallet'].includes(a.type)
    );

    const nw = computeNetWorth(accounts);

    setData({ banks, wallets, pf, liabilities: loans, investments: inv });
    setTotals({ netWorth: nw.netWorth, assets: nw.assets, debt: nw.liabilities });
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
  const renderItem = (item, isDebt) => (
    <TouchableOpacity
      key={item.id}
      style={styles.row}
      onPress={() => navigation.navigate('EditAsset', { asset: item })} // <--- Add Navigation
      onLongPress={() => handleLongPress(item)}
      delayLongPress={500}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
        <View style={[styles.iconBox, { backgroundColor: isDebt ? '#FFEBEE' : '#E8F5E9' }]}>
          <Ionicons
            name={
              item.type === 'Loan'
                ? 'document-text'
                : item.type === 'Provident Fund'
                  ? 'shield-checkmark'
                  : 'wallet'
            }
            size={18}
            color={isDebt ? '#D32F2F' : '#2E7D32'}
          />
        </View>
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text style={styles.name}>{item.name}</Text>
          {item.type === 'Loan' ? (
            <Text style={styles.sub}>
              {item.loanType} • {item.interestRate}%
            </Text>
          ) : (
            <Text style={styles.sub}>
              {item.subType || item.type} {item.interestRate ? `• ${item.interestRate}%` : ''}
              {item.provider ? ` • ${item.provider}` : ''}
              {item.linkedBankName ? ` • from ${item.linkedBankName}` : ''}
            </Text>
          )}
          {!!priceStatusLabel(item) && (
            <Text style={{ fontSize: 11, color: '#E65100' }}>{priceStatusLabel(item)}</Text>
          )}
          {isWallet(item) && (
            <View style={{ flexDirection: 'row', marginTop: 4 }}>
              {needsReconcile(item) && (
                <Text style={{ color: '#C62828', marginRight: 12 }}>Below zero - reconcile</Text>
              )}
              <TouchableOpacity onPress={() => startReconcile(item)} style={{ marginRight: 16 }}>
                <Text style={{ color: '#1976D2', fontWeight: '600' }}>Reconcile</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate('Expense', {
                    prefill: { amount: '', category: '', accountName: item.name },
                  })
                }
              >
                <Text style={{ color: '#1976D2', fontWeight: '600' }}>Add spend</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.bal, { color: isDebt ? '#D32F2F' : '#333' }]}>
          ₹ {Math.round(parseFloat(item.balance)).toLocaleString('en-IN')}
        </Text>
        {item.type === 'Loan' && <Text style={{ fontSize: 10, color: '#999' }}>Outstanding</Text>}
        {item.type === 'Provident Fund' && <Text style={{ fontSize: 10, color: '#4CAF50' }}>+ Interest</Text>}
      </View>
    </TouchableOpacity> // <--- Close TouchableOpacity
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* HEADER */}
      <AppButton
        title="Wealth calculations"
        onPress={() => navigation.navigate('Tools', { tab: 'Wealth' })}
      />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Net Worth</Text>
        <TouchableOpacity onPress={() => navigation.navigate('AddAsset')}>
          <Ionicons name="add-circle" size={32} color="#2196F3" />
        </TouchableOpacity>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} />}
      >
        {/* NET WORTH CARD */}
        <View style={styles.nwCard}>
          <Text style={{ color: '#BBDEFB', fontSize: 12, fontWeight: 'bold' }}>NET WORTH</Text>
          <Text style={{ color: '#fff', fontSize: 32, fontWeight: 'bold', marginVertical: 5 }}>
            ₹ {totals.netWorth.toLocaleString('en-IN')}
          </Text>
          <View style={{ flexDirection: 'row', marginTop: 10 }}>
            <View style={{ marginRight: 20 }}>
              <Text style={{ color: '#A5D6A7', fontSize: 12 }}>Assets</Text>
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>
                ₹ {totals.assets.toLocaleString('en-IN')}
              </Text>
            </View>
            <View>
              <Text style={{ color: '#EF9A9A', fontSize: 12 }}>Liabilities</Text>
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>
                ₹ {totals.debt.toLocaleString('en-IN')}
              </Text>
            </View>
          </View>
        </View>

        {/* SECTIONS */}
        {data.pf.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.secTitle}>Provident Fund</Text>
            <View style={styles.card}>{data.pf.map((i) => renderItem(i, false))}</View>
          </View>
        )}

        {data.investments.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.secTitle}>Investments</Text>
            <View style={styles.card}>{data.investments.map((i) => renderItem(i, false))}</View>
          </View>
        )}

        {data.banks.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.secTitle}>Bank accounts</Text>
            <View style={styles.card}>{data.banks.map((i) => renderItem(i, false))}</View>
          </View>
        )}

        {(data.wallets || []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.secTitle}>Cash & wallets</Text>
            <View style={styles.card}>{data.wallets.map((i) => renderItem(i, false))}</View>
          </View>
        )}

        {data.liabilities.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.secTitle}>Loans & Liabilities</Text>
            <View style={styles.card}>{data.liabilities.map((i) => renderItem(i, true))}</View>
          </View>
        )}

        {/* EMPTY STATE */}
        {totals.assets === 0 && totals.debt === 0 && (
          <View style={{ alignItems: 'center', marginTop: 50 }}>
            <Text style={{ color: '#999' }}>No assets found.</Text>
            <TouchableOpacity onPress={() => navigation.navigate('AddAsset')}>
              <Text style={{ color: '#2196F3', fontWeight: 'bold', marginTop: 10 }}>
                + Add your first asset
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 30 }} />
      </ScrollView>

      {/* UPDATE BALANCE MODAL */}
      <Modal visible={!!reconcile} transparent animationType="fade" onRequestClose={() => setReconcile(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reconcile wallet</Text>
            <Text style={styles.modalSub}>
              {reconcile?.account?.name}: tracked {formatMoney(reconcile?.account?.balance || 0)}. Enter the
              balance your UPI app shows.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={reconcile?.text ?? ''}
              onChangeText={(t) => setReconcile((prev) => ({ ...prev, text: t }))}
              keyboardType="numeric"
              placeholder="Balance in the app"
              autoFocus
            />
            <TextInput
              style={styles.modalInput}
              value={reconcile?.category ?? ''}
              onChangeText={(t) => setReconcile((prev) => ({ ...prev, category: t }))}
              placeholder="Category for unrecorded spends (optional)"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setReconcile(null)} style={styles.modalBtn}>
                <Text style={{ color: '#666', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitReconcile} style={styles.modalBtn}>
                <Text style={{ color: '#1976D2', fontWeight: '600' }}>Continue</Text>
              </TouchableOpacity>
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
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Balance</Text>
            <Text style={styles.modalSub}>{balanceEdit?.account?.name}</Text>
            <TextInput
              style={styles.modalInput}
              value={balanceEdit?.text ?? ''}
              onChangeText={(t) => setBalanceEdit((prev) => ({ ...prev, text: t }))}
              keyboardType="numeric"
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setBalanceEdit(null)} style={styles.modalBtn}>
                <Text style={{ color: '#666', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveBalance} style={styles.modalBtn}>
                <Text style={{ color: '#2196F3', fontWeight: 'bold' }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#333' },
  nwCard: { margin: 20, padding: 20, backgroundColor: '#1565C0', borderRadius: 15, elevation: 3 },
  section: { marginHorizontal: 20, marginBottom: 20 },
  secTitle: { marginBottom: 10, fontWeight: 'bold', color: '#666', fontSize: 12, textTransform: 'uppercase' },
  card: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    padding: 15,
    borderBottomWidth: 1,
    borderColor: '#f0f0f0',
    alignItems: 'center',
  },
  iconBox: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  name: { fontWeight: '600', fontSize: 15, color: '#333' },
  sub: { fontSize: 11, color: '#999', marginTop: 2 },
  bal: { fontWeight: 'bold', fontSize: 16 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 30 },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  modalSub: { fontSize: 12, color: '#999', marginTop: 2, marginBottom: 12 },
  modalInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, fontSize: 18 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 },
  modalBtn: { paddingVertical: 8, paddingHorizontal: 16 },
});
