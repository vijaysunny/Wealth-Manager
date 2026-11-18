import { Text, View, TouchableOpacity, SafeAreaView } from '../components/Theme';
import { getMonthlyBudget } from '../utils/MonthlyBudgets';
import { getAll } from '../data/TransactionRepo';
import React, { useState, useCallback } from 'react';
import { StyleSheet, Button, FlatList, Modal } from 'react-native';
import AsyncStorage from '../data/Storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getCategoryIcon } from '../utils/icons';
import { isReportable } from '../utils/BalanceService';
import { parseAmount, shiftMonth, formatMoney } from '../utils/Format';
export default function AllTransactionsScreen({ navigation }) {
  const [transactions, setTransactions] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [monthlyStats, setMonthlyStats] = useState([]);
  const [currentMonthSummary, setCurrentMonthSummary] = useState({
    spent: 0,
    budget: 0,
    income: 0,
  });
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState('This Month'); // 'This Month', 'Last 3 Months', 'All Time'

  // --- HELPER: Format Currency Compact (1.2k, 1.5L) ---
  const formatCompact = (num) => {
    if (num >= 100000) return (num / 100000).toFixed(1) + 'L';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  // --- HELPER: Calculate Safe to Spend ---
  const getSafeToSpend = () => {
    const today = new Date();
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const daysLeft = lastDay - today.getDate();
    if (!(currentMonthSummary.budget > 0)) return null; // no budget set
    const remaining = currentMonthSummary.budget - currentMonthSummary.spent;
    if (remaining <= 0) return 0;
    return Math.round(remaining / (daysLeft || 1));
  };
  const renderHeader = () => {
    const hasBudget = currentMonthSummary.budget > 0;
    const percent = hasBudget
      ? Math.min(100, Math.round((currentMonthSummary.spent / currentMonthSummary.budget) * 100))
      : null;
    const safeSpend = getSafeToSpend();
    return (
      <View style={styles.headerContainer}>
        {/* BAR CHART ROW */}
        <View style={styles.chartRow}>
          {monthlyStats.map((item, index) => {
            // Find max for scaling
            const maxVal = Math.max(...monthlyStats.map((s) => s.amount)) || 1;
            const barHeight = (item.amount / maxVal) * 60; // Max height 60
            return (
              <View key={index} style={styles.barContainer}>
                <Text style={styles.barLabelTop}>{formatCompact(item.amount)}</Text>
                <View
                  style={[
                    styles.bar,
                    {
                      height: Math.max(4, barHeight),
                      backgroundColor: item.active ? '#4361EE' : '#E0E7FF',
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.barLabelBottom,
                    item.active && {
                      color: '#4361EE',
                      fontWeight: 'bold',
                    },
                  ]}
                >
                  {item.month}
                </Text>
              </View>
            );
          })}
        </View>

        {/* TABS (Visual Only for now) */}
        <View style={styles.tabRow}>
          <View style={styles.activeTab}>
            <Text style={styles.activeTabText}>Transactions</Text>
          </View>
        </View>

        {/* CIRCULAR SUMMARY */}
        <View style={styles.circleContainer}>
          <View style={styles.circleOuter}>
            <View style={styles.circleInner}>
              <Ionicons name="arrow-up" size={16} color="#555" />
              <Text style={styles.mainAmount}>{formatMoney(Math.round(currentMonthSummary.spent))}</Text>
              <View style={styles.percentBadge}>
                <Ionicons name="speedometer-outline" size={12} color="#4361EE" />
                <Text style={styles.percentText}>{hasBudget ? `${percent}%` : 'No budget'}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* STATS ROW */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Income</Text>
            <Text style={styles.statValue}>₹{formatCompact(currentMonthSummary.income)}</Text>
          </View>
          <View style={styles.verticalLine} />
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Budget</Text>
            <Text style={styles.statValue}>
              {hasBudget ? `₹${formatCompact(currentMonthSummary.budget)}` : 'Not set'}
            </Text>
          </View>
          <View style={styles.verticalLine} />
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Safe to spend</Text>
            <Text style={styles.statValue}>
              {safeSpend === null ? '—' : `₹${formatCompact(safeSpend)}/day`}
            </Text>
          </View>
        </View>
      </View>
    );
  };
  const renderItem = ({ item }) => {
    const date = new Date(item.fullDate);
    const today = new Date();
    const isToday = date.getDate() === today.getDate() && date.getMonth() === today.getMonth();
    const timeStr = date.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const dateStr = isToday
      ? `Today, ${timeStr}`
      : `${date.getDate()} ${date.toLocaleString('en-IN', {
          month: 'short',
        })}`;

    // Icon Logic
    const iconData = getCategoryIcon(item.category);
    // Initials for avatar
    const initial = item.title ? item.title.charAt(0).toUpperCase() : '?';
    return (
      <TouchableOpacity
        style={styles.txRow}
        onPress={() =>
          navigation.navigate('EditTransaction', {
            transaction: item,
          })
        }
      >
        {/* Avatar / Icon */}
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: iconData.color + '20',
            },
          ]}
        >
          {item.customIcon ? (
            <Ionicons name={item.customIcon} size={20} color={iconData.color} />
          ) : (
            <Text
              style={[
                styles.avatarText,
                {
                  color: iconData.color,
                },
              ]}
            >
              {initial}
            </Text>
          )}
        </View>

        {/* Details */}
        <View style={styles.txDetails}>
          <Text style={styles.txTitle} numberOfLines={1}>
            {item.title}
          </Text>
          {item.tags && item.tags.length > 0 && (
            <View
              style={{
                flexDirection: 'row',
              }}
            >
              <View style={styles.miniTag}>
                <Text style={styles.miniTagText}>{item.tags[0]}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Amount */}
        <View
          style={{
            alignItems: 'flex-end',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <Text style={styles.txAmount}>{formatMoney(item.amount)}</Text>
            <Ionicons
              name={item.type === 'income' ? 'arrow-down-circle' : 'arrow-up-circle'}
              size={14}
              color={item.type === 'income' ? '#4CAF50' : '#757575'}
              style={{
                marginLeft: 4,
              }}
            />
          </View>
          <Text style={styles.txDate}>{dateStr}</Text>
        </View>
      </TouchableOpacity>
    );
  };
  const applyFilter = useCallback((filterType, allTxs, budgetLimit) => {
    setSelectedFilter(filterType);
    const now = new Date();
    let filtered = [];
    let spent = 0;
    let income = 0;
    if (filterType === 'This Month') {
      filtered = allTxs.filter((t) => {
        const d = new Date(t.fullDate);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      });
    } else if (filterType === 'Last 3 Months') {
      const past = shiftMonth(now, -3);
      const daysInPastMonth = new Date(past.getFullYear(), past.getMonth() + 1, 0).getDate();
      past.setDate(Math.min(now.getDate(), daysInPastMonth)); // clamp: 31 May - 3 months = 28/29 Feb
      past.setHours(0, 0, 0, 0);
      filtered = allTxs.filter((t) => new Date(t.fullDate) >= past);
    } else {
      filtered = allTxs;
    }

    // Calculate Totals for Summary (the list still shows excluded rows; totals skip them)
    filtered.filter(isReportable).forEach((t) => {
      if (t.type === 'expense') spent += t.amount;
      else if (t.type === 'income') income += t.amount;
    });
    setFilteredData(filtered);
    setCurrentMonthSummary({
      spent,
      income,
      budget: budgetLimit,
    });
    setFilterModalVisible(false);
  }, []);
  const loadData = useCallback(async () => {
    const txJson = JSON.stringify(await getAll());
    const budgetJson = await AsyncStorage.getItem('user_budget_limit'); // Overall monthly budget
    let budgetLimit = parseAmount(budgetJson) || 0; // 0 = no budget set (no invented default)

    let txs = txJson ? JSON.parse(txJson) : [];
    budgetLimit = (await getMonthlyBudget(new Date(), txs)).effectiveLimit;

    // Sort Newest First
    txs.sort((a, b) => new Date(b.fullDate) - new Date(a.fullDate));
    setTransactions(txs);

    // 1. Calculate Monthly Stats for Bar Chart (Last 6 Months)
    const stats = [];
    const today = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const monthName = d.toLocaleString('en-IN', {
        month: 'short',
      });
      const total = txs
        .filter((t) => {
          const td = new Date(t.fullDate);
          return (
            isReportable(t) &&
            t.type === 'expense' &&
            td.getMonth() === d.getMonth() &&
            td.getFullYear() === d.getFullYear()
          );
        })
        .reduce((acc, curr) => acc + curr.amount, 0);
      stats.push({
        month: monthName,
        amount: total,
        active: i === 0,
      });
    }
    setMonthlyStats(stats);

    // 2. Initial Filter (Default to This Month)
    applyFilter('This Month', txs, budgetLimit);
  }, [applyFilter]);
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );
  return (
    <SafeAreaView style={styles.container}>
      <Button
        title="Search, filters, export and bulk actions"
        onPress={() =>
          navigation.navigate('Tools', {
            tab: 'History',
          })
        }
      />

      {/* TOP HEADER */}
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <View>
          <Text style={styles.navTitle}>All transactions</Text>
          <Text style={styles.navSub}>
            {selectedFilter} <Ionicons name="caret-down" size={10} />
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
          }}
        >
          <TouchableOpacity onPress={() => setFilterModalVisible(true)} style={styles.iconBtn}>
            <Ionicons name="filter" size={20} color="#333" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() =>
              navigation.navigate('Tools', {
                tab: 'History',
              })
            }
            style={[
              styles.iconBtn,
              {
                marginLeft: 10,
              },
            ]}
          >
            <Ionicons name="document-text-outline" size={20} color="#333" />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={filteredData}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={{
          paddingBottom: 20,
        }}
        showsVerticalScrollIndicator={false}
      />

      {/* FILTER MODAL */}
      <Modal visible={filterModalVisible} transparent animationType="slide">
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setFilterModalVisible(false)}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filter</Text>
            </View>

            {['This Month', 'Last 3 Months', 'All Time'].map((opt) => (
              <TouchableOpacity
                key={opt}
                style={styles.radioRow}
                onPress={() => applyFilter(opt, transactions, currentMonthSummary.budget)}
              >
                <Ionicons
                  name={selectedFilter === opt ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={selectedFilter === opt ? '#4361EE' : '#666'}
                />
                <Text style={styles.radioText}>{opt}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={styles.closeBtn} onPress={() => setFilterModalVisible(false)}>
              <Text
                style={{
                  color: '#fff',
                  fontWeight: 'bold',
                }}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  // NAVBAR
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#fff',
  },
  navTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  navSub: {
    fontSize: 12,
    color: '#666',
  },
  iconBtn: {
    padding: 5,
    backgroundColor: '#F0F0F0',
    borderRadius: 8,
  },
  // HEADER CONTAINER
  headerContainer: {
    backgroundColor: '#F8F9FA',
    paddingBottom: 20,
  },
  // CHART
  chartRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 20,
    height: 90,
    alignItems: 'flex-end',
  },
  barContainer: {
    alignItems: 'center',
    width: 30,
  },
  bar: {
    width: 8,
    borderRadius: 4,
    backgroundColor: '#E0E7FF',
  },
  barLabelTop: {
    fontSize: 9,
    color: '#666',
    marginBottom: 4,
  },
  barLabelBottom: {
    fontSize: 10,
    color: '#999',
    marginTop: 6,
  },
  // TABS
  tabRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 20,
    marginHorizontal: 20,
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#4CAF50',
    paddingBottom: 5,
  },
  activeTabText: {
    color: '#4CAF50',
    fontWeight: 'bold',
  },
  inactiveTabText: {
    color: '#999',
    fontWeight: 'bold',
  },
  // CIRCLE SUMMARY
  circleContainer: {
    alignItems: 'center',
    marginTop: 30,
  },
  circleOuter: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 8,
    borderColor: '#E0E7FF',
    justifyContent: 'center',
    alignItems: 'center',
    borderTopColor: '#4361EE',
    borderRightColor: '#4361EE',
  },
  // Simple partial arc simulation
  circleInner: {
    alignItems: 'center',
  },
  mainAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginVertical: 5,
  },
  percentBadge: {
    flexDirection: 'row',
    backgroundColor: '#E0E7FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignItems: 'center',
  },
  percentText: {
    fontSize: 12,
    color: '#4361EE',
    fontWeight: 'bold',
    marginLeft: 4,
  },
  // STATS ROW
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    marginTop: 30,
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 12,
    elevation: 2,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    fontSize: 11,
    color: '#999',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  verticalLine: {
    width: 1,
    backgroundColor: '#eee',
    height: '80%',
  },
  // TRANSACTION LIST
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#fff',
    marginHorizontal: 15,
    marginTop: 10,
    borderRadius: 12,
    elevation: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontWeight: 'bold',
    fontSize: 16,
  },
  txDetails: {
    flex: 1,
  },
  txTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  miniTag: {
    backgroundColor: '#F0F0F0',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  miniTagText: {
    fontSize: 10,
    color: '#666',
    fontWeight: '600',
  },
  txAmount: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#333',
  },
  txDate: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
    textAlign: 'right',
  },
  // MODAL
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderColor: '#f0f0f0',
  },
  radioText: {
    marginLeft: 10,
    fontSize: 16,
    color: '#333',
  },
  closeBtn: {
    marginTop: 20,
    backgroundColor: '#333',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
});
