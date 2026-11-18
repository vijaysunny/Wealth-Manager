import { atomic, getDatabase, insertRow, decodeRow } from './Database';
const tableFor = key => key === 'user_wealth_accounts' ? 'accounts' : key === 'recurring_transactions' ? 'recurring' : null;
export const readValue = async (db, key) => {
  if (key === 'user_transactions') return JSON.stringify((await db.getAllAsync('SELECT data FROM transactions ORDER BY fullDate DESC')).map(decodeRow));
  const table = tableFor(key);
  if (table) return JSON.stringify((await db.getAllAsync(`SELECT data FROM ${table}`)).map(r => JSON.parse(r.data)));
  return (await db.getFirstAsync('SELECT value FROM settings WHERE key=?', key))?.value ?? null;
};
export const writeValue = async (db, key, value) => {
  if (key === 'user_transactions') {
    await db.runAsync('DELETE FROM transactions');
    for (const tx of JSON.parse(value)) if ((await insertRow(db, tx)).changes !== 1) throw new Error('Duplicate transaction in restore');
    return;
  }
  const table = tableFor(key);
  if (table) {
    await db.runAsync(`DELETE FROM ${table}`);
    for (const record of JSON.parse(value)) await db.runAsync(`INSERT INTO ${table}(id,data) VALUES (?,?)`, String(record.id), JSON.stringify(record));
  } else await db.runAsync('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)', key, value);
};
const Storage = {
  getItem: async key => readValue(await getDatabase(), key),
  setItem: (key, value) => atomic(db => writeValue(db, key, value)),
  multiGet: keys => atomic(async db => Promise.all(keys.map(async key => [key, await readValue(db, key)]))),
  multiSet: pairs => atomic(async db => { for (const [key,value] of pairs) await writeValue(db,key,value); }),
  removeItem: key => atomic(db => db.runAsync('DELETE FROM settings WHERE key=?',key)),
  clear: () => atomic(async db => {
    for (const table of ['transactions', 'accounts', 'recurring']) await db.runAsync(`DELETE FROM ${table}`);
    await db.runAsync("DELETE FROM settings WHERE key != 'sqlite_migrated_v1'");
  }),
};
export const updateAccount = (id, changes) => atomic(async db => {
  const row = await db.getFirstAsync('SELECT data FROM accounts WHERE id=?', String(id));
  if (!row) return false;
  await db.runAsync('UPDATE accounts SET data=? WHERE id=?', JSON.stringify({ ...JSON.parse(row.data), ...changes }), String(id));
  return true;
});
export default Storage;
