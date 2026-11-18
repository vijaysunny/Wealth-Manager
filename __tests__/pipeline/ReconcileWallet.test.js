import Storage from '../../data/Storage';
import { getAll, remove } from '../../data/TransactionRepo';
import { reconcileWallet } from '../../utils/FeatureService';
import { computeReconcile } from '../../utils/WalletReconcile';
import { computeNetWorth, isReportable } from '../../utils/BalanceService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));

const ACCTS = () => [
  { id: 'axis', name: 'Axis Bank', type: 'Bank Account', balance: 9500 },
  { id: 'lite', name: 'UPI Lite', type: 'Wallet', subType: 'UPI Lite', linkedBankId: 'axis', balance: 500 },
];
const accounts = async () => JSON.parse(await Storage.getItem('user_wealth_accounts'));
const bal = async (id) => (await accounts()).find((a) => a.id === id).balance;

beforeEach(async () => {
  await Storage.clear();
  await Storage.setItem('user_wealth_accounts', JSON.stringify(ACCTS()));
});

test('pure diff', () => {
  expect(computeReconcile(ACCTS()[1], 380)).toEqual({ diff: 120, action: 'expense' });
  expect(computeReconcile(ACCTS()[1], 500.0)).toEqual({ diff: 0, action: 'none' });
  expect(computeReconcile(ACCTS()[1], 510.5)).toEqual({ diff: -10.5, action: 'income' });
  expect(() => computeReconcile(ACCTS()[0], 1)).toThrow('wallet');
  expect(() => computeReconcile(ACCTS()[1], -1)).toThrow();
});

test('lower balance → one reportable "Unrecorded wallet spends" expense; balance matches the app', async () => {
  const { tx } = await reconcileWallet('lite', 380, { requestId: 'a', category: 'Food' });
  expect(tx).toMatchObject({
    type: 'expense',
    amount: 120,
    title: 'Unrecorded wallet spends',
    category: 'Food',
    source: 'wallet_reconcile',
    reconciled: true,
    tags: ['Reconciled'],
  });
  expect(isReportable(tx)).toBe(true);
  expect(await bal('lite')).toBe(380);
});

test('double tap with the same request id saves once', async () => {
  await reconcileWallet('lite', 380, { requestId: 'same' });
  const second = await reconcileWallet('lite', 380, { requestId: 'same' });
  expect(second.repeated).toBe(true);
  expect(await getAll()).toHaveLength(1);
  expect(await bal('lite')).toBe(380);
});

test('higher balance as an uncaptured top-up = transfer from the linked bank, net worth unchanged', async () => {
  const before = computeNetWorth(await accounts()).netWorth;
  const { tx } = await reconcileWallet('lite', 700, { requestId: 'b', mode: 'topup' });
  expect(tx).toMatchObject({
    type: 'transfer',
    accountId: 'axis',
    toAccountId: 'lite',
    amount: 200,
    account: 'Axis Bank',
  });
  expect(await bal('lite')).toBe(700);
  expect(await bal('axis')).toBe(9300);
  expect(computeNetWorth(await accounts()).netWorth).toBe(before);
});

test('higher balance as a correction = income', async () => {
  const { tx } = await reconcileWallet('lite', 510.5, { requestId: 'c' });
  expect(tx).toMatchObject({ type: 'income', amount: 10.5 });
  expect(await bal('lite')).toBe(510.5);
});

test('no gap → nothing saved', async () => {
  expect((await reconcileWallet('lite', 500, { requestId: 'd' })).tx).toBeNull();
  expect(await getAll()).toHaveLength(0);
});

test('deleting the adjustment restores the tracked balance (reversible)', async () => {
  const { tx } = await reconcileWallet('lite', 380, { requestId: 'e' });
  await remove(tx.id);
  expect(await bal('lite')).toBe(500);
});

test('invalid input rolls back: nothing stored, balances untouched', async () => {
  await expect(reconcileWallet('axis', 1, { requestId: 'f' })).rejects.toThrow();
  await expect(
    reconcileWallet('lite', 700, { requestId: 'g', mode: 'topup' }).then(() => null)
  ).resolves.toBeNull();
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify(ACCTS().map((a) => (a.id === 'lite' ? { ...a, linkedBankId: null } : a)))
  );
  await expect(reconcileWallet('lite', 900, { requestId: 'h', mode: 'topup' })).rejects.toThrow(
    'Link a bank'
  );
  expect((await getAll()).map((t) => t.id)).toEqual(['recon_g']);
});
