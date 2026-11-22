import { mutateList } from '../data/Collections';
import { addMany } from '../data/TransactionRepo';
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '../data/Storage';
import { Alert } from 'react-native';
import { suppressNextLock } from './LockSuppress';
export const importAxioData = async () => {
  try {
    console.log('--- STARTING IMPORT ---');
    suppressNextLock();
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
    });
    if (result.canceled)
      return {
        success: false,
      };
    const uri = result.assets[0].uri;
    const fileContent = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const workbook = XLSX.read(fileContent, {
      type: 'base64',
    });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet);
    if (rawData.length === 0) {
      Alert.alert('Error', 'File appears empty.');
      return {
        success: false,
      };
    }

    // --- PRE-LOAD DATA ---

    const existingAccJson = await AsyncStorage.getItem('user_wealth_accounts');
    const existingAcc = existingAccJson ? JSON.parse(existingAccJson) : [];

    // Load Categories
    const existingCatJson = await AsyncStorage.getItem('user_categories');
    const existingCats = existingCatJson ? JSON.parse(existingCatJson) : ['General'];
    const categorySet = new Set(existingCats);
    const transactions = [];
    const newAccounts = new Set();
    let importedCount = 0;
    let skippedCount = 0;
    let catsUpdated = false;
    rawData.forEach((row) => {
      const dateStr = row.DATE;
      const amountVal = row.AMOUNT;
      const note = row.PLACE || row.NOTE || row.Narration || 'Imported Txn';
      const typeRaw = row['DR/CR'];
      const accountName = row.ACCOUNT || 'Cash';
      let rawCat = row.CATEGORY === 'UNKNOWN' ? 'General' : row.CATEGORY || 'General';

      // Add new category if missing
      if (!categorySet.has(rawCat)) {
        categorySet.add(rawCat);
        existingCats.push(rawCat);
        catsUpdated = true;
      }
      if (!dateStr || !amountVal) {
        skippedCount++;
        return;
      }
      let amount = parseFloat(amountVal);
      if (typeof amountVal === 'string') {
        amount = parseFloat(amountVal.replace(/,/g, ''));
      }
      let type = 'expense';
      if (typeRaw === 'CR') type = 'income';

      // Parse Date
      let dateObj;
      if (typeof dateStr === 'number') {
        const excelBase = Date.UTC(1899, 11, 30);
        const dateMs = excelBase + dateStr * 24 * 60 * 60 * 1000;
        dateObj = new Date(dateMs);
      } else {
        dateObj = new Date(dateStr);
      }
      if (isNaN(dateObj.getTime())) {
        skippedCount++;
        return;
      }
      const newTx = {
        id: Date.now() + Math.random(),
        title: note,
        amount: Math.abs(amount),
        type: type,
        date: dateObj.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
        fullDate: dateObj.toISOString(),
        category: rawCat,
        account: accountName,
        tags: ['Axio-Import'],
        imported: true,
      };
      transactions.push(newTx);
      newAccounts.add(accountName);
      importedCount++;
    });

    // 5. SAVE & SORT (FIXED)

    const saved = await addMany(transactions, { balanceMode: 'none' });
    skippedCount += saved.skipped;
    importedCount = saved.added;

    // 6. Save Accounts
    let accUpdated = false;
    newAccounts.forEach((accName) => {
      if (!existingAcc.some((a) => a.name === accName)) {
        existingAcc.push({
          id: Date.now() + Math.random(),
          name: accName,
          type: 'Bank Account',
          // Default
          balance: 0,
        });
        accUpdated = true;
      }
    });
    if (accUpdated) {
      await mutateList('user_wealth_accounts', (current) => {
        const names = new Set(current.map((a) => a.name));
        return [...current, ...existingAcc.filter((a) => !names.has(a.name))];
      });
    }
    if (catsUpdated) {
      await mutateList('user_categories', (current) => [...new Set([...current, ...existingCats])]);
    }
    return {
      success: true,
      count: importedCount,
      skipped: skippedCount,
    };
  } catch (error) {
    console.log('Import Error:', error);
    return {
      success: false,
    };
  }
};
