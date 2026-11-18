import { View, Text, TextInput, TouchableOpacity, ScrollView } from './Theme';
import React from 'react';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// 1. STANDARD TEXT INPUT
export const AmountInput = ({ value, onChange }) => (
  <View style={styles.amountContainer}>
    <Text style={styles.currencySymbol}>₹</Text>
    <TextInput 
      style={styles.amountInput} 
      value={value} 
      onChangeText={onChange} 
      placeholder="0" 
      keyboardType="numeric" 
      autoFocus={true}
    />
  </View>
);

// 2. CATEGORY PILLS (Selection Chips)
export const CategorySelector = ({ selected, onSelect, categories }) => (
  <View style={styles.section}>
    <Text style={styles.label}>Category</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {categories.map((cat, index) => (
        <TouchableOpacity 
          key={index} 
          style={[styles.chip, selected === cat && styles.chipSelected]}
          onPress={() => onSelect(cat)}
        >
          <Text style={[styles.chipText, selected === cat && styles.chipTextSelected]}>
            {cat}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  </View>
);

// 3. ACCOUNT SELECTOR (Cash / Card / Bank)
export const AccountSelector = ({ selected, onSelect }) => (
  <View style={styles.section}>
    <Text style={styles.label}>Payment Mode</Text>
    <View style={styles.row}>
      {['Cash', 'Bank', 'Credit Card'].map((mode) => (
        <TouchableOpacity 
          key={mode} 
          style={[styles.cardOption, selected === mode && styles.cardSelected]}
          onPress={() => onSelect(mode)}
        >
          <Ionicons 
            name={mode === 'Cash' ? 'cash-outline' : mode === 'Bank' ? 'business-outline' : 'card-outline'} 
            size={20} 
            color={selected === mode ? '#fff' : '#666'} 
          />
          <Text style={[styles.cardText, selected === mode && styles.cardTextSelected]}>{mode}</Text>
        </TouchableOpacity>
      ))}
    </View>
  </View>
);

const styles = StyleSheet.create({
  amountContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  currencySymbol: { fontSize: 30, color: '#333', fontWeight: 'bold' },
  amountInput: { fontSize: 40, fontWeight: 'bold', color: '#333', minWidth: 100, textAlign: 'center' },
  section: { marginBottom: 20 },
  label: { fontSize: 14, color: '#888', marginBottom: 10, marginLeft: 5 },
  chip: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: '#f0f0f0', marginRight: 10 },
  chipSelected: { backgroundColor: '#2196f3' },
  chipText: { color: '#666' },
  chipTextSelected: { color: '#fff', fontWeight: 'bold' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  cardOption: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 12, backgroundColor: '#f0f0f0', borderRadius: 12, marginHorizontal: 4 },
  cardSelected: { backgroundColor: '#2c3e50' },
  cardText: { marginLeft: 5, color: '#666' },
  cardTextSelected: { color: '#fff', fontWeight: 'bold' }
});