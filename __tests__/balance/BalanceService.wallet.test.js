import {
  isWallet,
  WALLET_SUBTYPES,
  applyToAccounts,
  reverseOnAccounts,
  computeNetWorth,
  isReportable,
} from '../../utils/BalanceService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const bank = { id: 1, name: 'Axis Bank', type: 'Bank Account', balance: 10000 };
const lite = {
  id: 2,
  name: 'PhonePe UPI Lite',
  type: 'Wallet',
  subType: 'UPI Lite',
  provider: 'PhonePe',
  linkedBankId: 1,
  aliases: ['phonepe lite'],
  balance: 0,
};

test('isWallet / subtypes (A1)', () => {
  expect(isWallet(lite)).toBe(true);
  expect(isWallet(bank)).toBe(false);
  expect(isWallet(null)).toBe(false);
  expect(WALLET_SUBTYPES).toEqual(['UPI Lite', 'Paytm Wallet', 'Amazon Pay', 'FASTag', 'Other Wallet']);
});

describe('linked wallet top-up transfer', () => {
  const topup = {
    type: 'transfer',
    transferKind: 'wallet_topup',
    amount: 500,
    accountId: 1,
    toAccountId: 2,
    walletProvider: 'PhonePe',
  };
  test('bank −500, wallet +500, net worth unchanged (A7.13)', () => {
    const before = [bank, lite];
    const after = applyToAccounts(before, topup);
    expect(after.find((a) => a.id === 1).balance).toBe(9500);
    expect(after.find((a) => a.id === 2).balance).toBe(500);
    expect(computeNetWorth(after).netWorth).toBe(computeNetWorth(before).netWorth);
  });
  test('delete reverses both legs (A7.11)', () => {
    expect(reverseOnAccounts(applyToAccounts([bank, lite], topup), topup)).toEqual([bank, lite]);
  });
  test('excluded from reports; a wallet spend is included (A7.14)', () => {
    expect(isReportable(topup)).toBe(false);
    expect(isReportable({ type: 'expense', amount: 45, accountId: 2 })).toBe(true);
  });
  test('wallet may go negative without throwing (A7.9)', () => {
    const spend = { type: 'expense', amount: 50, accountId: 2 };
    expect(applyToAccounts([bank, lite], spend).find((a) => a.id === 2).balance).toBe(-50);
  });
});
