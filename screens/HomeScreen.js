import { Text, View, ScrollView, TouchableOpacity, SafeAreaView } from '../components/Theme';
import { getAll } from '../data/TransactionRepo';
/**
 * HomeScreen.js  — v3.0
 * Enhancements:
 *   • Shows income + savings alongside expenses
 *   • Quick shortcuts: Import, Recurring, Savings
 *   • Net balance card instead of expense-only view
 *   • Preview captured payments before importing
 */

import React, { useState, useCallback } from 'react';
import { StyleSheet, Alert, ActivityIndicator, Modal, FlatList, Platform, Linking } from 'react-native';
import AsyncStorage from '../data/Storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { scanBankSms, requestSmsPermission } from '../components/RealSmsReader';
import { getCategoryIcon } from '../utils/icons';
import { saveWithDedup, createDedupIndex } from '../utils/DeduplicationEngine';
import { computeNetWorth, isReportable } from '../utils/BalanceService';
import { shiftMonth } from '../utils/Format';
import { backupStatus, LAST_BACKUP_KEY } from '../utils/BackupReminder';
import { permissionWarnings } from '../utils/PermissionHealth';
import { hasReceivePermission, isTrackingEnabled } from '../utils/SmsTracking';
import { notificationsAllowed } from '../utils/NotificationService';
import { discoverAccounts, waitingCount } from '../utils/AccountDiscovery';
export default function HomeScreen({ navigation }) {
  const [transactions, setTransactions] = useState([]);
  const discovered = React.useMemo(() => discoverAccounts(transactions), [transactions]);
  const [summary, setSummary] = useState({
    income: 0,
    expense: 0,
    savings: 0,
  });
  const [loading, setLoading] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [scannedTransactions, setScannedTransactions] = useState([]);
  const [userName, setUserName] = useState('');
  const [netWorth, setNetWorth] = useState(0);
  const [backup, setBackup] = useState(null);
  const [permWarnings, setPermWarnings] = useState([]);
  const changeMonth = (direction) => {
    setCurrentDate(shiftMonth(currentDate, direction));
  };
  const handleManualScan = async () => {
    const perm = await requestSmsPermission();
    if (!perm.granted) {
      Alert.alert(
        'Permission needed',
        perm.blocked
          ? 'Android blocked SMS access for this app. Open Settings in the app for the steps.'
          : 'Allow SMS access to scan your bank messages.'
      );
      return;
    }
    setLoading(true);
    const minDate = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const scan = await scanBankSms(minDate);
    if (!scan.ok) {
      setLoading(false);
      Alert.alert('Scan failed', 'Could not read SMS messages. Check the SMS permission and try again.');
      return;
    }
    const foundSms = scan.items;
    if (foundSms.length === 0) {
      setLoading(false);
      Alert.alert('Up to Date', 'No relevant bank SMS found.');
      return;
    }
    const txJson = JSON.stringify(await getAll());
    const existingTx = txJson ? JSON.parse(txJson) : [];
    const newItems = [];
    const dedup = createDedupIndex(existingTx); // built once per scan

    foundSms.forEach((sms) => {
      if (!sms.amount) return;
      const item = {
        id: Date.now() + Math.random(),
        smsId: sms.smsId,
        bodyHash: sms.bodyHash,
        refNo: sms.refNo,
        title: sms.category,
        amount: parseFloat(sms.amount),
        type: sms.type,
        date: new Date(sms.date).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
        category: sms.category,
        account: sms.bankName !== 'Unknown Bank' ? sms.bankName : 'Cash',
        tags: ['Auto-Sync'],
        fullDate: new Date(sms.date).toISOString(),
        extractedBalance: sms.currentBalance ? parseFloat(sms.currentBalance) : null,
        ...(sms.captured || {}),
      };
      if (!dedup.check(item)) newItems.push(item);
    });
    setLoading(false);
    if (newItems.length > 0) {
      newItems.sort((a, b) => new Date(b.fullDate) - new Date(a.fullDate));
      setScannedTransactions(newItems);
      setPreviewModalVisible(true);
    } else {
      Alert.alert('Up to Date', 'No new transactions found.');
    }
  };
  const confirmImport = async () => {
    if (scannedTransactions.length === 0) return;
    const { added, skipped } = await saveWithDedup(scannedTransactions, {
      balanceMode: 'captured',
    });

    // Sync account balances from exactly the rows that were stored (bank balance if the
    // SMS carried one, latest wins; otherwise the transaction is applied as a delta)

    setPreviewModalVisible(false);
    loadData();
    Alert.alert('Done', `Added: ${added} | Skipped (duplicates): ${skipped}`);
  };
  const formattedDate = currentDate.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
  const savingsRate = summary.income > 0 ? Math.round((summary.savings / summary.income) * 100) : 0;
  const calculateMonthlyStats = useCallback(
    (txs) => {
      const tm = currentDate.getMonth();
      const ty = currentDate.getFullYear();
      const monthTxs = txs.filter((t) => {
        if (!isReportable(t)) return false;
        const d = new Date(t.fullDate || t.date);
        return d.getMonth() === tm && d.getFullYear() === ty;
      });
      const income = monthTxs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      const expense = monthTxs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      setSummary({
        income,
        expense,
        savings: income - expense,
      });
    },
    [currentDate]
  );
  const loadData = useCallback(async () => {
    setBackup(backupStatus(await AsyncStorage.getItem(LAST_BACKUP_KEY)));
    setPermWarnings(
      permissionWarnings({
        platform: Platform.OS,
        smsEnabled: await isTrackingEnabled(),
        smsPermission: await hasReceivePermission(),
        notificationsGranted: await notificationsAllowed(),
      })
    );
    const name = await AsyncStorage.getItem('user_name');
    if (name) setUserName(name);
    const txJson = JSON.stringify(await getAll());
    const transactions = txJson ? JSON.parse(txJson) : [];
    transactions.sort((a, b) => new Date(b.fullDate) - new Date(a.fullDate));
    setTransactions(transactions);
    calculateMonthlyStats(transactions);
    const wJson = await AsyncStorage.getItem('user_wealth_accounts');
    const accounts = wJson ? JSON.parse(wJson) : [];
    setNetWorth(computeNetWorth(accounts).netWorth);
  }, [calculateMonthlyStats]);
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={{
          paddingBottom: 20,
        }}
      >
        {permWarnings.map((w) => (
          <TouchableOpacity
            key={w.key}
            onPress={() => Linking.openSettings()}
            style={{
              backgroundColor: '#FFEBEE',
              marginHorizontal: 12,
              marginTop: 12,
              padding: 10,
              borderRadius: 8,
            }}
          >
            <Text style={{ color: '#B71C1C' }}>{w.text} Tap to open settings.</Text>
          </TouchableOpacity>
        ))}
        {backup?.stale && (
          <TouchableOpacity
            onPress={() => navigation.navigate('SettingsTab')}
            style={{ backgroundColor: '#FFF3E0', margin: 12, padding: 10, borderRadius: 8 }}
          >
            <Text style={{ color: '#E65100' }}>
              {backup.label}. Back up now (Settings → Backup) - data lives only on this phone.
            </Text>
          </TouchableOpacity>
        )}
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hello{userName ? `, ${userName}` : ''} 👋</Text>
            <Text style={styles.subGreet}>Track. Save. Grow.</Text>
          </View>
          <View style={styles.netWorthBadge}>
            <Text style={styles.nwLabel}>Net Worth</Text>
            <Text style={styles.nwVal}>
              {netWorth < 0 ? '-' : ''}₹{Math.abs(netWorth / 1000).toFixed(1)}K
            </Text>
          </View>
        </View>

        {/* A2: accounts found in SMS that are not added yet */}
        {discovered.length > 0 && (
          <TouchableOpacity
            testID="review-card"
            accessibilityRole="button"
            accessibilityLabel={`${discovered.length} new accounts found in SMS. Review`}
            onPress={() => navigation.navigate('ReviewAccounts')}
            style={styles.reviewCard}
          >
            <View style={styles.reviewIcon}>
              <Ionicons name="list-outline" size={22} color="#1F4FD8" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.reviewTitle}>
                {discovered.length} new account{discovered.length === 1 ? '' : 's'} found in SMS
              </Text>
              <Text style={styles.reviewSub}>
                {waitingCount(discovered)} transaction{waitingCount(discovered) === 1 ? '' : 's'} waiting ·
                tap to confirm
              </Text>
            </View>
            <View style={styles.reviewBadge}>
              <Text style={styles.reviewBadgeText}>{waitingCount(discovered)}</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Month Nav */}
        <View style={styles.monthNav}>
          <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.arrowBtn}>
            <Ionicons name="chevron-back" size={18} color="#555" />
          </TouchableOpacity>
          <Text style={styles.monthLabel}>{formattedDate}</Text>
          <TouchableOpacity onPress={() => changeMonth(1)} style={styles.arrowBtn}>
            <Ionicons name="chevron-forward" size={18} color="#555" />
          </TouchableOpacity>
        </View>

        {/* Summary Cards */}
        <View style={styles.cardsRow}>
          <View
            style={[
              styles.miniCard,
              {
                backgroundColor: '#E8F5E9',
              },
            ]}
          >
            <Text style={styles.miniLabel}>Income</Text>
            <Text
              style={[
                styles.miniAmt,
                {
                  color: '#388E3C',
                },
              ]}
            >
              ₹{(summary.income / 1000).toFixed(1)}K
            </Text>
          </View>
          <View
            style={[
              styles.miniCard,
              {
                backgroundColor: '#FFEBEE',
              },
            ]}
          >
            <Text style={styles.miniLabel}>Spent</Text>
            <Text
              style={[
                styles.miniAmt,
                {
                  color: '#C62828',
                },
              ]}
            >
              ₹{(summary.expense / 1000).toFixed(1)}K
            </Text>
          </View>
          <View
            style={[
              styles.miniCard,
              {
                backgroundColor: '#E3F2FD',
              },
            ]}
          >
            <Text style={styles.miniLabel}>Saved</Text>
            <Text
              style={[
                styles.miniAmt,
                {
                  color: summary.savings >= 0 ? '#1565C0' : '#C62828',
                },
              ]}
            >
              {savingsRate}%
            </Text>
          </View>
        </View>

        {/* Scan Button */}
        <TouchableOpacity style={styles.syncBtn} onPress={handleManualScan} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons
                name="scan-outline"
                size={18}
                color="#fff"
                style={{
                  marginRight: 8,
                }}
              />
              <Text style={styles.syncText}>Scan Bank SMS</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Action Grid */}
        <View style={styles.actions}>
          {[
            {
              label: 'Income',
              icon: 'arrow-down',
              color: '#4CAF50',
              route: 'Income',
            },
            {
              label: 'Expense',
              icon: 'arrow-up',
              color: '#F44336',
              route: 'Expense',
            },
            {
              label: 'Import',
              icon: 'cloud-upload-outline',
              color: '#2196F3',
              route: 'Import',
            },
            {
              label: 'History',
              icon: 'list',
              color: '#555',
              route: 'Transactions',
            },
            {
              label: 'Reports',
              icon: 'stats-chart',
              color: '#673AB7',
              route: 'Analytics',
            },
            {
              label: 'Savings',
              icon: 'save-outline',
              color: '#00BCD4',
              route: 'Savings',
            },
            {
              label: 'Recurring',
              icon: 'repeat',
              color: '#FF9800',
              route: 'Recurring',
            },
            {
              label: 'Wealth',
              icon: 'wallet-outline',
              color: '#009688',
              route: 'AccountsTab',
            },
          ].map((item) => (
            <TouchableOpacity
              key={item.label}
              style={styles.btn}
              onPress={() => navigation.navigate(item.route)}
            >
              <View
                style={[
                  styles.btnIcon,
                  {
                    backgroundColor: item.color + '20',
                  },
                ]}
              >
                <Ionicons name={item.icon} size={20} color={item.color} />
              </View>
              <Text style={styles.btnText}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Recent */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Transactions')}>
            <Text
              style={{
                color: '#2196F3',
                fontWeight: 'bold',
              }}
            >
              See All
            </Text>
          </TouchableOpacity>
        </View>

        {transactions.slice(0, 8).map((item) => {
          const icon = item.customIcon
            ? {
                name: item.customIcon,
                color: item.customColor,
              }
            : getCategoryIcon(item.category);
          return (
            <TouchableOpacity
              key={item.id}
              style={styles.item}
              onPress={() =>
                navigation.navigate('TransactionDetail', {
                  transaction: item,
                })
              }
            >
              <View
                style={[
                  styles.iconBox,
                  {
                    backgroundColor: icon.color + '20',
                  },
                ]}
              >
                <Ionicons name={icon.name} size={20} color={icon.color} />
              </View>
              <View
                style={{
                  flex: 1,
                }}
              >
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={styles.itemDate}>
                  {item.date} • {item.account}
                </Text>
              </View>
              <Text
                style={{
                  fontWeight: 'bold',
                  color: item.type === 'income' ? '#388E3C' : '#C62828',
                }}
              >
                {item.type === 'income' ? '+' : '-'} ₹{item.amount.toLocaleString('en-IN')}
              </Text>
            </TouchableOpacity>
          );
        })}

        {transactions.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={50} color="#ccc" />
            <Text style={styles.emptyText}>No transactions yet</Text>
            <Text style={styles.emptySubText}>Add manually or scan your bank SMS</Text>
          </View>
        )}
      </ScrollView>

      {/* Preview Modal */}
      <Modal visible={previewModalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Found {scannedTransactions.length} New Items</Text>
            <TouchableOpacity onPress={() => setPreviewModalVisible(false)}>
              <Ionicons name="close-circle" size={30} color="#ccc" />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalSub}>Review and confirm to import. Duplicates will be skipped.</Text>

          <FlatList
            data={scannedTransactions}
            keyExtractor={(item) => item.id.toString()}
            style={{
              flex: 1,
            }}
            contentContainerStyle={{
              paddingBottom: 20,
            }}
            renderItem={({ item }) => (
              <View style={styles.previewItem}>
                <View
                  style={{
                    flex: 1,
                  }}
                >
                  <Text style={styles.previewTitle}>{item.title}</Text>
                  <Text style={styles.previewDate}>
                    {item.date} • {item.account}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.previewAmount,
                    {
                      color: item.type === 'income' ? '#388E3C' : '#C62828',
                    },
                  ]}
                >
                  {item.type === 'income' ? '+' : '-'} ₹{item.amount.toLocaleString('en-IN')}
                </Text>
              </View>
            )}
          />

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setPreviewModalVisible(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn} onPress={confirmImport}>
              <Text style={styles.confirmText}>Import All</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  reviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E3E6EC',
    borderWidth: 1,
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
  },
  reviewIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#E8EEFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  reviewTitle: { color: '#0E1726', fontSize: 16, fontWeight: '700' },
  reviewSub: { color: '#5B6475', fontSize: 14, marginTop: 2 },
  reviewBadge: {
    minWidth: 32,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#1F4FD8',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    marginLeft: 8,
  },
  reviewBadgeText: { color: '#FFFFFF', fontWeight: '700' },
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 12,
  },
  greeting: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1A1A2E',
  },
  subGreet: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  netWorthBadge: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  nwLabel: {
    color: '#aaa',
    fontSize: 10,
  },
  nwVal: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 14,
  },
  arrowBtn: {
    padding: 6,
    backgroundColor: '#fff',
    borderRadius: 20,
    elevation: 1,
  },
  monthLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  cardsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  miniCard: {
    flex: 1,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
  },
  miniLabel: {
    fontSize: 11,
    color: '#666',
    marginBottom: 4,
  },
  miniAmt: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  syncBtn: {
    flexDirection: 'row',
    backgroundColor: '#7E57C2',
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    elevation: 3,
  },
  syncText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
  },
  btn: {
    width: '22%',
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    elevation: 1,
  },
  btnIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  btnText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#1A1A2E',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: '#f0f0f0',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 6,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  itemTitle: {
    fontWeight: '600',
    color: '#333',
    fontSize: 15,
  },
  itemDate: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 18,
    color: '#bbb',
    marginTop: 12,
    fontWeight: '600',
  },
  emptySubText: {
    color: '#ccc',
    fontSize: 13,
    marginTop: 4,
  },
  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20,
    paddingTop: 50,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  modalSub: {
    color: '#666',
    marginBottom: 20,
  },
  previewItem: {
    flexDirection: 'row',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: '#eee',
    alignItems: 'center',
  },
  previewTitle: {
    fontWeight: 'bold',
    fontSize: 15,
    color: '#333',
  },
  previewDate: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  previewAmount: {
    fontWeight: 'bold',
    fontSize: 15,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 20,
  },
  cancelBtn: {
    flex: 1,
    padding: 15,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    marginRight: 10,
    alignItems: 'center',
  },
  confirmBtn: {
    flex: 1,
    padding: 15,
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    marginLeft: 10,
    alignItems: 'center',
  },
  cancelText: {
    fontWeight: 'bold',
    color: '#555',
  },
  confirmText: {
    fontWeight: 'bold',
    color: '#fff',
  },
});
