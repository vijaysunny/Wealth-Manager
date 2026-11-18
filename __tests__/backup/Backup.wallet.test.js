import Storage from '../../data/Storage';
import { buildBackup, validateBackup, restoreBackup, BACKUP_FIELDS } from '../../utils/BackupService';
import { add, getAll } from '../../data/TransactionRepo';
import { mergeRestore } from '../../utils/FeatureService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));

const accounts = [
  { id: 1, name: 'Axis Bank', type: 'Bank Account', balance: 9500 },
  {
    id: 2,
    name: 'PhonePe UPI Lite',
    type: 'Wallet',
    subType: 'UPI Lite',
    provider: 'PhonePe',
    linkedBankId: 1,
    aliases: ['phonepe lite', 'upi lite phonepe'],
    balance: 500,
  },
];
const topup = {
  id: 't1',
  type: 'transfer',
  transferKind: 'wallet_topup',
  walletProvider: 'PhonePe',
  source: 'sms',
  amount: 500,
  accountId: 1,
  account: 'Axis Bank',
  toAccountId: 2,
  title: 'UPI Lite top-up',
  category: 'Wallet Top-up',
  fullDate: '2026-11-07T04:16:28.000Z',
};
const reconcile = {
  id: 'r1',
  type: 'expense',
  amount: 120,
  accountId: 2,
  account: 'PhonePe UPI Lite',
  title: 'Unrecorded wallet spends',
  category: 'General',
  tags: ['Reconciled'],
  source: 'wallet_reconcile',
  reconciled: true,
  fullDate: '2026-11-08T04:16:28.000Z',
};

const mem = (init = {}) => {
  const m = { ...init };
  return {
    m,
    getItem: async (k) => (k in m ? m[k] : null),
    setItem: async (k, v) => {
      m[k] = v;
    },
    multiSet: async (pairs) => pairs.forEach(([k, v]) => (m[k] = v)),
  };
};

test('wallet accounts (subType, provider, linkedBankId, aliases) and wallet transfers round-trip (A7.12)', async () => {
  const src = mem({
    user_wealth_accounts: JSON.stringify(accounts),
    user_transactions: JSON.stringify([topup, reconcile]),
  });
  const backup = JSON.parse(JSON.stringify(await buildBackup(src)));
  expect(validateBackup(backup).ok).toBe(true);
  const fresh = mem();
  await restoreBackup(backup, fresh);
  expect(JSON.parse(fresh.m[BACKUP_FIELDS.wealth.key])).toEqual(accounts);
  expect(JSON.parse(fresh.m[BACKUP_FIELDS.transactions.key])).toEqual([topup, reconcile]);
});

test('merge-restore of a wallet transfer does not double-apply balances', async () => {
  await Storage.clear();
  await Storage.setItem('user_wealth_accounts', JSON.stringify(accounts));
  const before = await Storage.getItem('user_wealth_accounts');
  expect(await mergeRestore({ transactions: [topup], wealth: accounts })).toEqual({ added: 1, skipped: 0 });
  expect(await Storage.getItem('user_wealth_accounts')).toBe(before);
  const stored = (await getAll()).find((t) => t.id === 't1');
  expect(stored).toMatchObject({ transferKind: 'wallet_topup', toAccountId: 2, balanceMode: 'none' });
  // deleting a merged row must not move balances either (it never applied them)
  expect(await mergeRestore({ transactions: [topup] })).toEqual({ added: 0, skipped: 1 });
  await add({ ...reconcile, id: 'r2' });
  expect(JSON.parse(await Storage.getItem('user_wealth_accounts'))[1].balance).toBe(380);
});
