import { Text, View, ScrollView, TouchableOpacity, SafeAreaView } from '../components/Theme';
import { getAll } from '../data/TransactionRepo';
import React, { useState, useCallback } from 'react';
import { StyleSheet, Dimensions, RefreshControl, Modal } from 'react-native';
import { BarChart, PieChart } from 'react-native-chart-kit';
import AsyncStorage from '../data/Storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { computeNetWorth } from '../utils/BalanceService';
import { monthSpend, monthIncome } from '../utils/Report';
import { formatMoney } from '../utils/Format';

// FIX: subtract extra padding so chart never overflows the screen
const screenWidth = Dimensions.get('window').width - 48;
const TABS = ['Overview', 'Categories', 'Savings', 'Net Worth'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export default function AnalyticsScreen({ navigation }) {
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('Overview');

  // FIX: year/month filter state
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth()); // 0-indexed
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [pieData, setPieData] = useState([]);
  const [barData, setBarData] = useState({
    labels: [],
    datasets: [
      {
        data: [0],
      },
    ],
  });
  const [incomeBarData, setIncomeBarData] = useState({
    labels: [],
    datasets: [
      {
        data: [0],
      },
    ],
  });
  const [netWorthData, setNetWorthData] = useState([]);
  const [assets, setAssets] = useState(0);
  const [liabilities, setLiabilities] = useState(0);
  const [summary, setSummary] = useState({
    income: 0,
    expense: 0,
    savings: 0,
    rate: 0,
  });
  const [savingsTrend, setSavingsTrend] = useState({
    labels: [],
    datasets: [
      {
        data: [0],
      },
    ],
  });
  const availableYears = () => {
    const cur = new Date().getFullYear();
    return [cur - 2, cur - 1, cur, cur + 1];
  };
  const renderFilterBar = () => (
    <View style={styles.filterBar}>
      {/* Month Selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.monthScroll}>
        {MONTHS.map((m, i) => (
          <TouchableOpacity
            key={m}
            onPress={() => setSelectedMonth(i)}
            style={[styles.monthChip, selectedMonth === i && styles.monthChipActive]}
          >
            <Text style={[styles.monthChipText, selectedMonth === i && styles.monthChipTextActive]}>{m}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {/* Year Selector */}
      <TouchableOpacity style={styles.yearBtn} onPress={() => setShowYearPicker(true)}>
        <Text style={styles.yearBtnText}>{selectedYear}</Text>
        <Ionicons name="chevron-down" size={14} color="#2196F3" />
      </TouchableOpacity>
    </View>
  );
  const renderOverview = () => (
    <View>
      {renderFilterBar()}
      <View style={styles.summaryRow}>
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: '#E8F5E9',
            },
          ]}
        >
          <Text
            style={[
              styles.sumLabel,
              {
                color: '#2E7D32',
              },
            ]}
          >
            Income
          </Text>
          <Text
            style={[
              styles.sumValue,
              {
                color: '#2E7D32',
              },
            ]}
          >
            {formatMoney(summary.income)}
          </Text>
        </View>
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: '#FFEBEE',
            },
          ]}
        >
          <Text
            style={[
              styles.sumLabel,
              {
                color: '#C62828',
              },
            ]}
          >
            Expense
          </Text>
          <Text
            style={[
              styles.sumValue,
              {
                color: '#C62828',
              },
            ]}
          >
            {formatMoney(summary.expense)}
          </Text>
        </View>
      </View>
      <View style={styles.savingCard}>
        <View>
          <Text style={styles.savingLabel}>Net Savings</Text>
          <Text style={styles.savingValue}>{formatMoney(summary.savings)}</Text>
        </View>
        <View
          style={{
            alignItems: 'flex-end',
          }}
        >
          <Text style={styles.savingLabel}>Savings Rate</Text>
          <Text
            style={{
              fontSize: 24,
              fontWeight: 'bold',
              color: summary.rate > 20 ? '#4CAF50' : '#FF9800',
            }}
          >
            {summary.rate}%
          </Text>
        </View>
      </View>

      <Text style={styles.chartTitle}>Monthly Income vs Expense</Text>
      {/* FIX: wrap in View with overflow hidden to prevent clipping */}
      <View style={styles.chartWrapper}>
        <BarChart
          data={{
            labels: barData.labels,
            datasets: [
              {
                data: incomeBarData.datasets[0].data,
                color: () => 'rgba(76,175,80,0.8)',
              },
              {
                data: barData.datasets[0].data,
                color: () => 'rgba(244,67,54,0.8)',
              },
            ],
            legend: ['Income', 'Expense'],
          }}
          width={screenWidth}
          height={220}
          yAxisLabel="₹"
          yAxisSuffix=""
          chartConfig={barChartConfig}
          verticalLabelRotation={0}
          style={styles.chart}
          fromZero
          showValuesOnTopOfBars={false}
        />
      </View>
    </View>
  );
  const renderCategories = () => (
    <View>
      {renderFilterBar()}
      <Text style={styles.chartTitle}>Spending by Category</Text>
      {pieData.length > 0 ? (
        <View style={styles.chartWrapper}>
          <PieChart
            data={pieData}
            width={screenWidth}
            height={200}
            chartConfig={pieChartConfig}
            accessor="population"
            backgroundColor="transparent"
            paddingLeft="10"
            absolute
          />
        </View>
      ) : (
        <Text style={styles.noData}>
          No expenses in {MONTHS[selectedMonth]} {selectedYear}.
        </Text>
      )}
      {/* Category list breakdown */}
      {pieData.map((item, i) => (
        <View key={i} style={styles.catRow}>
          <View
            style={[
              styles.catDot,
              {
                backgroundColor: item.color,
              },
            ]}
          />
          <Text style={styles.catName}>{item.name}</Text>
          <Text style={styles.catAmt}>{formatMoney(item.population)}</Text>
        </View>
      ))}
    </View>
  );
  const renderSavings = () => (
    <View>
      {renderFilterBar()}
      <Text style={styles.chartTitle}>Savings Trend (6 Months)</Text>
      <View style={styles.chartWrapper}>
        <BarChart
          data={savingsTrend}
          width={screenWidth}
          height={220}
          yAxisLabel="₹"
          yAxisSuffix=""
          chartConfig={{
            ...barChartConfig,
            fillShadowGradient: '#4CAF50',
            color: () => 'rgba(76,175,80,0.9)',
          }}
          verticalLabelRotation={0}
          style={styles.chart}
          fromZero
        />
      </View>
      <View style={styles.savingCard}>
        <View>
          <Text style={styles.savingLabel}>This Month Savings</Text>
          <Text style={styles.savingValue}>{formatMoney(summary.savings)}</Text>
        </View>
        <View
          style={{
            alignItems: 'flex-end',
          }}
        >
          <Text style={styles.savingLabel}>Savings Rate</Text>
          <Text
            style={{
              fontSize: 24,
              fontWeight: 'bold',
              color: summary.rate > 20 ? '#4CAF50' : '#FF9800',
            }}
          >
            {summary.rate}%
          </Text>
        </View>
      </View>
    </View>
  );
  const renderNetWorth = () => (
    <View>
      <View style={styles.nwCards}>
        <View style={styles.nwCard}>
          <Text style={styles.nwCardLabel}>Total Assets</Text>
          <Text
            style={[
              styles.nwCardValue,
              {
                color: '#2E7D32',
              },
            ]}
          >
            {formatMoney(assets)}
          </Text>
        </View>
        <View style={styles.nwCard}>
          <Text style={styles.nwCardLabel}>Total Liabilities</Text>
          <Text
            style={[
              styles.nwCardValue,
              {
                color: '#C62828',
              },
            ]}
          >
            {formatMoney(liabilities)}
          </Text>
        </View>
        <View style={styles.nwCard}>
          <Text style={styles.nwCardLabel}>Net Worth</Text>
          <Text
            style={[
              styles.nwCardValue,
              {
                color: '#1565C0',
              },
            ]}
          >
            {formatMoney(assets - liabilities)}
          </Text>
        </View>
      </View>

      <Text style={styles.chartTitle}>Asset Allocation</Text>
      {netWorthData.length > 0 ? (
        <View style={styles.chartWrapper}>
          <PieChart
            data={netWorthData}
            width={screenWidth}
            height={200}
            chartConfig={pieChartConfig}
            accessor="population"
            backgroundColor="transparent"
            paddingLeft="10"
            absolute
          />
        </View>
      ) : (
        <Text style={styles.noData}>No assets found. Add assets in Wealth tab.</Text>
      )}

      {/* FIX: "Manage Assets & Liabilities" button now actually navigates */}
      <TouchableOpacity
        style={styles.manageBtn}
        onPress={() =>
          navigation.navigate('Main', {
            screen: 'AccountsTab',
          })
        }
      >
        <Text style={styles.manageBtnText}>Manage Assets & Liabilities →</Text>
      </TouchableOpacity>
    </View>
  );
  const loadAnalytics = useCallback(async () => {
    setRefreshing(true);
    const txJson = JSON.stringify(await getAll());
    const wealthJson = await AsyncStorage.getItem('user_wealth_accounts');
    const transactions = txJson ? JSON.parse(txJson) : [];
    const accounts = wealthJson ? JSON.parse(wealthJson) : [];

    // --- SELECTED MONTH SUMMARY ---
    // the shared report rules (utils/Report): splits, refunds, settlements, Interest-only loans
    const monthDate = new Date(selectedYear, selectedMonth, 1);
    const spend = monthSpend(transactions, monthDate);
    const income = monthIncome(transactions, monthDate);
    const expense = spend.total;
    const savings = income - expense;
    const rate = income > 0 ? Math.round((savings / income) * 100) : 0;
    setSummary({
      income,
      expense,
      savings,
      rate,
    });

    // --- PIE CHART (expense categories for selected month) ---
    const catMap = Object.fromEntries(Object.entries(spend.byCategory).filter(([, v]) => v > 0));
    const colors = [
      '#F44336',
      '#E91E63',
      '#9C27B0',
      '#673AB7',
      '#3F51B5',
      '#2196F3',
      '#03A9F4',
      '#00BCD4',
      '#009688',
      '#4CAF50',
      '#8BC34A',
      '#CDDC39',
    ];
    const pData = Object.keys(catMap)
      .map((cat, i) => ({
        name: cat,
        population: catMap[cat],
        color: colors[i % colors.length],
        legendFontColor: '#7F7F7F',
        legendFontSize: 11,
      }))
      .sort((a, b) => b.population - a.population);
    setPieData(pData);

    // --- BAR CHART (6 months of selected year ending at selectedMonth) ---
    let months = [],
      expenseTrend = [],
      incomeTrend = [];
    for (let i = 5; i >= 0; i--) {
      let m = selectedMonth - i;
      let y = selectedYear;
      if (m < 0) {
        m += 12;
        y -= 1;
      }
      months.push(MONTHS[m]);
      const mDate = new Date(y, m, 1);
      const mExp = monthSpend(transactions, mDate).total;
      const mInc = monthIncome(transactions, mDate);
      expenseTrend.push(mExp || 0);
      incomeTrend.push(mInc || 0);
    }
    // Ensure at least one nonzero value to prevent chart crash
    setBarData({
      labels: months,
      datasets: [
        {
          data: expenseTrend.some((v) => v > 0) ? expenseTrend : [0, 0, 0, 0, 0, 0],
        },
      ],
    });
    setIncomeBarData({
      labels: months,
      datasets: [
        {
          data: incomeTrend.some((v) => v > 0) ? incomeTrend : [0, 0, 0, 0, 0, 0],
        },
      ],
    });

    // Savings trend
    const savTrend = expenseTrend.map((exp, i) => Math.max(0, incomeTrend[i] - exp));
    setSavingsTrend({
      labels: months,
      datasets: [
        {
          data: savTrend.some((v) => v > 0) ? savTrend : [0, 0, 0, 0, 0, 0],
        },
      ],
    });

    // --- NET WORTH ---
    const ious = JSON.parse((await AsyncStorage.getItem('ious')) || '[]');
    const nw = computeNetWorth(accounts, [], { txs: transactions, ious }); // C5 cards via CardMath; E4 people
    setAssets(nw.assets);
    setLiabilities(nw.liabilities);
    let assetMap = {
      Liquid: 0,
      Investments: 0,
      PF: 0,
      'Real Estate': 0,
    };
    accounts.forEach((a) => {
      const bal = parseFloat(a.balance) || 0;
      if (a.type === 'Loan' || a.type === 'Credit Card') return;
      if (['Bank Account', 'Cash', 'Wallet'].includes(a.type)) assetMap['Liquid'] += bal;
      else if (a.type === 'Provident Fund') assetMap['PF'] += bal;
      else if (a.type === 'Real Estate') assetMap['Real Estate'] += bal;
      else assetMap['Investments'] += bal;
    });
    const wData = Object.keys(assetMap)
      .map((k, i) => ({
        name: k,
        population: assetMap[k],
        color: ['#29B6F6', '#FFCA28', '#66BB6A', '#8D6E63'][i],
        legendFontColor: '#7F7F7F',
        legendFontSize: 11,
      }))
      .filter((i) => i.population > 0);
    setNetWorthData(wData);
    setRefreshing(false);
  }, [selectedYear, selectedMonth]);
  useFocusEffect(
    useCallback(() => {
      loadAnalytics();
    }, [loadAnalytics])
  );
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.title}>Analytics</Text>
        <View
          style={{
            width: 24,
          }}
        />
      </View>

      {/* TAB BAR */}
      <View style={styles.tabBar}>
        {TABS.map((tab) => (
          <TouchableOpacity key={tab} onPress={() => setActiveTab(tab)} style={styles.tabItem}>
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
            {activeTab === tab && <View style={styles.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* SUMMARY CHIPS */}
      <View style={styles.chipRow}>
        <View style={styles.chipCard}>
          <Text style={styles.chipVal} numberOfLines={1}>
            ₹{(summary.income / 1000).toFixed(1)}K
          </Text>
          <Text style={styles.chipLbl} numberOfLines={1}>
            Income
          </Text>
        </View>
        <View style={styles.chipCard}>
          <Text
            style={[
              styles.chipVal,
              {
                color: '#F44336',
              },
            ]}
            numberOfLines={1}
          >
            ₹{(summary.expense / 1000).toFixed(1)}K
          </Text>
          <Text style={styles.chipLbl} numberOfLines={1}>
            Spent
          </Text>
        </View>
        <View style={styles.chipCard}>
          <Text
            style={[
              styles.chipVal,
              {
                color: '#1565C0',
              },
            ]}
            numberOfLines={1}
          >
            ₹{(summary.savings / 1000).toFixed(1)}K
          </Text>
          <Text style={styles.chipLbl} numberOfLines={1}>
            Saved
          </Text>
        </View>
        <View style={styles.chipCard}>
          <Text
            style={[
              styles.chipVal,
              {
                color: '#7B1FA2',
              },
            ]}
            numberOfLines={1}
          >
            {summary.rate}%
          </Text>
          <Text style={styles.chipLbl}>Rate</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 40,
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadAnalytics} />}
      >
        {activeTab === 'Overview' && renderOverview()}
        {activeTab === 'Categories' && renderCategories()}
        {activeTab === 'Savings' && renderSavings()}
        {activeTab === 'Net Worth' && renderNetWorth()}
      </ScrollView>

      {/* Year Picker Modal */}
      <Modal visible={showYearPicker} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setShowYearPicker(false)}>
          <View style={styles.yearModal}>
            <Text style={styles.modalTitle}>Select Year</Text>
            {availableYears().map((y) => (
              <TouchableOpacity
                key={y}
                style={styles.yearRow}
                onPress={() => {
                  setSelectedYear(y);
                  setShowYearPicker(false);
                }}
              >
                <Text style={[styles.yearRowText, y === selectedYear && styles.yearRowActive]}>{y}</Text>
                {y === selectedYear && <Ionicons name="checkmark" size={18} color="#2196F3" />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
const barChartConfig = {
  backgroundGradientFrom: '#fff',
  backgroundGradientTo: '#fff',
  fillShadowGradient: '#2196F3',
  fillShadowGradientOpacity: 1,
  color: (opacity = 1) => `rgba(33,150,243,${opacity})`,
  labelColor: (opacity = 1) => `rgba(0,0,0,${opacity})`,
  barPercentage: 0.6,
  decimalPlaces: 0,
  propsForLabels: {
    fontSize: 10,
  },
};
const pieChartConfig = {
  color: (opacity = 1) => `rgba(0,0,0,${opacity})`,
};
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    alignItems: 'center',
    backgroundColor: '#fff',
    elevation: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
  },
  tabText: {
    fontSize: 12,
    color: '#999',
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#2196F3',
  },
  tabUnderline: {
    height: 2,
    width: '80%',
    backgroundColor: '#2196F3',
    marginTop: 4,
    borderRadius: 2,
  },
  chipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  chipCard: {
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
    padding: 8,
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 3,
  },
  chipVal: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2E7D32',
  },
  chipLbl: {
    fontSize: 10,
    color: '#999',
    marginTop: 2,
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  monthScroll: {
    flex: 1,
  },
  monthChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#f0f0f0',
    marginRight: 6,
  },
  monthChipActive: {
    backgroundColor: '#2196F3',
  },
  monthChipText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  monthChipTextActive: {
    color: '#fff',
  },
  yearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2196F3',
    marginLeft: 6,
  },
  yearBtnText: {
    fontSize: 12,
    color: '#2196F3',
    fontWeight: '700',
    marginRight: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  summaryCard: {
    width: '48%',
    padding: 15,
    borderRadius: 12,
    elevation: 1,
  },
  sumLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  sumValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  savingCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
    elevation: 1,
  },
  savingLabel: {
    fontSize: 12,
    color: '#999',
    fontWeight: 'bold',
  },
  savingValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 8,
    marginBottom: 8,
    color: '#333',
  },
  // FIX: clip overflow on chart wrapper
  chartWrapper: {
    borderRadius: 16,
    overflow: 'hidden',
    marginVertical: 8,
    backgroundColor: '#fff',
  },
  chart: {
    borderRadius: 16,
  },
  noData: {
    textAlign: 'center',
    color: '#999',
    marginVertical: 20,
    fontStyle: 'italic',
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  catDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  catName: {
    flex: 1,
    fontSize: 14,
    color: '#333',
  },
  catAmt: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  nwCards: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  nwCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    marginHorizontal: 4,
    elevation: 1,
  },
  nwCardLabel: {
    fontSize: 10,
    color: '#999',
    fontWeight: 'bold',
    marginBottom: 4,
  },
  nwCardValue: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  // FIX: Manage button now has navigation
  manageBtn: {
    backgroundColor: '#1a1a2e',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  manageBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  yearModal: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: 200,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  yearRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  yearRowText: {
    fontSize: 16,
    color: '#333',
  },
  yearRowActive: {
    color: '#2196F3',
    fontWeight: 'bold',
  },
});
