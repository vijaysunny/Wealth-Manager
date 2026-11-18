import { Text, View, ScrollView, TouchableOpacity, TextInput, SafeAreaView } from '../components/Theme';
import { getAll } from '../data/TransactionRepo';
/**
 * SavingsScreen.js
 * Dedicated savings tracker:
 *   • Shows savings rate month-over-month
 *   • Lets user tag transactions as "savings"
 *   • Visualises savings vs expenses vs income
 *   • Suggests savings targets based on income
 */

import React, { useState, useCallback } from 'react';
import { StyleSheet, Alert, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '../data/Storage';
import { useFocusEffect } from '@react-navigation/native';
import { isReportable } from '../utils/BalanceService';
import { shiftMonth, parseNonNegative } from '../utils/Format';
const COLORS = {
  primary: '#2196F3',
  savings: '#4CAF50',
  expense: '#F44336',
  income: '#2196F3',
  warning: '#FF9800',
  bg: '#F5F7FA',
  card: '#FFFFFF',
  text: '#1A1A2E',
  sub: '#6B7280',
};
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export default function SavingsScreen({ navigation }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [stats, setStats] = useState({
    income: 0,
    expense: 0,
    savings: 0,
    rate: 0,
  });
  const [history, setHistory] = useState([]);
  const [savingsGoalPct, setSavingsGoalPct] = useState(20);
  const [editGoalVisible, setEditGoalVisible] = useState(false);
  const [goalInput, setGoalInput] = useState('20');
  const [savingsAccounts, setSavingsAccounts] = useState([]);
  const saveGoal = async () => {
    const v = parseNonNegative(goalInput);
    if (v === null || v > 100) {
      Alert.alert('Invalid', 'Enter 0–100');
      return;
    }
    setSavingsGoalPct(v);
    await AsyncStorage.setItem('savings_goal_pct', String(v));
    setEditGoalVisible(false);
  };
  const changeMonth = (dir) => {
    setCurrentDate(shiftMonth(currentDate, dir));
  };
  const maxBar = Math.max(...history.map((h) => Math.max(h.income, h.expense, 1)));
  const barH = 80;
  const loadData = useCallback(async () => {
    const txJson = JSON.stringify(await getAll());
    const transactions = txJson ? JSON.parse(txJson) : [];
    const savedGoal = await AsyncStorage.getItem('savings_goal_pct');
    if (savedGoal) setSavingsGoalPct(parseFloat(savedGoal));
    const wealthJson = await AsyncStorage.getItem('user_wealth_accounts');
    const accounts = wealthJson ? JSON.parse(wealthJson) : [];
    const savAcc = accounts.filter(
      (a) =>
        a.type === 'Bank Account' ||
        a.subType === 'Savings Account' ||
        ['Fixed Deposit', 'Recurring Deposit'].includes(a.type)
    );
    setSavingsAccounts(savAcc);

    // Current month
    const tm = currentDate.getMonth();
    const ty = currentDate.getFullYear();
    const monthTxs = transactions.filter((t) => {
      if (!isReportable(t)) return false;
      const d = new Date(t.fullDate || t.date);
      return d.getMonth() === tm && d.getFullYear() === ty;
    });
    const income = monthTxs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = monthTxs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const savings = income - expense;
    const rate = income > 0 ? Math.round((savings / income) * 100) : 0;
    setStats({
      income,
      expense,
      savings,
      rate,
    });

    // Build 6-month history
    const hist = [];
    for (let i = 5; i >= 0; i--) {
      const d = shiftMonth(currentDate, -i);
      const m = d.getMonth();
      const y = d.getFullYear();
      const txs = transactions.filter((t) => {
        if (!isReportable(t)) return false;
        const dt = new Date(t.fullDate || t.date);
        return dt.getMonth() === m && dt.getFullYear() === y;
      });
      const inc = txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      const exp = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      const sav = inc - exp;
      hist.push({
        label: months[m],
        income: inc,
        expense: exp,
        savings: sav,
        rate: inc > 0 ? Math.round((sav / inc) * 100) : 0,
      });
    }
    setHistory(hist);
  }, [currentDate]);
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.title}>Savings Tracker</Text>
        <TouchableOpacity
          onPress={() => {
            setGoalInput(String(savingsGoalPct));
            setEditGoalVisible(true);
          }}
        >
          <Ionicons name="options-outline" size={24} color="#2196F3" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingBottom: 30,
        }}
      >
        {/* Month Nav */}
        <View style={styles.monthRow}>
          <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.arrowBtn}>
            <Ionicons name="chevron-back" size={20} color="#555" />
          </TouchableOpacity>
          <Text style={styles.monthLabel}>
            {currentDate.toLocaleDateString('en-IN', {
              month: 'long',
              year: 'numeric',
            })}
          </Text>
          <TouchableOpacity onPress={() => changeMonth(1)} style={styles.arrowBtn}>
            <Ionicons name="chevron-forward" size={20} color="#555" />
          </TouchableOpacity>
        </View>

        {/* Savings Rate Card */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: stats.savings >= 0 ? '#E8F5E9' : '#FFEBEE',
            },
          ]}
        >
          <Text style={styles.cardLabel}>Net Savings This Month</Text>
          <Text
            style={[
              styles.bigAmount,
              {
                color: stats.savings >= 0 ? COLORS.savings : COLORS.expense,
              },
            ]}
          >
            ₹ {Math.abs(stats.savings).toLocaleString('en-IN')}
            {stats.savings < 0 ? ' deficit' : ''}
          </Text>
          <View style={styles.rateRow}>
            <View style={styles.rateBadge}>
              <Text style={styles.rateText}>Savings Rate: {stats.rate}%</Text>
            </View>
            <View
              style={[
                styles.rateBadge,
                {
                  backgroundColor: stats.rate >= savingsGoalPct ? '#C8E6C9' : '#FFCDD2',
                },
              ]}
            >
              <Text
                style={[
                  styles.rateText,
                  {
                    color: stats.rate >= savingsGoalPct ? '#388E3C' : '#C62828',
                  },
                ]}
              >
                Goal: {savingsGoalPct}% {stats.rate >= savingsGoalPct ? '✓' : '✗'}
              </Text>
            </View>
          </View>

          {/* Progress bar */}
          <View style={styles.progressBg}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.min(100, stats.income > 0 ? (stats.savings / stats.income) * 100 : 0)}%`,
                  backgroundColor: stats.rate >= savingsGoalPct ? COLORS.savings : COLORS.warning,
                },
              ]}
            />
          </View>
          <Text style={styles.progressLabel}>
            ₹{stats.income.toLocaleString('en-IN')} income → ₹{stats.expense.toLocaleString('en-IN')} spent
          </Text>
        </View>

        {/* 3 stat mini cards */}
        <View style={styles.miniRow}>
          {[
            {
              label: 'Income',
              val: stats.income,
              color: COLORS.income,
              icon: 'arrow-down-circle',
            },
            {
              label: 'Expense',
              val: stats.expense,
              color: COLORS.expense,
              icon: 'arrow-up-circle',
            },
            {
              label: 'Saved',
              val: stats.savings,
              color: COLORS.savings,
              icon: 'save',
            },
          ].map((item) => (
            <View key={item.label} style={styles.miniCard}>
              <Ionicons name={item.icon} size={20} color={item.color} />
              <Text
                style={[
                  styles.miniVal,
                  {
                    color: item.color,
                  },
                ]}
              >
                ₹{Math.abs(item.val).toLocaleString('en-IN')}
              </Text>
              <Text style={styles.miniLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        {/* 6-Month Bar Chart */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>6-Month Overview</Text>
          <View style={styles.chartRow}>
            {history.map((h, i) => (
              <View key={i} style={styles.barGroup}>
                <View style={styles.bars}>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: (h.income / maxBar) * barH,
                        backgroundColor: '#BBDEFB',
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.bar,
                      {
                        height: (Math.max(0, h.expense) / maxBar) * barH,
                        backgroundColor: '#FFCDD2',
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.bar,
                      {
                        height: (Math.abs(h.savings) / maxBar) * barH,
                        backgroundColor: h.savings >= 0 ? '#C8E6C9' : '#FFCDD2',
                      },
                    ]}
                  />
                </View>
                <Text style={styles.barLabel}>{h.label}</Text>
                <Text
                  style={[
                    styles.barRate,
                    {
                      color: h.rate >= savingsGoalPct ? COLORS.savings : COLORS.expense,
                    },
                  ]}
                >
                  {h.rate}%
                </Text>
              </View>
            ))}
          </View>
          <View style={styles.legendRow}>
            {[
              ['#BBDEFB', 'Income'],
              ['#FFCDD2', 'Expense'],
              ['#C8E6C9', 'Savings'],
            ].map(([c, l]) => (
              <View key={l} style={styles.legendItem}>
                <View
                  style={[
                    styles.legendDot,
                    {
                      backgroundColor: c,
                    },
                  ]}
                />
                <Text style={styles.legendLabel}>{l}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Savings Accounts */}
        {savingsAccounts.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Savings Accounts</Text>
            {savingsAccounts.map((acc) => (
              <View key={acc.id} style={styles.accRow}>
                <View style={styles.accIcon}>
                  <Ionicons name="business-outline" size={18} color="#2196F3" />
                </View>
                <View
                  style={{
                    flex: 1,
                  }}
                >
                  <Text style={styles.accName}>{acc.name}</Text>
                  <Text style={styles.accType}>{acc.subType || acc.type}</Text>
                </View>
                <Text style={styles.accBal}>₹{(acc.balance || 0).toLocaleString('en-IN')}</Text>
              </View>
            ))}
            <TouchableOpacity style={styles.addAccBtn} onPress={() => navigation.navigate('AddAsset')}>
              <Ionicons name="add-circle-outline" size={16} color="#2196F3" />
              <Text style={styles.addAccText}>Add Savings Account</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Tips */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: '#E3F2FD',
            },
          ]}
        >
          <Text style={styles.sectionTitle}>💡 Savings Tips</Text>
          {stats.rate < savingsGoalPct ? (
            <>
              <Text style={styles.tip}>
                • You&apos;re ₹
                {Math.round((stats.income * savingsGoalPct) / 100 - stats.savings).toLocaleString('en-IN')}{' '}
                short of your {savingsGoalPct}% savings goal
              </Text>
              <Text style={styles.tip}>• Try the 50-30-20 rule: 50% needs, 30% wants, 20% savings</Text>
              <Text style={styles.tip}>• Review your top expense categories in Analytics</Text>
            </>
          ) : (
            <>
              <Text style={styles.tip}>• Great! You exceeded your savings goal this month 🎉</Text>
              <Text style={styles.tip}>• Consider investing the surplus in mutual funds or FD</Text>
              <Text style={styles.tip}>• Keep the momentum — set a higher savings goal!</Text>
            </>
          )}
        </View>
      </ScrollView>

      {/* Goal Edit Modal */}
      <Modal visible={editGoalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Set Savings Goal</Text>
            <Text style={styles.modalSub}>Target savings percentage of income</Text>
            <TextInput
              style={styles.modalInput}
              value={goalInput}
              onChangeText={setGoalInput}
              keyboardType="numeric"
              placeholder="e.g. 20"
            />
            <Text
              style={{
                textAlign: 'center',
                color: '#666',
                marginBottom: 15,
              }}
            >
              {goalInput}% of income
            </Text>
            <View
              style={{
                flexDirection: 'row',
                gap: 10,
              }}
            >
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  {
                    backgroundColor: '#eee',
                  },
                ]}
                onPress={() => setEditGoalVisible(false)}
              >
                <Text
                  style={{
                    color: '#333',
                    fontWeight: 'bold',
                  }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  {
                    backgroundColor: '#2196F3',
                  },
                ]}
                onPress={saveGoal}
              >
                <Text
                  style={{
                    color: '#fff',
                    fontWeight: 'bold',
                  }}
                >
                  Save
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  arrowBtn: {
    padding: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginHorizontal: 16,
    marginBottom: 14,
    elevation: 2,
  },
  cardLabel: {
    fontSize: 13,
    color: '#666',
    marginBottom: 6,
  },
  bigAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  rateRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  rateBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#E3F2FD',
    borderRadius: 20,
  },
  rateText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1565C0',
  },
  progressBg: {
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    marginBottom: 6,
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
  },
  progressLabel: {
    fontSize: 11,
    color: '#888',
  },
  miniRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 14,
    gap: 8,
  },
  miniCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    elevation: 2,
  },
  miniVal: {
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 4,
  },
  miniLabel: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 14,
  },
  chartRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    height: 110,
    marginBottom: 10,
  },
  barGroup: {
    alignItems: 'center',
    flex: 1,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    marginBottom: 4,
  },
  bar: {
    width: 8,
    borderRadius: 3,
  },
  barLabel: {
    fontSize: 10,
    color: '#666',
  },
  barRate: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 2,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    fontSize: 11,
    color: '#666',
  },
  accRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#f0f0f0',
  },
  accIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E3F2FD',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  accName: {
    fontWeight: '600',
    color: '#333',
  },
  accType: {
    fontSize: 12,
    color: '#888',
  },
  accBal: {
    fontWeight: 'bold',
    color: '#2196F3',
    fontSize: 15,
  },
  addAccBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 12,
  },
  addAccText: {
    color: '#2196F3',
    fontWeight: '600',
  },
  tip: {
    fontSize: 13,
    color: '#444',
    marginBottom: 6,
    lineHeight: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 30,
  },
  modalBox: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  modalSub: {
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 10,
  },
  modalBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
});
