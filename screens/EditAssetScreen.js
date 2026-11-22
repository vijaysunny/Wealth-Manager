import { Text, View, TouchableOpacity, TextInput, ScrollView, SafeAreaView } from '../components/Theme';
import React, { useState } from 'react';
import { StyleSheet, Alert } from 'react-native';

import { updateAccount } from '../data/Storage';
import { deleteAccount } from '../data/Collections';
import { hasSchedule } from '../utils/LoanCalculator';
import { Ionicons } from '@expo/vector-icons';

// Quantity-based assets. AddAsset stores stocks/gold as type 'Investment' with the
// real kind in subType; older saved assets may still carry the kind in type.
const QTY_KINDS = ['Mutual Fund', 'Stocks / Equity', 'Gold / Silver'];
const isQuantityAsset = (a) => QTY_KINDS.includes(a.subType) || QTY_KINDS.includes(a.type);
// A4: for cards and loans the balance is the debt (positive = you owe).
const isDebt = (a) => a.type === 'Credit Card' || a.type === 'Loan';

export default function EditAssetScreen({ navigation, route }) {
  const { asset } = route.params;
  const scheduled = asset.type === 'Loan' && hasSchedule(asset);

  const [name, setName] = useState(asset.name);
  // For Banks/Cash, 'balance' is what we edit. For Stocks/MF, 'quantity' is what we edit.
  const [value, setValue] = useState(
    isQuantityAsset(asset)
      ? asset.quantity
        ? asset.quantity.toString()
        : '0'
      : asset.balance
        ? asset.balance.toString()
        : '0'
  );

  const handleSave = async () => {
    if (!name || !value) {
      Alert.alert('Error', 'Fields cannot be empty');
      return;
    }

    const number = Number(
      String(value)
        .replace(/,/g, '')
        .replace(/\u2212/g, '-')
        .trim()
    );
    // A card can be overpaid (the bank owes you), so only cards accept a negative amount.
    if (!Number.isFinite(number) || (number < 0 && asset.type !== 'Credit Card')) {
      Alert.alert('Error', 'Enter a valid non-negative value');
      return;
    }
    const field = isQuantityAsset(asset) ? 'quantity' : 'balance';
    // A scheduled loan's owed amount comes from its EMIs: only the name is saved here.
    const changes = scheduled ? { name: name.trim() } : { name: name.trim(), [field]: number };
    if (!scheduled && field === 'balance' && number !== Number(asset.balance))
      changes.balanceSetAt = new Date().toISOString();
    await updateAccount(asset.id, changes);
    navigation.goBack();
  };

  const handleDelete = () => {
    Alert.alert('Delete Asset', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteAccount(asset.id);
          navigation.goBack();
        },
      },
    ]);
  };

  const isInvestment = isQuantityAsset(asset);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.title}>
          {asset.type === 'Credit Card' ? 'Edit card' : asset.type === 'Loan' ? 'Edit loan' : 'Edit Asset'}
        </Text>
        <TouchableOpacity onPress={handleDelete}>
          <Ionicons name="trash" size={24} color="red" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.label}>ASSET NAME</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} />

        {scheduled ? (
          <>
            <Text style={styles.hint}>
              What you owe is worked out from the EMI schedule. To change it, edit the loan or add a
              prepayment.
            </Text>
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => navigation.navigate('LoanEdit', { loanId: asset.id })}
            >
              <Text style={styles.linkText}>Edit loan details</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.label}>
              {isInvestment
                ? 'UNITS / QUANTITY HELD'
                : isDebt(asset)
                  ? 'AMOUNT YOU OWE (₹)'
                  : 'CURRENT BALANCE (₹)'}
            </Text>
            <TextInput
              style={[styles.input, { fontSize: 24, fontWeight: 'bold' }]}
              value={value}
              onChangeText={setValue}
              keyboardType="numeric"
            />
          </>
        )}

        {asset.type === 'Credit Card' && (
          <Text style={styles.hint}>Negative = the bank owes you (overpaid)</Text>
        )}
        {isInvestment && (
          <Text style={styles.hint}>
            * Updating quantity will auto-calculate the new value based on live market rates.
          </Text>
        )}

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
          <Text style={styles.saveText}>Update Asset</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderColor: '#eee',
    alignItems: 'center',
  },
  title: { fontSize: 20, fontWeight: 'bold' },
  label: { color: '#666', fontSize: 12, fontWeight: 'bold', marginTop: 20, marginBottom: 5 },
  input: { borderBottomWidth: 1, borderColor: '#ccc', fontSize: 18, paddingVertical: 10, color: '#333' },
  saveBtn: { backgroundColor: '#2196F3', padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 40 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  linkBtn: { marginTop: 14, paddingVertical: 8 },
  linkText: { color: '#2196F3', fontSize: 15, fontWeight: 'bold' },
  hint: { color: '#999', fontSize: 12, marginTop: 10, fontStyle: 'italic' },
});
