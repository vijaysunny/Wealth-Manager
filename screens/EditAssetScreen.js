import { Text, View, TouchableOpacity, TextInput, ScrollView, SafeAreaView } from '../components/Theme';
import React, { useState } from 'react';
import { StyleSheet, Alert } from 'react-native';

import { updateAccount } from '../data/Storage';
import { deleteAccount } from '../data/Collections';
import { Ionicons } from '@expo/vector-icons';

// Quantity-based assets. AddAsset stores stocks/gold as type 'Investment' with the
// real kind in subType; older saved assets may still carry the kind in type.
const QTY_KINDS = ['Mutual Fund', 'Stocks / Equity', 'Gold / Silver'];
const isQuantityAsset = (a) => QTY_KINDS.includes(a.subType) || QTY_KINDS.includes(a.type);

export default function EditAssetScreen({ navigation, route }) {
  const { asset } = route.params;

  const [name, setName] = useState(asset.name);
  // For Banks/Cash, 'balance' is what we edit. For Stocks/MF, 'quantity' is what we edit.
  const [value, setValue] = useState(
      isQuantityAsset(asset)
      ? (asset.quantity ? asset.quantity.toString() : '0') 
      : (asset.balance ? asset.balance.toString() : '0')
  );

  const handleSave = async () => {
    if (!name || !value) { Alert.alert("Error", "Fields cannot be empty"); return; }

    const number = Number(String(value).replace(/,/g,''));
    if(!Number.isFinite(number) || number < 0){Alert.alert('Error','Enter a valid non-negative value');return;}
    const changes={name:name.trim(),[isQuantityAsset(asset)?'quantity':'balance']:number};
    await updateAccount(asset.id,changes);
    navigation.goBack();
  };

  const handleDelete = () => {
    Alert.alert("Delete Asset", "Are you sure? This cannot be undone.", [
        { text: "Cancel" },
        { text: "Delete", style: 'destructive', onPress: async () => {
            await deleteAccount(asset.id);
            navigation.goBack();
        }}
    ]);
  };

  const isInvestment = isQuantityAsset(asset);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color="#333"/>
        </TouchableOpacity>
        <Text style={styles.title}>Edit Asset</Text>
        <TouchableOpacity onPress={handleDelete}>
            <Ionicons name="trash" size={24} color="red"/>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{padding: 20}}>
          <Text style={styles.label}>ASSET NAME</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} />

          <Text style={styles.label}>
            {isInvestment ? 'UNITS / QUANTITY HELD' : 'CURRENT BALANCE (₹)'}
          </Text>
          <TextInput 
            style={[styles.input, {fontSize: 24, fontWeight: 'bold'}]} 
            value={value} 
            onChangeText={setValue} 
            keyboardType="numeric"
          />
          
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
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderColor: '#eee', alignItems:'center' },
  title: { fontSize: 20, fontWeight: 'bold' },
  label: { color: '#666', fontSize: 12, fontWeight: 'bold', marginTop: 20, marginBottom: 5 },
  input: { borderBottomWidth: 1, borderColor: '#ccc', fontSize: 18, paddingVertical: 10, color: '#333' },
  saveBtn: { backgroundColor: '#2196F3', padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 40 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  hint: { color: '#999', fontSize: 12, marginTop: 10, fontStyle: 'italic' }
});