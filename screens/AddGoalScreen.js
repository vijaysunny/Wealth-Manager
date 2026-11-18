import { Text, View, TextInput, TouchableOpacity, ScrollView, SafeAreaView } from '../components/Theme';
import React, { useState, useEffect } from 'react';
import { StyleSheet, Alert } from 'react-native';

import AsyncStorage from '../data/Storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { parseAmount, parseNonNegative } from '../utils/Format';

import { mutateList } from '../data/Collections';
export default function AddGoalScreen({ navigation, route }) {
  const existing = route.params?.goal;
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState(existing?.accountId || '');
  useEffect(() => {
    AsyncStorage.getItem('user_wealth_accounts').then((raw) => setAccounts(JSON.parse(raw || '[]')));
  }, []);
  const [name, setName] = useState(existing?.name || '');
  const [target, setTarget] = useState(String(existing?.targetAmount || ''));
  const [saved, setSaved] = useState(String(existing?.savedAmount ?? '0'));
  const [roi, setRoi] = useState(String(existing?.roi ?? 10)); // Default 10%
  const [assetName, setAssetName] = useState(existing?.linkedAsset || ''); // "Where did he save?"
  const [date, setDate] = useState(
    existing ? new Date(existing.deadline) : new Date(new Date().setFullYear(new Date().getFullYear() + 1))
  ); // Default 1 year from now
  const [showPicker, setShowPicker] = useState(false);

  const handleSave = async () => {
    const targetAmount = parseAmount(target);
    const savedAmount = parseNonNegative(saved);
    const roiPct = parseNonNegative(roi);
    if (!name.trim()) {
      Alert.alert('Error', 'Enter a goal name');
      return;
    }
    if (targetAmount === null) {
      Alert.alert('Error', 'Enter a valid target amount greater than 0');
      return;
    }
    if (savedAmount === null) {
      Alert.alert('Error', 'Enter the amount saved so far (0 if none)');
      return;
    }
    if (roiPct === null) {
      Alert.alert('Error', 'Enter a valid expected return % (0 if none)');
      return;
    }

    const newGoal = {
      ...existing,
      id: existing?.id || Date.now(),
      accountId,
      name: name.trim(),
      targetAmount,
      savedAmount,
      roi: roiPct,
      linkedAsset: assetName || 'General Savings',
      deadline: date.toISOString(),
    };

    await mutateList('user_goals', (goals) =>
      existing ? goals.map((goal) => (goal.id === existing.id ? newGoal : goal)) : [...goals, newGoal]
    );
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={28} />
        </TouchableOpacity>
        <Text style={styles.title}>{existing ? 'Edit Goal' : 'New Goal'}</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.label}>Goal Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Dream Car, Wedding"
        />

        <Text style={styles.label}>Target Amount (₹)</Text>
        <TextInput
          style={styles.input}
          value={target}
          onChangeText={setTarget}
          keyboardType="numeric"
          placeholder="1000000"
        />

        <Text style={styles.label}>Currently Saved Amount (₹)</Text>
        <TextInput
          style={styles.input}
          value={saved}
          onChangeText={setSaved}
          keyboardType="numeric"
          placeholder="200000"
        />

        <Text style={styles.label}>Link an account</Text>
        <ScrollView horizontal>
          <TouchableOpacity onPress={() => setAccountId('')}>
            <Text style={styles.label}>None · </Text>
          </TouchableOpacity>
          {accounts.map((account) => (
            <TouchableOpacity
              key={account.id}
              onPress={() => {
                setAccountId(account.id);
                setAssetName(account.name);
              }}
            >
              <Text style={styles.label}>
                {String(accountId) === String(account.id) ? '✓ ' : ''}
                {account.name} ·{' '}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Text style={styles.label}>Where is this saved? (Asset Name)</Text>
        <TextInput
          style={styles.input}
          value={assetName}
          onChangeText={setAssetName}
          placeholder="e.g. HDFC Mutual Fund, FD"
        />

        <Text style={styles.label}>Expected Annual Return / ROI (%)</Text>
        <TextInput
          style={styles.input}
          value={roi}
          onChangeText={setRoi}
          keyboardType="numeric"
          placeholder="10"
        />

        <Text style={styles.label}>Target Deadline</Text>
        <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker(true)}>
          <Ionicons name="calendar" size={20} color="#555" />
          <Text style={{ marginLeft: 10, fontSize: 16 }}>{date.toDateString()}</Text>
        </TouchableOpacity>
        {showPicker && (
          <DateTimePicker
            value={date}
            mode="date"
            onChange={(e, d) => {
              setShowPicker(false);
              if (d) setDate(d);
            }}
          />
        )}

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
          <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 18 }}>
            {existing ? 'Update Goal' : 'Create Goal'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20 },
  title: { fontSize: 20, fontWeight: 'bold' },
  label: { marginTop: 15, marginBottom: 5, color: '#666', fontWeight: 'bold' },
  input: { borderBottomWidth: 1, borderColor: '#ccc', fontSize: 16, paddingVertical: 8 },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 15,
    borderRadius: 10,
    marginTop: 5,
  },
  saveBtn: { backgroundColor: '#2196F3', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 30 },
});
