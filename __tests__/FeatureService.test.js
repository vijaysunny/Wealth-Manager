import Storage from '../data/Storage';
import { add, addMany, getAll } from '../data/TransactionRepo';
import { bulkDelete, bulkUpdate, contributeToGoal, mergeRestore, reviewQueue } from '../utils/FeatureService';
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));
const tx = (id, extra = {}) => ({
  id,
  type: 'expense',
  amount: 100,
  title: 'payment',
  category: 'Other',
  account: 'Bank',
  fullDate: '2026-10-10T12:00:00Z',
  ...extra,
});
beforeEach(async () => {
  await Storage.clear();
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([{ id: 1, type: 'Bank Account', name: 'Bank', balance: 1000 }])
  );
});
test('rules, review and bulk actions preserve balances', async () => {
  await Storage.setItem('category_rules', JSON.stringify([{ pattern: 'swiggy', category: 'Food' }]));
  await addMany([tx('capture', { smsId: 'one', merchant: 'Swiggy' })], { balanceMode: 'captured' });
  expect((await reviewQueue())[0].category).toBe('Food');
  await bulkUpdate(['capture'], { reviewStatus: 'confirmed', category: 'Dining' });
  expect(await reviewQueue()).toHaveLength(0);
  await bulkDelete(['capture']);
  expect(await getAll()).toHaveLength(0);
  expect(JSON.parse(await Storage.getItem('user_wealth_accounts'))[0].balance).toBe(1000);
});
test('bulk failure rolls back earlier changes', async () => {
  await add(tx('one'));
  await expect(bulkUpdate(['one', 'missing'], { amount: 200 })).rejects.toThrow();
  expect((await getAll())[0].amount).toBe(100);
  expect(JSON.parse(await Storage.getItem('user_wealth_accounts'))[0].balance).toBe(900);
});
test('goal contribution records allocation without moving money', async () => {
  await Storage.setItem('user_goals', JSON.stringify([{ id: 1, savedAmount: 100 }]));
  await contributeToGoal(1, 200);
  const goal = JSON.parse(await Storage.getItem('user_goals'))[0];
  expect(goal.savedAmount).toBe(300);
  expect(goal.contributions).toHaveLength(1);
  expect(JSON.parse(await Storage.getItem('user_wealth_accounts'))[0].balance).toBe(1000);
});
test('merge skips duplicates and preserves current account balances', async () => {
  await add(tx('existing', { smsId: 'one' }));
  const backup = {
    transactions: [tx('existing', { smsId: 'one' }), tx('new', { title: 'rent' })],
    wealth: [{ id: 1, type: 'Bank Account', name: 'Bank', balance: 5000 }],
  };
  expect(await mergeRestore(backup)).toEqual({ added: 1, skipped: 1 });
  expect(JSON.parse(await Storage.getItem('user_wealth_accounts'))[0].balance).toBe(900);
  expect(await mergeRestore(backup)).toEqual({ added: 0, skipped: 2 });
});

test('B3: a SIP debit becomes a transfer bank → investment on that platform', async () => {
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([
      { id: 1, type: 'Bank Account', name: 'Bank', bankName: 'Bank', last4: '1234', balance: 1000 },
      { id: 2, type: 'Mutual Fund', subType: 'Mutual Fund', name: 'Groww Flexi Cap', balance: 50000 },
    ])
  );
  await addMany([tx('sip', { smsId: 'sip1', merchant: 'GROWW', amount: 500, accountId: 1 })], {
    balanceMode: 'captured',
  });
  const [row] = await getAll();
  expect(row).toMatchObject({ type: 'transfer', kind: 'investment', accountId: 1, toAccountId: 2 });
  const accs = JSON.parse(await Storage.getItem('user_wealth_accounts'));
  expect(accs.find((a) => a.id === 1).balance).toBe(500);
  expect(accs.find((a) => a.id === 2).balance).toBe(50500);
});

test('B3: without an investment on that platform it stays an expense', async () => {
  await addMany([tx('sip2', { smsId: 'sip2', merchant: 'Zerodha', amount: 300 })], {
    balanceMode: 'captured',
  });
  const [row] = await getAll();
  expect(row.type).toBe('expense');
});

test('B3: deleting a SIP transfer puts both balances back', async () => {
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([
      { id: 1, type: 'Bank Account', name: 'Bank', balance: 1000 },
      { id: 2, type: 'Fixed Deposit', subType: 'Fixed Deposit', name: 'FD', balance: 100 },
    ])
  );
  await add({ ...tx('m'), type: 'transfer', kind: 'investment', accountId: 1, toAccountId: 2, amount: 200 });
  let accs = JSON.parse(await Storage.getItem('user_wealth_accounts'));
  expect(accs.map((a) => a.balance)).toEqual([800, 300]);
  await bulkDelete(['m']);
  accs = JSON.parse(await Storage.getItem('user_wealth_accounts'));
  expect(accs.map((a) => a.balance)).toEqual([1000, 100]);
  // a plain transfer into an investment is still refused
  await expect(add({ ...tx('p'), type: 'transfer', accountId: 1, toAccountId: 2 })).rejects.toThrow(
    'Choose two different accounts'
  );
});
