import { putAccount } from '../data/Collections';
import { Text, View, TouchableOpacity, TextInput, ScrollView, SafeAreaView } from '../components/Theme';
import React, { useState, useEffect } from 'react';
import { StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchMutualFundNAV, fetchStockPrice } from '../utils/InvestmentApi';
import DateTimePicker from '@react-native-community/datetimepicker';
import { parseAmount, parseNonNegative } from '../utils/Format';
export default function AddAssetScreen({
  navigation,
  route
}) {
  // Common State
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [type, setType] = useState('Mutual Fund');

  // Mutual Fund State
  const [schemeCode, setSchemeCode] = useState('');

  // Stocks/Gold State
  const [stockSymbol, setStockSymbol] = useState('');
  const [currentPrice, setCurrentPrice] = useState('');
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [goldType, setGoldType] = useState('Digital');
  const [makingCharges, setMakingCharges] = useState('0');

  // Loan State
  const [loanType, setLoanType] = useState('Reducing Balance');
  const [emiAmount, setEmiAmount] = useState('');
  const [startDate, setStartDate] = useState(new Date());
  const [tenure, setTenure] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [emisPaid, setEmisPaid] = useState(''); // <--- NEW STATE
  const [showPicker, setShowPicker] = useState(false);

  // Constants
  const types = ['Mutual Fund', 'Stocks / Equity', 'Gold / Silver', 'Bank Account', 'Fixed Deposit', 'Recurring Deposit', 'Cash', 'Wallet', 'Provident Fund', 'Loan', 'Credit Card', 'Real Estate'];
  const loanTypes = ['No Cost EMI', 'Reducing Balance', 'Flat Rate'];

  // Handle Return from Search Screen
  useEffect(() => {
    if (route.params?.selectedScheme) {
      setSchemeCode(route.params.selectedScheme.code.toString());
      setName(route.params.selectedScheme.name);
      setType('Mutual Fund');
    }
  }, [route.params]);

  // Fetch Live Price (Stocks/Gold)
  const handleFetchPrice = async () => {
    if (!stockSymbol) return;
    setFetchingPrice(true);
    const symbol = stockSymbol.toUpperCase().endsWith('.NS') || stockSymbol.toUpperCase().endsWith('.BO') ? stockSymbol.toUpperCase() : stockSymbol.toUpperCase() + '.NS';
    const data = await fetchStockPrice(symbol);
    if (data) {
      setCurrentPrice(data.price.toString());
      if (!name) setName(symbol);
      setStockSymbol(symbol);
    } else {
      Alert.alert("Not Found", "Check symbol. Try 'RELIANCE.NS'");
    }
    setFetchingPrice(false);
  };

  // --- NEW HELPER: Auto-Calculate Date from EMIs Paid ---
  const handleEmisPaidChange = text => {
    setEmisPaid(text);
    if (text) {
      const months = parseInt(text);
      const d = new Date();
      d.setMonth(d.getMonth() - months); // Go back X months
      setStartDate(d);
    } else {
      setStartDate(new Date()); // Reset to today if empty
    }
  };
  const handleSave = async () => {
    if (!name) {
      Alert.alert("Error", "Name required");
      return;
    }
    let finalBalance = 0;
    const qty = parseAmount(quantity); // > 0 or null
    let finalUnits = qty || 0;
    const price = parseAmount(currentPrice);
    const making = parseNonNegative(makingCharges) || 0;
    const rate = parseNonNegative(interestRate) || 0;
    const emi = parseAmount(emiAmount);
    const tenureMonths = parseInt(tenure, 10);

    // 1. MUTUAL FUND
    if (type === 'Mutual Fund') {
      if (!schemeCode) {
        Alert.alert("Error", "Please Search & Select a Fund");
        return;
      }
      if (!finalUnits) {
        Alert.alert("Error", "Enter a valid number of units");
        return;
      }
      const navData = await fetchMutualFundNAV(schemeCode);
      finalBalance = finalUnits * (navData ? navData.currentNav : 0);
    }
    // 2. STOCKS / GOLD
    else if (type === 'Stocks / Equity' || type === 'Gold / Silver') {
      if (!price || !finalUnits) {
        Alert.alert("Error", "Enter a valid quantity and price");
        return;
      }
      let baseVal = price * finalUnits;
      if (type === 'Gold / Silver' && goldType === 'Jewellery') {
        finalBalance = baseVal * 0.916 * (1 + making / 100);
      } else {
        finalBalance = baseVal;
      }
    }
    // 3. LOAN 
    else if (type === 'Loan') {
      if (!qty) {
        Alert.alert("Error", "Enter a valid loan amount");
        return;
      }
      finalBalance = qty;
    }
    // 4. OTHERS
    else {
      const bal = parseNonNegative(quantity); // a new account may legitimately start at 0
      if (bal === null) {
        Alert.alert("Error", "Enter a valid balance");
        return;
      }
      finalBalance = bal;
    }
    const newAsset = {
      id: Date.now(),
      name,
      type: type === 'Stocks / Equity' || type === 'Gold / Silver' ? 'Investment' : type,
      subType: type,
      balance: finalBalance,
      quantity: finalUnits,
      // Mutual Fund Specifics
      schemeCode: type === 'Mutual Fund' ? schemeCode : null,
      // Stock/Gold Specifics
      symbol: type === 'Stocks / Equity' || type === 'Gold / Silver' ? stockSymbol : null,
      goldType: type === 'Gold / Silver' ? goldType : null,
      makingCharges: type === 'Gold / Silver' ? making : 0,
      // Loan Specifics
      originalAmount: type === 'Loan' ? qty : null,
      loanType: type === 'Loan' ? loanType : null,
      emiAmount: type === 'Loan' ? emi || 0 : null,
      startDate: type === 'Loan' ? startDate.toISOString() : null,
      tenure: type === 'Loan' && Number.isFinite(tenureMonths) && tenureMonths > 0 ? tenureMonths : null,
      // PF / Loan Interest
      interestRate: rate
    };
    await putAccount(newAsset);
    navigation.goBack();
  };
  return <SafeAreaView style={styles.container}>
      <View style={styles.header}>
         <TouchableOpacity onPress={() => navigation.goBack()}><Ionicons name="close" size={28} /></TouchableOpacity>
         <Text style={styles.title}>Add Asset</Text>
         <View style={{
        width: 28
      }} />
      </View>

      <ScrollView contentContainerStyle={{
      paddingBottom: 40
    }}>
         <Text style={styles.sectionLabel}>CATEGORY</Text>
         <View style={styles.chipContainer}>
           {types.map(t => <TouchableOpacity key={t} onPress={() => setType(t)} style={[styles.chip, type === t && {
          backgroundColor: '#2196F3',
          borderColor: '#2196F3'
        }]}>
               <Text style={{
            color: type === t ? '#fff' : '#333'
          }}>{t}</Text>
             </TouchableOpacity>)}
         </View>

         {/* 1. MUTUAL FUND FORM */}
         {type === 'Mutual Fund' && <View style={styles.formSection}>
                 <TouchableOpacity onPress={() => navigation.navigate('SearchAsset')} style={styles.searchBtn}>
                    <Ionicons name="search" size={20} color="#fff" />
                    <Text style={{
            color: '#fff',
            fontWeight: 'bold',
            marginLeft: 10
          }}>Search Mutual Fund Scheme</Text>
                 </TouchableOpacity>
                 <Text style={styles.label}>Scheme Name</Text>
                 <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Selected Fund Name" />
                 <Text style={styles.label}>Total Units Held</Text>
                 <TextInput style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="numeric" placeholder="e.g. 450.5" />
             </View>}

         {/* 2. LOAN FORM (Updated) */}
         {type === 'Loan' && <View style={styles.formSection}>
                 <Text style={styles.label}>Loan Name</Text>
                 <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Home Loan" />

                 <Text style={styles.label}>Loan Type</Text>
                 <View style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          marginBottom: 10
        }}>
                    {loanTypes.map(lt => <TouchableOpacity key={lt} onPress={() => setLoanType(lt)} style={[styles.chip, loanType === lt && {
            backgroundColor: '#FF9800',
            borderColor: '#FF9800'
          }]}>
                           <Text style={{
              color: loanType === lt ? '#fff' : '#333',
              fontSize: 12
            }}>{lt}</Text>
                        </TouchableOpacity>)}
                 </View>

                 <Text style={styles.label}>Original Principal Amount (₹)</Text>
                 <TextInput style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="numeric" />

                 <View style={{
          flexDirection: 'row',
          justifyContent: 'space-between'
        }}>
                    <View style={{
            width: '48%'
          }}>
                        <Text style={styles.label}>EMI Amount (₹)</Text>
                        <TextInput style={styles.input} value={emiAmount} onChangeText={setEmiAmount} keyboardType="numeric" />
                    </View>
                    <View style={{
            width: '48%'
          }}>
                        <Text style={styles.label}>Interest Rate (%)</Text>
                        <TextInput style={styles.input} value={interestRate} onChangeText={setInterestRate} keyboardType="numeric" />
                    </View>
                 </View>

                 <View style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: 10
        }}>
                    <View style={{
            width: '48%'
          }}>
                        <Text style={styles.label}>Total Tenure (Months)</Text>
                        <TextInput style={styles.input} value={tenure} onChangeText={setTenure} keyboardType="numeric" />
                    </View>
                    {/* --- NEW FIELD: EMIs Paid --- */}
                    <View style={{
            width: '48%'
          }}>
                        <Text style={styles.label}>EMIs Paid Already</Text>
                        <TextInput style={[styles.input, {
              backgroundColor: '#E3F2FD',
              borderColor: '#2196F3'
            }]} value={emisPaid} onChangeText={handleEmisPaidChange} // Auto-updates Start Date
            keyboardType="numeric" placeholder="0" />
                    </View>
                 </View>

                 <Text style={styles.label}>Start Date (Auto-calculated)</Text>
                 <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker(true)}>
                    <Text>{startDate.toDateString()}</Text>
                    <Ionicons name="calendar" size={20} />
                 </TouchableOpacity>
                 {showPicker && <DateTimePicker value={startDate} mode="date" onChange={(e, d) => {
          setShowPicker(false);
          if (d) {
            setStartDate(d);
            setEmisPaid('');
          }
        }} /> // Clear EMIs paid if manual date picked
        }
                 
                 {emisPaid ? <Text style={styles.hint}>* Date set to {emisPaid} months ago.</Text> : null}
             </View>}

         {/* 3. PROVIDENT FUND FORM */}
         {type === 'Provident Fund' && <View style={styles.formSection}>
                 <Text style={styles.label}>Account Name</Text>
                 <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. EPF / PPF" />
                 <Text style={styles.label}>Current Balance (₹)</Text>
                 <TextInput style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="numeric" />
                 <Text style={styles.label}>Annual Interest Rate (%)</Text>
                 <TextInput style={styles.input} value={interestRate} onChangeText={setInterestRate} keyboardType="numeric" placeholder="8.25" />
             </View>}

         {/* 4. STOCKS / GOLD FORM */}
         {(type === 'Stocks / Equity' || type === 'Gold / Silver') && <View style={styles.formSection}>
                 {type === 'Gold / Silver' && <View style={{
          flexDirection: 'row',
          marginBottom: 15
        }}>
                        {['Digital', 'Jewellery'].map(gt => <TouchableOpacity key={gt} onPress={() => setGoldType(gt)} style={[styles.chip, {
            width: '48%',
            alignItems: 'center'
          }, goldType === gt && {
            backgroundColor: '#FFC107',
            borderColor: '#FFC107'
          }]}>
                                <Text style={{
              fontWeight: 'bold',
              color: goldType === gt ? '#000' : '#666'
            }}>{gt}</Text>
                            </TouchableOpacity>)}
                    </View>}
                 <Text style={styles.label}>{type === 'Gold / Silver' ? 'Live Rate Symbol' : 'Stock Symbol'}</Text>
                 <View style={{
          flexDirection: 'row'
        }}>
                    <TextInput style={[styles.input, {
            flex: 1
          }]} value={stockSymbol} onChangeText={setStockSymbol} placeholder={type === 'Gold / Silver' ? "e.g. GOLDBEES.NS" : "e.g. RELIANCE.NS"} />
                    <TouchableOpacity onPress={handleFetchPrice} style={styles.fetchBtn}>
                        {fetchingPrice ? <ActivityIndicator color="#fff" /> : <Text style={{
              color: '#fff',
              fontWeight: 'bold'
            }}>FETCH</Text>}
                    </TouchableOpacity>
                 </View>
                 <Text style={styles.label}>Display Name</Text>
                 <TextInput style={styles.input} value={name} onChangeText={setName} />
                 <View style={{
          flexDirection: 'row',
          justifyContent: 'space-between'
        }}>
                    <View style={{
            width: '48%'
          }}>
                        <Text style={styles.label}>{type === 'Gold / Silver' ? 'Weight (g)' : 'Quantity'}</Text>
                        <TextInput style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="numeric" />
                    </View>
                    <View style={{
            width: '48%'
          }}>
                        <Text style={styles.label}>Current Price</Text>
                        <TextInput style={styles.input} value={currentPrice} onChangeText={setCurrentPrice} keyboardType="numeric" />
                    </View>
                 </View>
                 {type === 'Gold / Silver' && goldType === 'Jewellery' && <View style={{
          marginTop: 10
        }}>
                        <Text style={styles.label}>Making Charges (%)</Text>
                        <TextInput style={styles.input} value={makingCharges} onChangeText={setMakingCharges} keyboardType="numeric" />
                    </View>}
             </View>}

         {/* 5. DEFAULT FORM */}
         {['Bank Account', 'Credit Card', 'Real Estate', 'Fixed Deposit', 'Recurring Deposit', 'Cash', 'Wallet'].includes(type) && <View style={styles.formSection}>
                 <Text style={styles.label}>Name</Text>
                 <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. HDFC Savings" />
                 <Text style={styles.label}>Current Balance / Value (₹)</Text>
                 <TextInput style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="numeric" />
             </View>}

         <TouchableOpacity style={[styles.saveBtn, {
        backgroundColor: type === 'Loan' ? '#D32F2F' : '#2196F3'
      }]} onPress={handleSave}>
             <Text style={{
          color: '#fff',
          fontWeight: 'bold',
          fontSize: 16
        }}>Save {type === 'Loan' ? 'Liability' : 'Asset'}</Text>
         </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>;
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold'
  },
  sectionLabel: {
    fontSize: 12,
    color: '#999',
    fontWeight: 'bold',
    marginBottom: 10
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 20
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#ccc'
  },
  formSection: {
    backgroundColor: '#f9f9f9',
    padding: 15,
    borderRadius: 10
  },
  label: {
    marginTop: 15,
    marginBottom: 5,
    color: '#555',
    fontWeight: 'bold',
    fontSize: 12
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 16,
    padding: 10,
    borderRadius: 8
  },
  searchBtn: {
    backgroundColor: '#333',
    padding: 15,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10
  },
  dateBtn: {
    padding: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  fetchBtn: {
    backgroundColor: '#333',
    paddingHorizontal: 15,
    justifyContent: 'center',
    marginLeft: 10,
    borderRadius: 8,
    height: 50,
    marginTop: 25
  },
  saveBtn: {
    marginTop: 30,
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2
    },
    shadowOpacity: 0.2,
    elevation: 3
  },
  hint: {
    fontSize: 11,
    color: '#2196F3',
    marginTop: 5,
    fontStyle: 'italic'
  }
});
