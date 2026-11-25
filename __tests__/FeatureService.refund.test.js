import Storage from '../data/Storage';
import { addMany, getAll } from '../data/TransactionRepo';
import { linkRefund, unlinkRefund, dismissRefund } from '../utils/FeatureService';
import { monthSpend, monthIncome } from '../utils/Report';
import { runQuery, defaultQuery } from '../utils/TransactionQuery';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));

const at = (m, d) => new Date(2026, m - 1, d, 12).toISOString();
const byId = async () => Object.fromEntries((await getAll()).map((t) => [t.id, t]));

beforeEach(async () => {
  await Storage.clear();
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([{ id: 'card', name: 'Axis Card', type: 'Credit Card', last4: '9070', balance: 0 }])
  );
  await addMany(
    [
      {
        id: 'buy',
        type: 'expense',
        amount: 1499,
        merchant: 'Amazon',
        category: 'Shopping',
        accountId: 'card',
        account: 'Axis Card',
        fullDate: at(10, 28),
      },
    ],
    { dedup: false }
  );
});

test('E5: a refund SMS is a candidate; linking moves it out of income into the purchase month; unlink restores', async () => {
  await addMany(
    [
      {
        id: 'r',
        smsId: 'sms:r',
        type: 'income',
        amount: 1499,
        merchant: 'Amazon',
        refundWords: true,
        accountId: 'card',
        account: 'Axis Card',
        fullDate: at(11, 3),
      },
      {
        id: 'cb',
        smsId: 'sms:cb',
        type: 'income',
        amount: 50,
        merchant: 'Cashback',
        category: 'Cashback',
        refundWords: true,
        fullDate: at(11, 3),
      },
    ],
    { dedup: false }
  );
  let rows = await byId();
  expect(rows.r.refundCandidate).toBe(true);
  expect(rows.cb.refundCandidate).toBeUndefined();
  expect(
    runQuery(Object.values(rows), { ...defaultQuery(), flags: ['refunds'] }).rows.map((t) => t.id)
  ).toEqual(['r']);

  await linkRefund('r', 'buy');
  rows = await byId();
  expect(rows.r).toMatchObject({ refundOf: 'buy', refundCategory: 'Shopping', refundCandidate: false });
  const all = Object.values(rows);
  expect(monthSpend(all, new Date(2026, 9, 1)).byCategory.Shopping).toBe(0);
  expect(monthIncome(all, new Date(2026, 10, 1))).toBe(50);

  await unlinkRefund('r');
  rows = await byId();
  expect(rows.r.refundOf).toBeUndefined();
  expect(monthIncome(Object.values(rows), new Date(2026, 10, 1))).toBe(1549);
});

test('E5: more than the purchase cannot be linked; Not a refund keeps it income and is not offered again', async () => {
  await addMany([{ id: 'big', type: 'income', amount: 2000, merchant: 'Amazon', fullDate: at(11, 3) }], {
    dedup: false,
  });
  await expect(linkRefund('big', 'buy')).rejects.toThrow(/left to refund/);
  await expect(linkRefund('nope', 'buy')).rejects.toThrow(/no longer exists/);
  await dismissRefund('big');
  expect((await byId()).big).toMatchObject({ refundCandidate: false, refundDismissed: true });
});
