import LegacyStorage from '@react-native-async-storage/async-storage';
import Storage from '../data/Storage';
import { add, addMany, getAll, update, remove, monthlyAggregates } from '../data/TransactionRepo';
import { getDatabase } from '../data/Database';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const tx = (id, extra = {}) => ({ id, amount: 100, type: 'expense', category: 'Food', account: 'Cash', fullDate: '2026-10-10T12:00:00Z', ...extra });
test('migration keeps a backup, verifies count and derives display dates', async () => {
  await LegacyStorage.setItem('user_transactions', JSON.stringify([tx('legacy')]));
  const db = await getDatabase();
  expect(await getAll()).toHaveLength(1);
  expect(JSON.parse(await LegacyStorage.getItem('user_transactions_backup'))).toHaveLength(1);
  const row = await db.getFirstAsync('SELECT data FROM transactions');
  expect(JSON.parse(row.data).date).toBeUndefined();
  expect((await getAll())[0].date).toBeTruthy();
});
test('concurrent UI and capture writes retain every row and apply one source once', async () => {
  await Storage.clear();
  await Storage.setItem('user_wealth_accounts', JSON.stringify([{ id: 1, name: 'Cash', type: 'Cash', balance: 10000 }]));
  await Promise.all([add(tx('manual')), addMany([tx('sms', { smsId: 'same' })], { balanceMode: 'delta' }), addMany([tx('retry', { smsId: 'same' })], { balanceMode: 'delta' })]);
  expect(await getAll()).toHaveLength(2);
  expect(JSON.parse(await Storage.getItem('user_wealth_accounts'))[0].balance).toBe(9800);
  await update('manual', { amount: 200 });
  expect(JSON.parse(await Storage.getItem('user_wealth_accounts'))[0].balance).toBe(9700);
  await remove('manual');
  expect(JSON.parse(await Storage.getItem('user_wealth_accounts'))[0].balance).toBe(9900);
});
test('malformed batch rolls back rows and balances', async () => {
  const before = await getAll();
  await expect(addMany([tx('good'), tx('bad', { amount: NaN })], { balanceMode: 'delta' })).rejects.toThrow();
  expect(await getAll()).toEqual(before);
  expect(JSON.parse(await Storage.getItem('user_wealth_accounts'))[0].balance).toBe(9900);
});
test('statement without balance adjustment does not reverse on deletion', async () => {
  await addMany([tx('statement', { title: 'Unique reference statement' })]);
  await remove('statement');
  expect(JSON.parse(await Storage.getItem('user_wealth_accounts'))[0].balance).toBe(9900);
});
test('SQL aggregates ignore excluded rows', async () => {
  await add(tx('excluded', { excludeFromReports: true, amount: 500 }));
  const rows = await monthlyAggregates('2026-10-01', '2026-11-01');
  expect(rows.find(r => r.type === 'expense').total).toBe(100);
});
test('restore writes roll back as one database transaction', async () => {
  const before = await getAll();
  await expect(Storage.multiSet([['user_name','Changed'], ['user_transactions', JSON.stringify([tx('invalid', { amount: -1 })])]])).rejects.toThrow();
  expect(await getAll()).toEqual(before);
  expect(await Storage.getItem('user_name')).toBeNull();
});
