import { Text, View, TextInput, TouchableOpacity, SafeAreaView } from '../components/Theme';
import React, { useState } from 'react';
import { StyleSheet, FlatList, ActivityIndicator } from 'react-native';

import { Ionicons } from '@expo/vector-icons';

export default function SearchAssetScreen({ navigation }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (text) => {
    setQuery(text);
    if (text.length < 3) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      // FREE API provided by mfapi.in
      const response = await fetch(`https://api.mfapi.in/mf/search?q=${text}`);
      const json = await response.json();
      setResults(json); 
    } catch (error) {
      console.log(error);
    }
    setLoading(false);
  };

  const handleSelect = (item) => {
    // Pass the selected data back to the previous screen
    navigation.navigate('AddAsset', { 
      selectedScheme: {
        code: item.schemeCode,
        name: item.schemeName
      }
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header with Search Bar */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color="#666" style={{marginRight: 8}} />
          <TextInput 
            style={styles.input} 
            placeholder="Search Fund (e.g. Parag Parikh)" 
            value={query}
            onChangeText={handleSearch}
            autoFocus={true}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => { setQuery(''); setResults([]); }}>
               <Ionicons name="close-circle" size={18} color="#999" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Loading Indicator */}
      {loading && (
        <View style={{padding: 20}}>
           <ActivityIndicator size="small" color="#2196F3" />
        </View>
      )}

      {/* Results List */}
      <FlatList 
        data={results}
        keyExtractor={(item) => item.schemeCode.toString()}
        keyboardShouldPersistTaps="always"
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.item} onPress={() => handleSelect(item)}>
            <Text style={styles.schemeName}>{item.schemeName}</Text>
            <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 4}}>
              <View style={styles.badge}>
                 <Text style={styles.badgeText}>MF</Text>
              </View>
              <Text style={styles.schemeCode}>Code: {item.schemeCode}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderColor: '#eee' },
  searchContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f0f0', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginLeft: 15 },
  input: { flex: 1, fontSize: 16 },
  item: { padding: 15, borderBottomWidth: 1, borderColor: '#f9f9f9' },
  schemeName: { fontSize: 15, fontWeight: '500', color: '#333' },
  schemeCode: { fontSize: 12, color: '#999', marginLeft: 8 },
  badge: { backgroundColor: '#e3f2fd', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeText: { fontSize: 10, color: '#2196f3', fontWeight: 'bold' }
});