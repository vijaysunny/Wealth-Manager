import { putAccount } from '../data/Collections';
import { Text, View, TouchableOpacity, ScrollView, TextInput, SafeAreaView } from '../components/Theme';
import React, { useState, useCallback, useEffect } from 'react';
import { StyleSheet, Alert, Switch } from 'react-native'; // <--- Added Switch

import AsyncStorage from '../data/Storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { add, update } from '../data/TransactionRepo';
import { addAttachment } from '../utils/Attachments';
import { pickFromCamera } from '../utils/AttachmentPickers';
import { parseAmount } from '../utils/Format';

// Simple Chip Component for selection
const Chip = ({ label, selected, onPress, color = '#2196F3' }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[
      styles.chip,
      selected && {
        backgroundColor: color,
        borderColor: color,
      },
    ]}
  >
    <Text
      style={[
        styles.chipText,
        selected && {
          color: '#fff',
        },
      ]}
    >
      {label}
    </Text>
  </TouchableOpacity>
);
export default function ExpenseScreen({ navigation, route }) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState(new Date());

  // NEW: Toggle for "Not an Expense"
  const [excludeFromBudget, setExcludeFromBudget] = useState(false);

  // NEW: Store the specific account object
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [availableAccounts, setAvailableAccounts] = useState([]);
  const [categoriesList, setCategoriesList] = useState([]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  // B1 "Scan bill": the photo taken from Home, attached once the expense is saved
  const [bill, setBill] = useState(null);
  const takeBill = async () => {
    try {
      const picked = await pickFromCamera();
      if (picked) setBill(picked);
    } catch (e) {
      Alert.alert('Camera', e.message);
    }
  };
  useEffect(() => {
    if (route.params?.scanBill) {
      navigation.setParams({ scanBill: false });
      takeBill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.scanBill]);
  const handleSave = async () => {
    const val = parseAmount(amount);
    if (val === null) {
      Alert.alert('Error', 'Enter a valid amount greater than 0');
      return;
    }
    if (!category) {
      Alert.alert('Error', 'Select a category');
      return;
    }
    if (!selectedAccount) {
      Alert.alert('Error', 'Select an Account');
      return;
    }

    // 1. Save Transaction
    const newTx = {
      id: `manual_${Date.now()}_${Math.random()}`,
      title: category,
      amount: val,
      type: 'expense',
      date: date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
      category: category,
      account: selectedAccount.name,
      accountId: selectedAccount.id,
      fullDate: date.toISOString(),
      // --- SAVE THE FLAG ---
      excludeFromReports: excludeFromBudget, // If true, this is just a transfer/adjustment
    };
    await add(newTx);
    if (bill) {
      try {
        const withFile = await addAttachment(newTx, bill);
        await update(newTx.id, { attachments: withFile.attachments });
      } catch (e) {
        Alert.alert('Saved without the bill', e.message);
      }
    }
    navigation.goBack();
  };
  const loadData = useCallback(async () => {
    // 1. Load Categories
    const catJson = await AsyncStorage.getItem('user_categories');
    setCategoriesList(catJson ? JSON.parse(catJson) : ['Food', 'Transport', 'Shopping', 'Bills']);

    // 2. LOAD REAL ACCOUNTS from Wealth Data
    const accJson = await AsyncStorage.getItem('user_wealth_accounts');
    let accounts = accJson ? JSON.parse(accJson) : [];

    // Filter only "Spokable" accounts
    const spendable = accounts.filter((a) =>
      ['Bank Account', 'Credit Card', 'Cash', 'Wallet'].includes(a.type)
    );
    if (spendable.length === 0) {
      spendable.push({
        name: 'Cash',
        type: 'Cash',
        id: 'default_cash',
        balance: 0,
      });
    }
    if (!accounts.length) await putAccount(spendable[0]);
    setAvailableAccounts(spendable);
    if (spendable.length > 0) setSelectedAccount((previous) => previous || spendable[0]);

    // Handle Prefill (from SMS Scan)
    if (route.params?.prefill) {
      const { amount, category, date, accountName } = route.params.prefill;
      setAmount(amount);
      setCategory(category);
      if (date) setDate(new Date(date));
      if (accountName) {
        const match = spendable.find((a) => a.name.toLowerCase().includes(accountName.toLowerCase()));
        if (match) setSelectedAccount(match);
      }
      navigation.setParams({
        prefill: null,
      });
    }
  }, [navigation, route.params]);
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={28} />
        </TouchableOpacity>
        <Text style={styles.title}>Add Expense</Text>
        <View
          style={{
            width: 28,
          }}
        />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* AMOUNT INPUT */}
        <Text style={styles.label}>AMOUNT</Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 20,
          }}
        >
          <Text style={styles.currency}>₹ </Text>
          <TextInput
            style={styles.amountInput}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor="#ccc"
            autoFocus={true} // Optional: automatically opens keyboard
          />
        </View>

        {/* B1: bill photo */}
        {bill ? (
          <View
            testID="bill-attached"
            style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}
          >
            <Ionicons name="attach" size={18} color="#1F4FD8" />
            <Text style={{ flex: 1, marginLeft: 6, color: '#3A4456' }} numberOfLines={1}>
              Bill attached: {bill.name}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Remove bill"
              onPress={() => setBill(null)}
            >
              <Text style={{ color: '#97212E', fontWeight: '600' }}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Photograph the bill"
            onPress={takeBill}
            style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}
          >
            <Ionicons name="camera-outline" size={18} color="#1F4FD8" />
            <Text style={{ marginLeft: 6, color: '#1F4FD8', fontWeight: '600' }}>Photograph the bill</Text>
          </TouchableOpacity>
        )}

        {/* ACCOUNT SELECTOR */}
        <Text style={styles.label}>DEDUCT FROM</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow}>
          {availableAccounts.map((acc, i) => (
            <Chip
              key={i}
              label={acc.name}
              selected={selectedAccount?.name === acc.name}
              onPress={() => setSelectedAccount(acc)}
              color="#F44336"
            />
          ))}
        </ScrollView>

        {/* CATEGORY SELECTOR */}
        <Text style={styles.label}>CATEGORY</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow}>
          {categoriesList.map((cat, i) => (
            <Chip
              key={i}
              label={cat}
              selected={category === cat}
              onPress={() => setCategory(cat)}
              color="#555"
            />
          ))}
        </ScrollView>

        {/* DATE PICKER */}
        <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDatePicker(true)}>
          <Ionicons name="calendar" size={20} color="#666" />
          <Text style={styles.dateText}>{date.toDateString()}</Text>
        </TouchableOpacity>
        {showDatePicker && (
          <DateTimePicker
            value={date}
            mode="date"
            onChange={(e, d) => {
              setShowDatePicker(false);
              if (d) setDate(d);
            }}
          />
        )}

        {/* --- EXCLUDE FROM BUDGET TOGGLE --- */}
        <View style={styles.toggleRow}>
          <View
            style={{
              flex: 1,
            }}
          >
            <Text style={styles.toggleTitle}>Exclude from Reports?</Text>
            <Text style={styles.toggleSub}>Mark as &quot;Not an Expense&quot; (e.g. Transfers)</Text>
          </View>
          <Switch
            value={excludeFromBudget}
            onValueChange={setExcludeFromBudget}
            trackColor={{
              false: '#ddd',
              true: '#FFCDD2',
            }}
            thumbColor={excludeFromBudget ? '#F44336' : '#f4f3f4'}
          />
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
          <Text style={styles.saveText}>Save Expense</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  content: {
    padding: 20,
  },
  label: {
    color: '#999',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 10,
    marginTop: 20,
  },
  currency: {
    fontSize: 24,
    color: '#333',
    fontWeight: 'bold',
    marginBottom: 5,
  },
  amountInput: {
    fontSize: 48,
    color: '#000',
  },
  hiddenInputArea: {
    marginBottom: 20,
  },
  scrollRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#eee',
    marginRight: 10,
    marginBottom: 5,
  },
  chipText: {
    fontWeight: '600',
    color: '#333',
  },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
    padding: 15,
    borderRadius: 10,
    marginTop: 10,
  },
  dateText: {
    marginLeft: 10,
    fontSize: 16,
    color: '#333',
  },
  // NEW STYLES FOR TOGGLE
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    backgroundColor: '#f9f9f9',
    padding: 15,
    borderRadius: 10,
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  toggleSub: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  saveBtn: {
    backgroundColor: '#F44336',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 30,
  },
  saveText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
