import { isReportable, spentOf, incomeOf, totalsOf, round2 } from '../utils/Report';

test('what counts: transfers and excluded rows never; interest-only loans count interest', () => {
  expect(isReportable(null)).toBe(false);
  expect(spentOf({ type: 'expense', amount: '12.5' })).toBe(12.5);
  expect(spentOf({ type: 'expense', amount: 5, excludeFromReports: true })).toBe(0);
  expect(spentOf({ type: 'income', amount: 5 })).toBe(0);
  expect(incomeOf({ type: 'income', amount: 'x' })).toBe(0);
  expect(incomeOf({ type: 'transfer', amount: 5 })).toBe(0);
  expect(spentOf({ type: 'expense', amount: 1000, loanLink: { interestOnly: true, principal: 800 } })).toBe(
    200
  );
});

test('totals', () => {
  expect(totalsOf(undefined)).toEqual({ count: 0, spent: 0, income: 0, transfers: 0 });
  expect(totalsOf([null, { type: 'transfer', amount: 'x' }, { type: 'transfer', amount: 2 }])).toEqual({
    count: 3,
    spent: 0,
    income: 0,
    transfers: 2,
  });
  expect(round2(0.1 + 0.2)).toBe(0.3);
});

describe('E4/E5 fallbacks', () => {
  const { spendLines, categoriesOf, monthSpend, monthIncome } = require('../utils/Report');
  const d = new Date(2026, 10, 5, 12).toISOString();
  test('a linked refund without a stored category or date uses its own, then Other', () => {
    expect(spendLines({ type: 'income', refundOf: 1, amount: 5, category: 'Food', fullDate: d })).toEqual([
      { category: 'Food', amount: -5, fullDate: d },
    ]);
    expect(spendLines({ type: 'income', refundOf: 1, amount: 5, fullDate: d })[0].category).toBe('Other');
  });
  test('split parts without a category count as Other; empty parts are skipped', () => {
    expect(spendLines({ type: 'expense', amount: 5, fullDate: d, splits: [null, { amount: 5 }] })).toEqual([
      { category: 'Other', amount: 5, fullDate: d },
    ]);
    expect(spendLines({ type: 'expense', amount: 5, fullDate: d })[0].category).toBe('Other');
  });
  test('categoriesOf and month helpers with nothing', () => {
    expect(categoriesOf({})).toEqual([]);
    expect(categoriesOf(null)).toEqual([]);
    expect(categoriesOf({ splits: [null, { personId: 'p' }, { category: 'A' }] })).toEqual(['A']);
    expect(monthSpend(undefined, new Date())).toEqual({ total: 0, byCategory: {} });
    expect(monthIncome(undefined, new Date())).toBe(0);
    expect(monthIncome([null], new Date())).toBe(0);
  });
});
