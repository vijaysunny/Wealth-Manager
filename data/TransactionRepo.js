import { atomic, getDatabase, insertRow, decodeRow, encodeTransaction, sourceId } from './Database';
import { applyCategoryRules } from '../utils/FinanceTools';
import { readValue } from './Storage';
import { checkBudgetAlerts } from '../utils/MonthlyBudgets';
import { filterNew } from '../utils/DeduplicationEngine';
import { applyToAccounts, reverseOnAccounts, applyCapturedToAccounts } from '../utils/BalanceService';
export const getAll = async () => (await (await getDatabase()).getAllAsync('SELECT data FROM transactions ORDER BY fullDate DESC')).map(decodeRow);
export const getByMonth = async (year, month) => {
  const start = new Date(year, month, 1).toISOString();
  const end = new Date(year, month + 1, 1).toISOString();
  return (await (await getDatabase()).getAllAsync('SELECT data FROM transactions WHERE fullDate >= ? AND fullDate < ? ORDER BY fullDate DESC', start, end)).map(decodeRow);
};
export const moveBalances = async (db, task) => {
  const accounts = (await db.getAllAsync('SELECT data FROM accounts')).map(r => JSON.parse(r.data));
  for (const account of task(accounts)) await db.runAsync('INSERT OR REPLACE INTO accounts(id, data) VALUES (?, ?)', String(account.id), JSON.stringify(account));
};
const persistMany = (transactions, { balanceMode = 'none', dedup = true } = {}) => atomic(async db => {
  const rules = JSON.parse(await readValue(db, 'category_rules') || '[]');
  transactions = transactions.map(tx => tx.smsId || tx.gmailMsgId ? applyCategoryRules({ ...tx, reviewStatus: tx.reviewStatus || 'pending' }, rules) : tx);
  const current = (await db.getAllAsync('SELECT data FROM transactions')).map(decodeRow);
  const rejected = new Set(JSON.parse(await readValue(db,'rejected_sources')||'[]'));
  const candidates = (dedup ? filterNew(transactions, current) : transactions).filter(tx=>!rejected.has(sourceId(tx)));
  const addedTxs = [];
  for (const tx of candidates) {
    const record = { ...tx, balanceMode };
    if ((await insertRow(db, record)).changes === 1) addedTxs.push(record);
  }
  if (balanceMode === 'captured') await moveBalances(db, accounts => applyCapturedToAccounts(accounts, addedTxs));
  if (balanceMode === 'delta') await moveBalances(db, accounts => addedTxs.reduce(applyToAccounts, accounts));
  return { added: addedTxs.length, skipped: transactions.length - addedTxs.length, addedTxs };
});
export const addMany = async (...args) => {
  const result=await persistMany(...args);
  if(result.added) await checkBudgetAlerts().catch(error=>console.warn('Budget alert failed',error.message));
  return result;
};
export const add = (tx) => addMany([tx], { balanceMode: 'delta', dedup: false });
export const updateInDb = async (db, id, changes) => {
  const row = await db.getFirstAsync('SELECT data FROM transactions WHERE id = ?', String(id));
  if (!row) throw new Error('Transaction no longer exists');
  const old = decodeRow(row);
  const next = encodeTransaction({ ...old, ...changes, id: old.id });
  if (old.balanceMode !== 'none') await moveBalances(db, accounts => applyToAccounts(reverseOnAccounts(accounts, old), next));
  await db.runAsync('UPDATE transactions SET sourceId=?, fullDate=?, category=?, account=?, type=?, amount=?, excluded=?, data=? WHERE id=?', sourceId(next), next.fullDate, next.category || '', next.account || '', next.type, Number(next.amount), next.excludeFromReports ? 1 : 0, JSON.stringify(next), String(id));
  return next;
};
export const update = (id, changes) => atomic(db => updateInDb(db,id,changes));
export const removeInDb = async (db,id) => {
  const row = await db.getFirstAsync('SELECT data FROM transactions WHERE id=?', String(id));
  if (!row) return false;
  const tx = decodeRow(row);
  if (tx.balanceMode !== 'none') await moveBalances(db, accounts => reverseOnAccounts(accounts, tx));
  await db.runAsync('DELETE FROM transactions WHERE id=?', String(id));
  return true;
};
export const remove = id => atomic(db => removeInDb(db,id));
export const monthlyAggregates = async (start, end) => (await getDatabase()).getAllAsync(
  `SELECT strftime('%Y-%m', fullDate, 'localtime') AS month, type, SUM(amount) AS total FROM transactions WHERE fullDate >= ? AND fullDate < ? AND excluded = 0 AND type IN ('expense','income') GROUP BY month, type`, start, end);
