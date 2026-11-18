import { Text, View, TextInput, TouchableOpacity, ScrollView, SafeAreaView } from '../components/Theme';
import { getMonthlyBudget, saveMonthlyBudget } from '../utils/MonthlyBudgets';
import { getAll } from '../data/TransactionRepo';
import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, Alert, Switch } from 'react-native';
import AsyncStorage from '../data/Storage';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { isReportable } from '../utils/BalanceService';
import { parseAmount, shiftMonth, isSameMonth, safePercent, formatMoney } from '../utils/Format';
const Chip = ({
  label,
  selected,
  onPress
}) => <TouchableOpacity onPress={onPress} style={[styles.chip, selected && {
  backgroundColor: '#333',
  borderColor: '#333'
}]}>
    <Text style={[styles.chipText, selected && {
    color: '#fff'
  }]}>{label}</Text>
  </TouchableOpacity>;
export default function BudgetScreen({
  navigation
}) {
  const isFocused = useIsFocused();

  // Date State for History
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Budget State
  const [rollover, setRollover] = useState(false);
  const [carry, setCarry] = useState(0);
  const [overallBudget, setOverallBudget] = useState('');
  const [overallSpent, setOverallSpent] = useState(0);
  const [catBudgets, setCatBudgets] = useState({});
  const [catSpent, setCatSpent] = useState({});

  // UI State
  const [availableCats, setAvailableCats] = useState([]);
  const [selectedCat, setSelectedCat] = useState('');
  const [newCatAmount, setNewCatAmount] = useState('');
  // Reload when date changes

  const changeMonth = direction => {
    setSelectedDate(shiftMonth(selectedDate, direction));
  };
  // ... (Keep saveOverallBudget, saveCategoryBudget, deleteCategoryBudget, renderProgressBar same as before) ...
  // [Paste those helper functions here from previous code]
  const saveOverallBudget = async () => {
    if (String(overallBudget).trim() === '') {
      await saveMonthlyBudget(selectedDate, {
        limit: 0
      }); // empty = no budget set
      return;
    }
    const v = parseAmount(overallBudget);
    if (v === null) {
      Alert.alert("Error", "Enter a valid budget amount greater than 0");
      return;
    }
    await saveMonthlyBudget(selectedDate, {
      limit: v,
      rollover
    });
    setOverallBudget(String(v));
    Alert.alert("Success", "Budget Set!");
  };
  const saveCategoryBudget = async () => {
    const v = parseAmount(newCatAmount);
    if (!selectedCat || v === null) {
      Alert.alert("Error", "Select a category and enter a valid amount");
      return;
    }
    const newBudgets = {
      ...catBudgets,
      [selectedCat]: v
    };
    setCatBudgets(newBudgets);
    await saveMonthlyBudget(selectedDate, {
      categories: newBudgets
    });
    setNewCatAmount('');
    setSelectedCat('');
  };
  const deleteCategoryBudget = async category => {
    const newBudgets = {
      ...catBudgets
    };
    delete newBudgets[category];
    setCatBudgets(newBudgets);
    await AsyncStorage.setItem('user_category_budgets', JSON.stringify(newBudgets));
  };
  const renderProgressBar = (spent, limit, color = '#2196F3') => {
    const ratio = safePercent(spent, limit);
    const percent = Math.min(ratio, 1);
    const isDanger = limit > 0 && spent > limit;
    const finalColor = isDanger ? '#F44336' : percent > 0.85 ? '#FF9800' : color;
    return <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, {
        width: `${percent * 100}%`,
        backgroundColor: finalColor
      }]} />
        </View>;
  };
  const masterCategoryList = Array.from(new Set([...availableCats, ...Object.keys(catBudgets), ...Object.keys(catSpent)])).sort();
  const loadData = useCallback(async () => {
    const savedCategories = await AsyncStorage.getItem('user_categories');
    const txJson = JSON.stringify(await getAll());
    const transactions = txJson ? JSON.parse(txJson) : [];
    let baseCategories = savedCategories ? JSON.parse(savedCategories) : ['Food', 'Transport', 'Shopping', 'Bills', 'Health'];
    const monthly = await getMonthlyBudget(selectedDate, transactions);
    setOverallBudget(String(monthly.limit || ''));
    setCatBudgets(monthly.categories || {});
    setRollover(!!monthly.rollover);
    setCarry(monthly.carry || 0);

    // FILTER BY SELECTED MONTH
    const targetMonth = selectedDate.getMonth();
    const targetYear = selectedDate.getFullYear();
    let total = 0;
    let catTotals = {};
    let foundInTransactions = new Set();
    transactions.forEach(t => {
      const d = new Date(t.fullDate || t.date);

      // Calculate Spend for Selected Month (excluded transactions don't count)
      if (isReportable(t) && t.type === 'expense' && d.getMonth() === targetMonth && d.getFullYear() === targetYear) {
        total += t.amount;
        catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
      }
      if (t.category) foundInTransactions.add(t.category);
    });
    setOverallSpent(total);
    setCatSpent(catTotals);
    const finalCatList = Array.from(new Set([...baseCategories, ...foundInTransactions])).sort();
    setAvailableCats(finalCatList);
  }, [selectedDate]);
  useEffect(() => {
    if (isFocused) loadData();
  }, [isFocused, loadData]);
  return <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Ionicons name="arrow-back" size={24} color="#333" /></TouchableOpacity>
        <Text style={styles.title}>Budget Planner</Text>
        {/* Analytics Button */}
        <TouchableOpacity onPress={() => navigation.navigate('Analytics')}>
            <Ionicons name="stats-chart" size={24} color="#2196F3" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{
      padding: 20,
      paddingBottom: 50
    }}>
         
         <View style={{
        flexDirection: 'row',
        alignItems: 'center'
      }}><Text style={{
          flex: 1
        }}>Roll unused overall budget forward</Text><Switch value={rollover} onValueChange={async value => {
          await saveMonthlyBudget(selectedDate, {
            rollover: value
          });
          setRollover(value);
          await loadData();
        }} /></View><Text>Rollover available: {formatMoney(carry)}</Text>
         {/* MONTH SELECTOR */}
         <View style={styles.monthSelector}>
             <TouchableOpacity onPress={() => changeMonth(-1)}>
                 <Ionicons name="chevron-back" size={24} color="#555" />
             </TouchableOpacity>
             <Text style={styles.monthText}>
                 {selectedDate.toLocaleDateString('en-IN', {
            month: 'long',
            year: 'numeric'
          })}
             </Text>
             <TouchableOpacity onPress={() => changeMonth(1)}>
                 <Ionicons name="chevron-forward" size={24} color="#555" />
             </TouchableOpacity>
         </View>

         {/* 1. OVERALL BUDGET */}
         <View style={styles.card}>
            <Text style={styles.sectionTitle}>MONTHLY LIMIT</Text>
            <View style={styles.inputRow}>
               <Text style={styles.currency}>₹</Text>
               <TextInput style={styles.mainInput} value={overallBudget} onChangeText={setOverallBudget} onEndEditing={saveOverallBudget} keyboardType="numeric" placeholder="Total Limit" />
            </View>
            <View style={{
          marginTop: 15
        }}>
                <View style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: 5
          }}>
                    <Text style={{
              color: '#666'
            }}>Spent: {formatMoney(overallSpent)}</Text>
                    <Text style={{
              fontWeight: 'bold'
            }}>{Math.round(safePercent(overallSpent, (parseAmount(overallBudget) || 0) + carry) * 100)}%</Text>
                </View>
                {parseAmount(overallBudget) ? renderProgressBar(overallSpent, (parseAmount(overallBudget) || 0) + carry, '#4CAF50') : <Text style={{
            color: '#999',
            fontSize: 12
          }}>No budget set</Text>}
            </View>
         </View>

         {/* 2. ADD CATEGORY (Only show if viewing Current Month) */}
         {isSameMonth(selectedDate, new Date()) && <>
                 <Text style={styles.heading}>Set Category Limit</Text>
                 <View style={styles.addSection}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{
            marginBottom: 10
          }}>
                        {availableCats.map(cat => <Chip key={cat} label={cat} selected={selectedCat === cat} onPress={() => setSelectedCat(cat)} />)}
                    </ScrollView>
                    <View style={styles.row}>
                        <TextInput style={styles.smallInput} placeholder="Limit" keyboardType="numeric" value={newCatAmount} onChangeText={setNewCatAmount} />
                        <TouchableOpacity style={styles.addBtn} onPress={saveCategoryBudget}><Text style={{
                color: '#fff',
                fontWeight: 'bold'
              }}>Set</Text></TouchableOpacity>
                    </View>
                 </View>
             </>}

         {/* 3. LIST */}
         <Text style={styles.heading}>Spending Overview</Text>
         {masterCategoryList.map(cat => {
        const spent = catSpent[cat] || 0;
        const limit = catBudgets[cat] || 0;
        const hasBudget = limit > 0;
        return <TouchableOpacity key={cat} style={[styles.budgetRow, selectedCat === cat && {
          borderColor: '#2196F3',
          borderWidth: 1
        }]} onPress={() => setSelectedCat(cat)}>
                     <View style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: 5
          }}>
                         <Text style={styles.catName}>{cat}</Text>
                         {hasBudget ? <TouchableOpacity onPress={() => deleteCategoryBudget(cat)}><Ionicons name="trash-outline" size={16} color="#999" /></TouchableOpacity> : <Text style={{
              fontSize: 10,
              color: '#999'
            }}>No Limit</Text>}
                     </View>
                     <View style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: 5
          }}>
                         <Text style={{
              fontSize: 12,
              color: hasBudget && spent > limit ? 'red' : '#555'
            }}>
                            {hasBudget ? `${formatMoney(spent)} / ${formatMoney(limit)}` : `Spent: ${formatMoney(spent)}`}
                         </Text>
                     </View>
                     {hasBudget ? renderProgressBar(spent, limit, '#2196F3') : <View style={[styles.progressBarBg, {
            backgroundColor: '#f0f0f0'
          }]}><View style={{
              width: 0
            }} /></View>}
                 </TouchableOpacity>;
      })}
      </ScrollView>
    </SafeAreaView>;
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9f9f9'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    alignItems: 'center',
    backgroundColor: '#fff'
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold'
  },
  monthSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 12,
    marginBottom: 20,
    marginHorizontal: 20,
    elevation: 2
  },
  monthText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333'
  },
  card: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 15,
    marginBottom: 25,
    marginHorizontal: 20,
    elevation: 2
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#999',
    marginBottom: 10
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: '#eee',
    paddingBottom: 5
  },
  currency: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginRight: 10
  },
  mainInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333'
  },
  heading: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    marginLeft: 25
  },
  addSection: {
    marginBottom: 20,
    marginHorizontal: 20
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  smallInput: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#ddd'
  },
  addBtn: {
    backgroundColor: '#333',
    padding: 12,
    borderRadius: 10,
    paddingHorizontal: 20
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ddd',
    marginRight: 8,
    backgroundColor: '#fff'
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555'
  },
  budgetRow: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    marginHorizontal: 20,
    elevation: 1
  },
  catName: {
    fontWeight: 'bold',
    fontSize: 16
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#eee',
    borderRadius: 4,
    overflow: 'hidden'
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4
  }
});
