import { Text, View, ScrollView, TouchableOpacity, TextInput, SafeAreaView } from '../components/Theme';
/**
 * RecurringScreen.js
 * Manage recurring transactions: subscriptions, EMIs, salary, rent, SIPs.
 * Recurring entries are auto-created on their due date by RecurringEngine.
 */

import React, { useState, useCallback } from 'react';
import { StyleSheet, Modal, Alert, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '../data/Storage';
import { useFocusEffect } from '@react-navigation/native';
import { initialNextDue } from '../utils/RecurringEngine';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FREQ_OPTS = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'];
const TYPE_OPTS = ['expense', 'income'];
const ICON_MAP = {
  'Netflix': 'logo-youtube',
  'Spotify': 'musical-notes',
  'EMI': 'card',
  'Rent': 'home',
  'Salary': 'briefcase',
  'SIP': 'trending-up',
  'Insurance': 'shield-checkmark',
  'Electricity': 'flash',
  'Phone': 'phone-portrait',
  'Internet': 'wifi'
};
const iconFor = title => {
  for (const [k, v] of Object.entries(ICON_MAP)) {
    if (title.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return 'repeat';
};
export default function RecurringScreen({
  navigation
}) {
  const [entries, setEntries] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    title: '',
    amount: '',
    type: 'expense',
    frequency: 'Monthly',
    dayOfMonth: '1',
    category: 'Bills',
    account: '',
    active: true
  });
  useFocusEffect(useCallback(() => {
    load();
  }, []));
  const load = async () => {
    const json = await AsyncStorage.getItem('recurring_transactions');
    setEntries(json ? JSON.parse(json) : []);
  };
  const openAdd = () => {
    setEditing(null);
    setForm({
      title: '',
      amount: '',
      type: 'expense',
      frequency: 'Monthly',
      dayOfMonth: '1',
      category: 'Bills',
      account: '',
      active: true,
      weekday: new Date().getDay()
    });
    setModalVisible(true);
  };
  const openEdit = entry => {
    setEditing(entry.id);
    setForm({
      ...entry,
      amount: String(entry.amount),
      dayOfMonth: String(entry.dayOfMonth)
    });
    setModalVisible(true);
  };
  const save = async () => {
    if (!form.title.trim()) {
      Alert.alert('Error', 'Enter a title');
      return;
    }
    if (!form.amount || isNaN(parseFloat(form.amount))) {
      Alert.alert('Error', 'Enter a valid amount');
      return;
    }
    const old = editing ? entries.find(e => e.id === editing) : null;
    const now = new Date();
    const item = {
      id: editing || Date.now() + Math.random(),
      title: form.title.trim(),
      amount: parseFloat(form.amount),
      type: form.type,
      frequency: form.frequency,
      dayOfMonth: Math.min(31, Math.max(1, parseInt(form.dayOfMonth) || 1)),
      weekday: form.frequency === 'Weekly' ? Number.isInteger(form.weekday) ? form.weekday : now.getDay() : undefined,
      month: form.frequency === 'Yearly' ? Number.isInteger(form.month) ? form.month : now.getMonth() : undefined,
      category: form.category || 'General',
      account: form.account || 'Cash',
      active: form.active,
      createdAt: old ? old.createdAt : now.toISOString(),
      lastProcessed: old ? old.lastProcessed : null
    };
    // nextDue drives the engine: keep it while the schedule is unchanged, else restart from today
    const scheduleChanged = !old || ['frequency', 'dayOfMonth', 'weekday', 'month'].some(k => old[k] !== item[k]);
    item.nextDue = old && !scheduleChanged ? old.nextDue : initialNextDue(item, now);
    const existing = entries.filter(e => e.id !== editing);
    const updated = [...existing, item];
    await AsyncStorage.setItem('recurring_transactions', JSON.stringify(updated));
    setEntries(updated);
    setModalVisible(false);
  };
  const deleteEntry = id => {
    Alert.alert('Delete', 'Remove this recurring entry?', [{
      text: 'Cancel'
    }, {
      text: 'Delete',
      style: 'destructive',
      onPress: async () => {
        const updated = entries.filter(e => e.id !== id);
        await AsyncStorage.setItem('recurring_transactions', JSON.stringify(updated));
        setEntries(updated);
      }
    }]);
  };
  const toggleActive = async id => {
    // Resuming must not back-fill the paused period: restart the schedule from today
    const updated = entries.map(e => e.id !== id ? e : e.active ? {
      ...e,
      active: false
    } : {
      ...e,
      active: true,
      nextDue: initialNextDue(e, new Date())
    });
    await AsyncStorage.setItem('recurring_transactions', JSON.stringify(updated));
    setEntries(updated);
  };
  const totalMonthly = entries.filter(e => e.active && e.frequency === 'Monthly').reduce((s, e) => e.type === 'income' ? s + e.amount : s - e.amount, 0);
  return <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.title}>Recurring</Text>
        <TouchableOpacity onPress={openAdd}>
          <Ionicons name="add-circle" size={28} color="#2196F3" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{
      paddingBottom: 30
    }}>

        {/* Summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Net Monthly Recurring</Text>
          <Text style={[styles.summaryAmount, {
          color: totalMonthly >= 0 ? '#4CAF50' : '#F44336'
        }]}>
            ₹ {Math.abs(totalMonthly).toLocaleString('en-IN')}
            {totalMonthly >= 0 ? ' surplus' : ' outflow'}
          </Text>
          <Text style={styles.summarySub}>{entries.filter(e => e.active).length} active · {entries.filter(e => !e.active).length} paused</Text>
        </View>

        {/* Income Recurring */}
        {entries.filter(e => e.type === 'income').length > 0 && <View style={styles.section}>
            <Text style={styles.sectionTitle}>📥 Income</Text>
            {entries.filter(e => e.type === 'income').map(e => <RecurCard key={e.id} entry={e} onEdit={openEdit} onDelete={deleteEntry} onToggle={toggleActive} />)}
          </View>}

        {/* Expense Recurring */}
        {entries.filter(e => e.type === 'expense').length > 0 && <View style={styles.section}>
            <Text style={styles.sectionTitle}>📤 Expenses</Text>
            {entries.filter(e => e.type === 'expense').map(e => <RecurCard key={e.id} entry={e} onEdit={openEdit} onDelete={deleteEntry} onToggle={toggleActive} />)}
          </View>}

        {entries.length === 0 && <View style={styles.emptyState}>
            <Ionicons name="repeat-outline" size={60} color="#ccc" />
            <Text style={styles.emptyTitle}>No Recurring Entries</Text>
            <Text style={styles.emptySub}>Add salary, EMI, subscriptions, SIPs to auto-track them</Text>
            <TouchableOpacity style={styles.addFirstBtn} onPress={openAdd}>
              <Text style={styles.addFirstText}>Add First Entry</Text>
            </TouchableOpacity>
          </View>}

      </ScrollView>

      {/* Add/Edit Modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{
        flex: 1,
        backgroundColor: '#fff'
      }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Ionicons name="close" size={26} color="#666" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{editing ? 'Edit' : 'Add'} Recurring</Text>
            <TouchableOpacity onPress={save}>
              <Text style={{
              color: '#2196F3',
              fontWeight: 'bold',
              fontSize: 16
            }}>Save</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{
          padding: 20
        }}>
            <Text style={styles.label}>Title</Text>
            <TextInput style={styles.input} value={form.title} onChangeText={v => setForm({
            ...form,
            title: v
          })} placeholder="e.g. Netflix, EMI, Salary" />

            <Text style={styles.label}>Amount (₹)</Text>
            <TextInput style={styles.input} value={form.amount} onChangeText={v => setForm({
            ...form,
            amount: v
          })} keyboardType="numeric" placeholder="0.00" />

            <Text style={styles.label}>Type</Text>
            <View style={styles.toggleRow}>
              {TYPE_OPTS.map(t => <TouchableOpacity key={t} style={[styles.toggleBtn, form.type === t && {
              backgroundColor: t === 'income' ? '#E8F5E9' : '#FFEBEE',
              borderColor: t === 'income' ? '#4CAF50' : '#F44336'
            }]} onPress={() => setForm({
              ...form,
              type: t
            })}>
                  <Text style={[styles.toggleText, form.type === t && {
                color: t === 'income' ? '#388E3C' : '#C62828',
                fontWeight: 'bold'
              }]}>{t === 'income' ? '📥 Income' : '📤 Expense'}</Text>
                </TouchableOpacity>)}
            </View>

            <Text style={styles.label}>Frequency</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{
            marginBottom: 16
          }}>
              {FREQ_OPTS.map(f => <TouchableOpacity key={f} style={[styles.chip, form.frequency === f && {
              backgroundColor: '#2196F3',
              borderColor: '#2196F3'
            }]} onPress={() => setForm({
              ...form,
              frequency: f
            })}>
                  <Text style={[styles.chipText, form.frequency === f && {
                color: '#fff'
              }]}>{f}</Text>
                </TouchableOpacity>)}
            </ScrollView>

            {form.frequency === 'Weekly' && <>
                <Text style={styles.label}>Day of Week</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{
              marginBottom: 16
            }}>
                  {WEEKDAYS.map((w, i) => <TouchableOpacity key={w} style={[styles.chip, form.weekday === i && {
                backgroundColor: '#2196F3',
                borderColor: '#2196F3'
              }]} onPress={() => setForm({
                ...form,
                weekday: i
              })}>
                      <Text style={[styles.chipText, form.weekday === i && {
                  color: '#fff'
                }]}>{w}</Text>
                    </TouchableOpacity>)}
                </ScrollView>
              </>}

            {(form.frequency === 'Monthly' || form.frequency === 'Quarterly' || form.frequency === 'Yearly') && <>
                <Text style={styles.label}>Day of Month</Text>
                <TextInput style={styles.input} value={form.dayOfMonth} onChangeText={v => setForm({
              ...form,
              dayOfMonth: v
            })} keyboardType="numeric" placeholder="1-31" />
              </>}

            <Text style={styles.label}>Category</Text>
            <TextInput style={styles.input} value={form.category} onChangeText={v => setForm({
            ...form,
            category: v
          })} placeholder="e.g. Bills, Salary, Investment" />

            <Text style={styles.label}>Account</Text>
            <TextInput style={styles.input} value={form.account} onChangeText={v => setForm({
            ...form,
            account: v
          })} placeholder="e.g. HDFC Bank, PhonePe" />

            <View style={styles.switchRow}>
              <Text style={styles.label}>Active</Text>
              <Switch value={form.active} onValueChange={v => setForm({
              ...form,
              active: v
            })} trackColor={{
              true: '#2196F3'
            }} />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>;
}
function RecurCard({
  entry,
  onEdit,
  onDelete,
  onToggle
}) {
  const color = entry.type === 'income' ? '#4CAF50' : '#F44336';
  const icon = iconFor(entry.title);
  return <TouchableOpacity style={styles.card} onPress={() => onEdit(entry)}>
      <View style={[styles.iconBox, {
      backgroundColor: color + '20'
    }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={{
      flex: 1
    }}>
        <Text style={styles.cardTitle}>{entry.title}</Text>
        <Text style={styles.cardSub}>{entry.frequency} · {entry.frequency === 'Weekly' && Number.isInteger(entry.weekday) ? WEEKDAYS[entry.weekday] : `Day ${entry.dayOfMonth}`} · {entry.account || 'Cash'}</Text>
      </View>
      <Text style={[styles.cardAmount, {
      color
    }]}>
        {entry.type === 'income' ? '+' : '-'} ₹{entry.amount.toLocaleString('en-IN')}
      </Text>
      <TouchableOpacity style={{
      marginLeft: 8
    }} onPress={() => onToggle(entry.id)}>
        <Ionicons name={entry.active ? 'pause-circle-outline' : 'play-circle-outline'} size={22} color="#888" />
      </TouchableOpacity>
      <TouchableOpacity style={{
      marginLeft: 4
    }} onPress={() => onDelete(entry.id)}>
        <Ionicons name="trash-outline" size={20} color="#F44336" />
      </TouchableOpacity>
    </TouchableOpacity>;
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff'
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333'
  },
  summaryCard: {
    margin: 16,
    padding: 20,
    backgroundColor: '#1A1A2E',
    borderRadius: 18,
    alignItems: 'center'
  },
  summaryLabel: {
    color: '#aaa',
    fontSize: 13,
    marginBottom: 6
  },
  summaryAmount: {
    fontSize: 30,
    fontWeight: 'bold',
    marginBottom: 4
  },
  summarySub: {
    color: '#666',
    fontSize: 12
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 8
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#444',
    marginBottom: 10,
    marginTop: 6
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    elevation: 1
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12
  },
  cardTitle: {
    fontWeight: '600',
    color: '#333',
    fontSize: 15
  },
  cardSub: {
    fontSize: 11,
    color: '#888',
    marginTop: 2
  },
  cardAmount: {
    fontWeight: 'bold',
    fontSize: 14
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 30
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#999',
    marginTop: 16
  },
  emptySub: {
    color: '#bbb',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20
  },
  addFirstBtn: {
    marginTop: 20,
    backgroundColor: '#2196F3',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24
  },
  addFirstText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderColor: '#eee'
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold'
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
    marginBottom: 6,
    marginTop: 12
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#333'
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4
  },
  toggleBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center'
  },
  toggleText: {
    fontSize: 14,
    color: '#555'
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ddd',
    marginRight: 8,
    backgroundColor: '#fafafa'
  },
  chipText: {
    fontSize: 13,
    color: '#555'
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12
  }
});
