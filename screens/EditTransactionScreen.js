import { Text, View, TouchableOpacity, TextInput, ScrollView, SafeAreaView } from '../components/Theme';
import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, Alert, Switch } from 'react-native';
import AsyncStorage from '../data/Storage';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { AVAILABLE_ICONS } from '../utils/icons';
import { update, remove } from '../data/TransactionRepo';
import { parseAmount } from '../utils/Format';

// NEW: Added the Chip Component for the Category selector
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
export default function EditTransactionScreen({ route, navigation }) {
  const { transaction } = route.params;
  const [amount, setAmount] = useState(transaction.amount.toString());
  const [category, setCategory] = useState(transaction.title || transaction.category);

  // NEW: State for categories list
  const [categoriesList, setCategoriesList] = useState([]);
  const [tags, setTags] = useState(transaction.tags || []);
  const [tagInput, setTagInput] = useState('');

  // Date & Account State
  const [date, setDate] = useState(new Date(transaction.fullDate || Date.now()));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(transaction.account || 'Cash');
  const [availableAccounts, setAvailableAccounts] = useState([]);

  // Exclude Toggle State
  const [excludeFromReports, setExcludeFromReports] = useState(transaction.excludeFromReports || false);

  // Icon State
  const [selectedIcon, setSelectedIcon] = useState(transaction.customIcon);
  const [selectedColor, setSelectedColor] = useState(transaction.customColor);
  const addTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) setTags([...tags, tagInput.trim()]);
    setTagInput('');
  };
  const handleSave = async () => {
    if (transaction.type === 'transfer') {
      Alert.alert('Transfer', 'Transfers can be removed and recreated from Money tools.');
      return;
    }
    const newAmount = parseAmount(amount);
    if (newAmount === null) {
      Alert.alert('Error', 'Enter a valid amount greater than 0');
      return;
    }
    const json = await AsyncStorage.getItem('user_transactions');
    let data = JSON.parse(json);
    const idx = data.findIndex((t) => t.id === transaction.id);
    if (idx > -1) {
      const chosen = availableAccounts.find((a) => a.name === selectedAccount);
      data[idx] = {
        ...data[idx],
        amount: newAmount,
        title: category,
        category,
        tags,
        account: selectedAccount,
        accountId: chosen ? chosen.id : undefined,
        date: date.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
        fullDate: date.toISOString(),
        customIcon: selectedIcon,
        customColor: selectedColor,
        excludeFromReports: excludeFromReports,
      };
      await update(transaction.id, data[idx]);
      // Edit = reverse the old effect, apply the new one

      Alert.alert('Success', 'Transaction Updated');
      navigation.goBack();
    }
  };
  const handleDelete = () => {
    Alert.alert('Delete', 'Are you sure?', [
      {
        text: 'Cancel',
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await remove(transaction.id);
          navigation.goBack();
        },
      },
    ]);
  };
  const loadData = useCallback(async () => {
    // 1. Load Accounts
    const json = await AsyncStorage.getItem('user_wealth_accounts');
    const accs = json ? JSON.parse(json) : [];
    const valid = accs.filter((a) => ['Bank Account', 'Credit Card', 'Cash', 'Wallet'].includes(a.type));
    if (!valid.some((a) => a.name === 'Cash')) {
      valid.push({
        name: 'Cash',
        type: 'Cash',
      });
    }
    setAvailableAccounts(valid);

    // 2. Load Categories based on transaction type
    const catJson = await AsyncStorage.getItem('user_categories');
    const defaultExpenseCats = ['Food', 'Transport', 'Shopping', 'Bills'];
    const defaultIncomeCats = ['Salary', 'Business', 'Interest', 'Gift', 'Sold Item', 'Refund', 'Bonus'];
    let catsToLoad = catJson ? JSON.parse(catJson) : defaultExpenseCats;
    if (transaction.type === 'income') {
      catsToLoad = defaultIncomeCats;
    }

    // Ensure the current category is in the list (in case it's a custom one)
    const currentCat = transaction.title || transaction.category;
    if (currentCat && !catsToLoad.includes(currentCat)) {
      catsToLoad = [currentCat, ...catsToLoad];
    }
    setCategoriesList(catsToLoad);
  }, [transaction]);
  useEffect(() => {
    loadData(); // Renamed from loadAccounts
  }, [loadData]);
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="close" size={28} />
          </TouchableOpacity>
          <Text style={styles.title}>Edit Transaction</Text>
          <TouchableOpacity onPress={handleDelete}>
            <Ionicons name="trash" size={24} color="red" />
          </TouchableOpacity>
        </View>

        <View style={styles.form}>
          {/* AMOUNT */}
          <Text style={styles.label}>Amount</Text>
          <TextInput
            style={[
              styles.input,
              {
                fontSize: 30,
              },
            ]}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
          />

          {/* DATE PICKER */}
          <Text style={styles.label}>Date</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDatePicker(true)}>
            <Ionicons name="calendar-outline" size={20} color="#333" />
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

          {/* ACCOUNT SELECTOR */}
          <Text style={styles.label}>Account / Payment Method</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.accountScroll}>
            {availableAccounts.map((acc, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.accountChip, selectedAccount === acc.name && styles.activeAccount]}
                onPress={() => setSelectedAccount(acc.name)}
              >
                <Text
                  style={[
                    styles.accountText,
                    selectedAccount === acc.name && {
                      color: '#fff',
                    },
                  ]}
                >
                  {acc.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* CATEGORY SELECTOR - REPLACED TEXT INPUT WITH CHIPS */}
          <Text style={styles.label}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow}>
            {categoriesList.map((cat, i) => (
              <Chip
                key={i}
                label={cat}
                selected={category === cat}
                onPress={() => setCategory(cat)}
                color={transaction.type === 'income' ? '#4CAF50' : '#F44336'}
              />
            ))}
          </ScrollView>

          {/* TAGS */}
          <Text style={styles.label}>Tags</Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <TextInput
              style={[
                styles.input,
                {
                  flex: 1,
                },
              ]}
              value={tagInput}
              onChangeText={setTagInput}
              placeholder="Add tag..."
              onSubmitEditing={addTag}
            />
            <TouchableOpacity onPress={addTag}>
              <Ionicons name="add-circle" size={32} />
            </TouchableOpacity>
          </View>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              marginBottom: 20,
            }}
          >
            {tags.map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setTags(tags.filter((tg) => tg !== t))}
                style={styles.tag}
              >
                <Text>#{t}</Text>
                <Ionicons
                  name="close"
                  size={14}
                  style={{
                    marginLeft: 4,
                  }}
                />
              </TouchableOpacity>
            ))}
          </View>

          {/* ICON PICKER */}
          <Text style={styles.label}>Icon Override</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{
              marginBottom: 20,
            }}
          >
            {AVAILABLE_ICONS.map((ic, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => {
                  setSelectedIcon(ic.name);
                  setSelectedColor(ic.color);
                }}
                style={[
                  styles.iconBtn,
                  selectedIcon === ic.name && {
                    borderWidth: 2,
                    borderColor: ic.color,
                  },
                ]}
              >
                <Ionicons name={ic.name} size={24} color={ic.color} />
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* EXCLUDE TOGGLE */}
          <View style={styles.toggleRow}>
            <View
              style={{
                flex: 1,
              }}
            >
              <Text style={styles.toggleTitle}>Exclude from Reports?</Text>
              <Text style={styles.toggleSub}>
                {transaction.type === 'expense'
                  ? 'Mark as "Not an Expense" (e.g. Transfer)'
                  : 'Mark as "Not Income" (e.g. Refund)'}
              </Text>
            </View>
            <Switch
              value={excludeFromReports}
              onValueChange={setExcludeFromReports}
              trackColor={{
                false: '#ddd',
                true: transaction.type === 'expense' ? '#FFCDD2' : '#C8E6C9',
              }}
              thumbColor={
                excludeFromReports ? (transaction.type === 'expense' ? '#F44336' : '#4CAF50') : '#f4f3f4'
              }
            />
          </View>

          <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
            <Text
              style={{
                color: '#fff',
                fontWeight: 'bold',
                fontSize: 16,
              }}
            >
              Update
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  label: {
    marginTop: 15,
    color: '#666',
    fontWeight: 'bold',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  input: {
    borderBottomWidth: 1,
    borderColor: '#ccc',
    fontSize: 18,
    paddingVertical: 5,
  },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    marginTop: 5,
  },
  dateText: {
    marginLeft: 10,
    fontSize: 16,
    color: '#333',
  },
  accountScroll: {
    marginTop: 5,
    marginBottom: 5,
  },
  accountChip: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#eee',
    marginRight: 10,
  },
  activeAccount: {
    backgroundColor: '#2196F3',
  },
  accountText: {
    color: '#333',
    fontWeight: '500',
  },
  // NEW: Chip styles for categories
  scrollRow: {
    flexDirection: 'row',
    marginTop: 5,
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
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eee',
    padding: 8,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
    marginTop: 10,
  },
  iconBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#f9f9f9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 20,
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
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 50,
  },
});
