import {
  applyToAccounts, reverseOnAccounts, updateOnAccounts, applyCapturedToAccounts,
  computeNetWorth, isReportable, findAccountIndex,
} from '../utils/BalanceService';

// babel-jest hoists this above the imports
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const accts = () => [
  { id: 1, name: 'HDFC Bank', type: 'Bank Account', balance: 10000 },
  { id: 2, name: 'Amex', type: 'Credit Card', balance: 2000 },
  { id: 3, name: 'Cash', type: 'Cash', balance: 500 },
  { id: 4, name: 'Home Loan', type: 'Loan', balance: 900000 },
];
const bal = (a, name) => a.find(x => x.name === name).balance;
const tx = (o) => ({ id: 't1', amount: 300, type: 'expense', account: 'HDFC Bank', accountId: 1, ...o });

describe('add / edit / delete returns balances to start (C9)', () => {
  test('bank: add → edit amount → delete', () => {
    const start = accts();
    const t = tx({});
    let a = applyToAccounts(start, t);
    expect(bal(a, 'HDFC Bank')).toBe(9700);
    const edited = { ...t, amount: 450 };
    a = updateOnAccounts(a, t, edited);
    expect(bal(a, 'HDFC Bank')).toBe(9550);
    a = reverseOnAccounts(a, edited);
    expect(bal(a, 'HDFC Bank')).toBe(10000);
  });

  test('edit that moves the transaction to another account / type', () => {
    const start = accts();
    const t = tx({});
    const moved = { ...t, account: 'Cash', accountId: 3, type: 'income' };
    const a = updateOnAccounts(applyToAccounts(start, t), t, moved);
    expect(bal(a, 'HDFC Bank')).toBe(10000);
    expect(bal(a, 'Cash')).toBe(800);
  });

  test('does not mutate the input', () => {
    const start = accts();
    applyToAccounts(start, tx({}));
    expect(bal(start, 'HDFC Bank')).toBe(10000);
  });
});

describe('credit card logic', () => {
  test('expense raises debt, income (payment/refund) lowers it', () => {
    let a = applyToAccounts(accts(), tx({ account: 'Amex', accountId: 2 }));
    expect(bal(a, 'Amex')).toBe(2300);
    a = applyToAccounts(a, tx({ id: 't2', account: 'Amex', accountId: 2, type: 'income', amount: 1000 }));
    expect(bal(a, 'Amex')).toBe(1300);
  });
  test('round-trip on a credit card', () => {
    const t = tx({ account: 'Amex', accountId: 2, type: 'income', amount: 750.5 });
    expect(bal(reverseOnAccounts(applyToAccounts(accts(), t), t), 'Amex')).toBe(2000);
  });
});

describe('account matching', () => {
  test('accountId wins, then case-insensitive name; loans/unknown are untouched', () => {
    const a = accts();
    expect(findAccountIndex(a, { accountId: 3, account: 'whatever' })).toBe(2);
    expect(findAccountIndex(a, { account: 'hdfc bank' })).toBe(0);
    expect(findAccountIndex(a, { account: 'Home Loan' })).toBe(-1);
    expect(applyToAccounts(a, tx({ account: 'Nope', accountId: undefined }))).toBe(a);
  });
  test('no float drift over many cents', () => {
    let a = accts();
    for (let i = 0; i < 100; i++) a = applyToAccounts(a, tx({ amount: 0.1 }));
    expect(bal(a, 'HDFC Bank')).toBe(9990);
  });
});

describe('auto-captured transactions', () => {
  const sms = (iso, o) => ({ amount: 100, type: 'expense', account: 'HDFC Bank', fullDate: iso, ...o });
  test('latest running balance wins regardless of input order', () => {
    const a = applyCapturedToAccounts(accts(), [
      sms('2024-01-03T10:00:00Z', { extractedBalance: 7000 }),
      sms('2024-01-01T10:00:00Z', { extractedBalance: 9000 }),
      sms('2024-01-02T10:00:00Z', { extractedBalance: 8000 }),
    ]);
    expect(bal(a, 'HDFC Bank')).toBe(7000);
  });
  test('without a balance, falls back to a delta', () => {
    expect(bal(applyCapturedToAccounts(accts(), [sms('2024-01-01T10:00:00Z', {})]), 'HDFC Bank')).toBe(9900);
  });
  test('credit card ignores extracted balance (it is usually the limit) and uses a delta', () => {
    const a = applyCapturedToAccounts(accts(), [sms('2024-01-01T10:00:00Z', { account: 'Amex', extractedBalance: 50000 })]);
    expect(bal(a, 'Amex')).toBe(2100);
  });
  test('unknown bank creates an account; generic names do not', () => {
    const a = applyCapturedToAccounts(accts(), [
      sms('2024-01-01T10:00:00Z', { account: 'Axis Bank', extractedBalance: 4000 }),
      sms('2024-01-01T11:00:00Z', { account: 'Unknown Bank' }),
    ]);
    expect(a).toHaveLength(5);
    expect(bal(a, 'Axis Bank')).toBe(4000);
  });
});

describe('net worth (C10) and report filter (C11)', () => {
  test('credit cards and loans are liabilities; negatives stay negative', () => {
    expect(computeNetWorth(accts())).toEqual({ assets: 10500, liabilities: 902000, netWorth: -891500 });
  });
  test('extra assets list is included', () => {
    expect(computeNetWorth(accts(), [{ type: 'Real Estate', balance: 1000000 }]).netWorth).toBe(108500);
  });
  test('isReportable', () => {
    expect(isReportable({ excludeFromReports: true })).toBe(false);
    expect(isReportable({})).toBe(true);
    expect(isReportable(null)).toBe(false);
  });
});

