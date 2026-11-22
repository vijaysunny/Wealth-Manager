/** Phase 13 B2: card dueDay → due, safe to run twice. */
import Storage from '../data/Storage';
import { migrateCards } from '../data/CardMigration';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

test('migrates dueDay once; a second run changes nothing', async () => {
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([
      { id: 'sbi', type: 'Credit Card', name: 'SBI Card', dueDay: 5, balance: 0 },
      { id: 'ac', type: 'Credit Card', name: 'Axis Card', due: { mode: 'afterStatement', days: 20 } },
      { id: 'axis', type: 'Bank Account', name: 'Axis', dueDay: 9 },
    ])
  );
  expect(await migrateCards()).toEqual({ changed: 1 });
  const accounts = JSON.parse(await Storage.getItem('user_wealth_accounts'));
  expect(accounts[0].due).toEqual({ mode: 'fixedDay', day: 5 });
  expect(accounts[1].due).toEqual({ mode: 'afterStatement', days: 20 });
  expect(accounts[2].due).toBeUndefined();
  expect(await migrateCards()).toEqual({ changed: 0 });
});

test('no accounts yet → nothing to do', async () => {
  await Storage.setItem('user_wealth_accounts', '[]');
  expect(await migrateCards()).toEqual({ changed: 0 });
});
