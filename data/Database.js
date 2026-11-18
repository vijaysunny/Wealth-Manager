import * as SQLite from 'expo-sqlite';
import LegacyStorage from '@react-native-async-storage/async-storage';
let opening;
let queue = Promise.resolve();
export const serialized = (task) => {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
};
export const encodeTransaction = (tx) => {
  const { date, ...record } = tx;
  if (!record.id || !Number.isFinite(Number(record.amount)) || Number(record.amount) <= 0 || !['expense', 'income', 'transfer'].includes(record.type)) throw new Error('Invalid transaction');
  record.fullDate = new Date(record.fullDate || date).toISOString();
  return record;
};
export const sourceId = (tx) => tx.smsId ? `sms:${tx.smsId}` : tx.gmailMsgId ? `gmail:${tx.gmailMsgId}` : String(tx.id).startsWith('rec_') ? String(tx.id) : null;
export const insertRow = (db, tx) => {
  const record = encodeTransaction(tx);
  return db.runAsync('INSERT OR IGNORE INTO transactions (id, sourceId, fullDate, category, account, type, amount, excluded, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    String(record.id), sourceId(record), record.fullDate, record.category || '', record.account || '', record.type, Number(record.amount), record.excludeFromReports ? 1 : 0, JSON.stringify(record));
};
export const decodeRow = (row) => {
  const tx = JSON.parse(row.data);
  return { ...tx, date: new Date(tx.fullDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) };
};
export const getDatabase = () => {
  if (!opening) opening = (async () => {
    const db = await SQLite.openDatabaseAsync('wealthmanager.db');
    await db.execAsync(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;
      CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, sourceId TEXT, fullDate TEXT NOT NULL, category TEXT, account TEXT, type TEXT, amount REAL, excluded INTEGER DEFAULT 0, data TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS transaction_source ON transactions(sourceId) WHERE sourceId IS NOT NULL;
      CREATE INDEX IF NOT EXISTS transaction_date ON transactions(fullDate);
      CREATE INDEX IF NOT EXISTS transaction_category ON transactions(category);
      CREATE INDEX IF NOT EXISTS transaction_account ON transactions(account);
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recurring (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`);
    const migrated = await db.getFirstAsync("SELECT value FROM settings WHERE key = 'sqlite_migrated_v1'");
    if (!migrated) {
      await LegacyStorage.removeItem('gmail_oauth_token');
      const pairs = await LegacyStorage.multiGet(await LegacyStorage.getAllKeys());
      const legacy = Object.fromEntries(pairs);
      const transactions = JSON.parse(legacy.user_transactions || '[]');
      if (!Array.isArray(transactions)) throw new Error('Legacy transaction data is malformed; migration aborted.');
      await LegacyStorage.setItem('user_transactions_backup', legacy.user_transactions || '[]');
      // Keep an exportable complete pre-migration snapshot outside the database.
      await LegacyStorage.setItem('sqlite_migration_backup', JSON.stringify(legacy));
      await db.withExclusiveTransactionAsync(async (txn) => {
        for (const tx of transactions) {
          if ((await insertRow(txn, tx)).changes !== 1) throw new Error('Migration found duplicate IDs. Original data retained; resolve duplicates before retrying.');
        }
        for (const key of ['user_wealth_accounts', 'recurring_transactions']) {
          const table = key === 'user_wealth_accounts' ? 'accounts' : 'recurring';
          for (const row of JSON.parse(legacy[key] || '[]')) await txn.runAsync(`INSERT INTO ${table}(id, data) VALUES (?, ?)`, String(row.id), JSON.stringify(row));
        }
        for (const [key, value] of pairs) {
          if (value !== null && !['user_transactions', 'user_wealth_accounts', 'recurring_transactions', 'gmail_oauth_token'].includes(key))
            await txn.runAsync('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)', key, value);
        }
        const count = await txn.getFirstAsync('SELECT COUNT(*) AS count FROM transactions');
        if (count.count !== transactions.length) throw new Error('Migration count mismatch');
        await txn.runAsync("INSERT INTO settings(key, value) VALUES ('sqlite_migrated_v1', 'true')");
      });
    }
    return db;
  })().catch(error => { opening = null; throw error; });
  return opening;
};
export const atomic = (task) => serialized(async () => {
  const db = await getDatabase();
  let result;
  await db.withExclusiveTransactionAsync(async txn => { result = await task(txn); });
  return result;
});
