import { xirr, amortize, filterHistory, applyCategoryRules, historyCsv } from '../utils/FinanceTools';
import { computeMonthlyBudget } from '../utils/MonthlyBudgets';
import { applyToAccounts, reverseOnAccounts, isReportable } from '../utils/BalanceService';
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));
test('transfer moves both balances and reverses credit card payment correctly', () => {
  const accounts = [
    { id: 1, name: 'Bank', type: 'Bank Account', balance: 1000 },
    { id: 2, name: 'Card', type: 'Credit Card', balance: 500 },
  ];
  const tx = { type: 'transfer', accountId: 1, toAccountId: 2, amount: 200 };
  const next = applyToAccounts(accounts, tx);
  expect(next.map((a) => a.balance)).toEqual([800, 300]);
  expect(reverseOnAccounts(next, tx)).toEqual(accounts);
  expect(isReportable(tx)).toBe(false);
});
test('XIRR returns 10% for one year and rejects same-date flows', () => {
  expect(
    xirr([
      { date: '2025-01-01', amount: -10000 },
      { date: '2026-01-01', amount: 11000 },
    ])
  ).toBeCloseTo(0.1, 6);
  expect(
    xirr([
      { date: '2025-01-01', amount: -10000 },
      { date: '2025-01-01', amount: 11000 },
    ])
  ).toBeNull();
});
test('prepayment reduces term and interest; interest-only EMI rejected', () => {
  const normal = amortize({ principal: 100000, annualRate: 12, emi: 10000 });
  const prepaid = amortize({ principal: 100000, annualRate: 12, emi: 10000, prepayment: 20000 });
  expect(prepaid.months).toBeLessThan(normal.months);
  expect(prepaid.totalInterest).toBeLessThan(normal.totalInterest);
  expect(() => amortize({ principal: 100000, annualRate: 12, emi: 1000 })).toThrow();
});
test('monthly budgets carry unused amounts, skip transfers and use year boundaries', () => {
  const configs = {
    '2025-12': { limit: 1000, rollover: true, categories: {} },
    '2026-01': { limit: 2000, rollover: true, categories: {} },
  };
  const rows = [
    { type: 'expense', amount: 600, fullDate: '2025-12-10T10:00:00Z' },
    { type: 'transfer', amount: 300, fullDate: '2025-12-10T10:00:00Z' },
  ];
  expect(computeMonthlyBudget(new Date(2026, 0, 1), configs, rows).effectiveLimit).toBe(2400);
});
test('history combines account, amount, date and merchant search; CSV protects formulas', () => {
  const rows = [
    {
      title: '=formula',
      merchant: 'Swiggy',
      account: 'Bank',
      amount: 100,
      type: 'expense',
      fullDate: '2026-10-01T10:00:00Z',
    },
  ];
  expect(filterHistory(rows, { text: 'swiggy', min: 100, account: 'Bank', to: '2026-10-01' })).toHaveLength(
    1
  );
  expect(historyCsv(rows)).toContain("'=formula");
  expect(applyCategoryRules(rows[0], [{ pattern: 'swiggy', category: 'Food' }]).category).toBe('Food');
});

test('a category rule hit clears the self-transfer hint (owner named the payee)', () => {
  const tx = { merchant: 'baja', category: 'UPI Transfer', transferCandidate: true };
  const out = applyCategoryRules(tx, [{ pattern: 'baja', category: 'Loan/EMI' }]);
  expect(out.category).toBe('Loan/EMI');
  expect(out.transferCandidate).toBeUndefined();
  expect(applyCategoryRules(tx, [{ pattern: 'zzz', category: 'X' }])).toBe(tx);
});

describe('A5: category sources', () => {
  const tx = { id: 1, title: 'SWIGGY', merchant: 'SWIGGY', category: 'General' };
  const rules = [{ pattern: 'swiggy', category: 'Food' }];
  test('a rule marks the category as set by a rule', () => {
    expect(applyCategoryRules(tx, rules)).toMatchObject({ category: 'Food', categorySource: 'rule' });
  });
  test.each(['user', 'bulk'])('a category set by %s is never changed by a rule', (src) => {
    const own = { ...tx, category: 'Health', categorySource: src };
    expect(applyCategoryRules(own, rules)).toBe(own);
  });
  test('parser and AI categories can still be changed by a rule', () => {
    expect(applyCategoryRules({ ...tx, categorySource: 'ai' }, rules).category).toBe('Food');
    expect(applyCategoryRules({ ...tx, categorySource: 'parser' }, rules).category).toBe('Food');
  });
});
