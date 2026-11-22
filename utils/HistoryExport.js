import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { historyCsv } from './FinanceTools';
import { suppressNextLock } from './LockSuppress';
export const exportHistory = async (rows, format = 'csv') => {
  const uri = FileSystem.cacheDirectory + `wealthmanager_history.${format}`;
  if (format === 'xlsx') {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        rows.map((tx) => ({
          Date: tx.fullDate,
          Title: tx.title,
          Type: tx.type,
          Amount: tx.amount,
          Category: tx.category,
          Account: tx.account,
        }))
      ),
      'Transactions'
    );
    await FileSystem.writeAsStringAsync(uri, XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' }), {
      encoding: FileSystem.EncodingType.Base64,
    });
  } else await FileSystem.writeAsStringAsync(uri, historyCsv(rows));
  if (await Sharing.isAvailableAsync()) {
    suppressNextLock();
    await Sharing.shareAsync(uri);
  } else throw new Error('Sharing is unavailable on this device');
};

/** Writes `text` to a cache file and opens the share sheet (C3 loan CSV). */
export const shareCsv = async (fileName, text) => {
  const uri = FileSystem.cacheDirectory + fileName;
  await FileSystem.writeAsStringAsync(uri, text);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device');
  suppressNextLock();
  await Sharing.shareAsync(uri, { mimeType: 'text/csv' });
};
