import { putAccount } from '../data/Collections';
import { Text, View, TouchableOpacity, ScrollView, TextInput, SafeAreaView } from '../components/Theme';
import React, { useState, useCallback } from 'react';
import { StyleSheet, Alert, Switch } from 'react-native'; // <--- Added Switch

import AsyncStorage from '../data/Storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { add } from '../data/TransactionRepo';
import { parseAmount } from '../utils/Format';

// Simple Chip Component (Reused for consistency)
const Chip = ({
  label,
  selected,
  onPress,
  color = '#4CAF50'
}) => <TouchableOpacity onPress={onPress} style={[styles.chip, selected && {
  backgroundColor: color,
  borderColor: color
}]}>
    <Text style={[styles.chipText, selected && {
    color: '#fff'
  }]}>{label}</Text>
  </TouchableOpacity>;
export default function IncomeScreen({
  navigation,
  route
}) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState(new Date());

  // NEW: Toggle for "Not Income"
  const [excludeFromBudget, setExcludeFromBudget] = useState(false);

  // Store the specific account object (e.g., HDFC Bank)
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [availableAccounts, setAvailableAccounts] = useState([]);
  const [categoriesList, setCategoriesList] = useState([]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const handleSave = async () => {
    const val = parseAmount(amount);
    if (val === null) {
      Alert.alert("Error", "Enter a valid amount greater than 0");
      return;
    }
    if (!selectedAccount) {
      Alert.alert("Error", "Select where to deposit");
      return;
    }

    // 1. Save Transaction
    const newTx = {
      id: `manual_${Date.now()}_${Math.random()}`,
      title: category || 'Income',
      amount: val,
      type: 'income',
      date: date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      }),
      category: category || 'Salary',
      account: selectedAccount.name,
      accountId: selectedAccount.id,
      fullDate: date.toISOString(),
      // --- SAVE THE FLAG ---
      excludeFromReports: excludeFromBudget // If true, this is a transfer/refund
    };
    await add(newTx);
    navigation.goBack();
  };
  const loadData = useCallback(async () => {
    // 1. Load Income Categories
    const defaultIncomeCats = ['Salary', 'Business', 'Interest', 'Gift', 'Sold Item', 'Refund', 'Bonus'];
    setCategoriesList(defaultIncomeCats);

    // 2. LOAD REAL ACCOUNTS from Wealth Data
    const accJson = await AsyncStorage.getItem('user_wealth_accounts');
    let accounts = accJson ? JSON.parse(accJson) : [];
    const depositAccounts = accounts.filter(a => ['Bank Account', 'Cash', 'Wallet', 'Credit Card'].includes(a.type));
    if (depositAccounts.length === 0) {
      depositAccounts.push({
        name: 'Cash',
        type: 'Cash',
        id: 'default_cash',
        balance: 0
      });
    }
    if (!accounts.length) await putAccount(depositAccounts[0]);
    setAvailableAccounts(depositAccounts);
    if (depositAccounts.length > 0) setSelectedAccount(previous => previous || depositAccounts[0]);
    if (route.params?.prefill) {
      const {
        amount,
        category,
        date,
        accountName
      } = route.params.prefill;
      setAmount(amount);
      if (defaultIncomeCats.includes(category)) setCategory(category);else setCategory('Salary');
      if (date) setDate(new Date(date));
      if (accountName) {
        const match = depositAccounts.find(a => a.name.toLowerCase().includes(accountName.toLowerCase()));
        if (match) setSelectedAccount(match);
      }
      navigation.setParams({
        prefill: null
      });
    }
  }, [navigation, route.params]);
  useFocusEffect(useCallback(() => {
    loadData();
  }, [loadData]));
  return <SafeAreaView style={styles.container}>
      <View style={styles.header}>
         <TouchableOpacity onPress={() => navigation.goBack()}><Ionicons name="close" size={28} /></TouchableOpacity>
         <Text style={styles.title}>Add Income</Text>
         <View style={{
        width: 28
      }} /> 
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        
    {/* AMOUNT INPUT */}
<Text style={styles.label}>AMOUNT</Text>
<View style={{
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20
      }}>
  <Text style={styles.currency}>₹ </Text>
  <TextInput style={styles.amountInput} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#ccc" autoFocus={true} // Optional: automatically opens keyboard
        />
</View>

        {/* ACCOUNT SELECTOR */}
        <Text style={styles.label}>DEPOSIT TO</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow}>
          {availableAccounts.map((acc, i) => <Chip key={i} label={acc.name} selected={selectedAccount?.name === acc.name} onPress={() => setSelectedAccount(acc)} color="#4CAF50" // Green for Income
        />)}
        </ScrollView>

        {/* CATEGORY SELECTOR */}
        <Text style={styles.label}>CATEGORY</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow}>
          {categoriesList.map((cat, i) => <Chip key={i} label={cat} selected={category === cat} onPress={() => setCategory(cat)} color="#555" />)}
        </ScrollView>

        {/* DATE PICKER */}
        <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDatePicker(true)}>
           <Ionicons name="calendar" size={20} color="#666" />
           <Text style={styles.dateText}>{date.toDateString()}</Text>
        </TouchableOpacity>
        {showDatePicker && <DateTimePicker value={date} mode="date" onChange={(e, d) => {
        setShowDatePicker(false);
        if (d) setDate(d);
      }} />}

        {/* --- EXCLUDE FROM BUDGET TOGGLE --- */}
        <View style={styles.toggleRow}>
            <View style={{
          flex: 1
        }}>
                <Text style={styles.toggleTitle}>Exclude from Reports?</Text>
                <Text style={styles.toggleSub}>Mark as &quot;Not Income&quot; (e.g. Transfers)</Text>
            </View>
            <Switch value={excludeFromBudget} onValueChange={setExcludeFromBudget} trackColor={{
          false: '#ddd',
          true: '#C8E6C9'
        }} thumbColor={excludeFromBudget ? '#4CAF50' : '#f4f3f4'} />
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
          <Text style={styles.saveText}>Save Income</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>;
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    alignItems: 'center'
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold'
  },
  content: {
    padding: 20
  },
  label: {
    color: '#999',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 10,
    marginTop: 20
  },
  currency: {
    fontSize: 24,
    color: '#333',
    fontWeight: 'bold',
    marginBottom: 5
  },
  amountInput: {
    fontSize: 48,
    color: '#000'
  },
  hiddenInputArea: {
    marginBottom: 20
  },
  scrollRow: {
    flexDirection: 'row',
    marginBottom: 10
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#eee',
    marginRight: 10,
    marginBottom: 5
  },
  chipText: {
    fontWeight: '600',
    color: '#333'
  },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
    padding: 15,
    borderRadius: 10,
    marginTop: 10
  },
  dateText: {
    marginLeft: 10,
    fontSize: 16,
    color: '#333'
  },
  // NEW STYLES
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    backgroundColor: '#f9f9f9',
    padding: 15,
    borderRadius: 10
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333'
  },
  toggleSub: {
    fontSize: 12,
    color: '#999',
    marginTop: 2
  },
  saveBtn: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 30
  },
  saveText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold'
  }
});
