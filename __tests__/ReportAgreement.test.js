/**
 * Phase 14 done-when: one shared report helper. Home, Budget, budget rollover, the Transactions
 * totals and Report agree on the same fixture month (splits, refunds, settlements, Interest-only
 * loans, transfers, rows not in reports).
 */
import { monthSpend, monthIncome } from '../utils/Report';
import { monthSummary } from '../utils/HomeSummary';
import { monthSpending } from '../utils/BudgetView';
import { computeMonthlyBudget } from '../utils/MonthlyBudgets';
import { runQuery, defaultQuery, monthDate } from '../utils/TransactionQuery';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));

const at = (m, d) => new Date(2026, m - 1, d, 12).toISOString();
const nov = new Date(2026, 10, 1);
const rows = [
  { id: 1, type: 'expense', amount: 1000, category: 'Food', fullDate: at(11, 2) },
  // split: 1240 Groceries + 1100 Electronics + 500 for Ravi (not spending)
  {
    id: 2,
    type: 'expense',
    amount: 2840,
    category: 'Shopping',
    fullDate: at(11, 12),
    splits: [
      { id: 'a', category: 'Groceries', amount: 1240 },
      { id: 'b', category: 'Electronics', amount: 1100 },
      { id: 'c', personId: 'ravi', amount: 500 },
    ],
  },
  // a refund of part of a Food purchase, same month
  {
    id: 3,
    type: 'income',
    amount: 200,
    refundOf: 1,
    refundCategory: 'Food',
    refundDate: at(11, 2),
    fullDate: at(11, 20),
  },
  // Ravi paying back: not income
  { id: 4, type: 'income', amount: 500, kind: 'settlement', excludeFromReports: true, fullDate: at(11, 24) },
  // Interest-only loan payment: only the interest counts
  {
    id: 5,
    type: 'expense',
    amount: 10000,
    category: 'EMI',
    loanLink: { interestOnly: true, principal: 9000 },
    fullDate: at(11, 5),
  },
  { id: 6, type: 'transfer', amount: 5000, fullDate: at(11, 6) },
  { id: 7, type: 'expense', amount: 999, category: 'Food', excludeFromReports: true, fullDate: at(11, 7) },
  { id: 8, type: 'income', amount: 50000, category: 'Salary', fullDate: at(11, 1) },
  { id: 9, type: 'expense', amount: 77, category: 'Food', fullDate: at(10, 30) },
];
const SPENT = 1000 + 1240 + 1100 - 200 + 1000; // 4140

test('every screen counts the same month the same way', () => {
  expect(monthSpend(rows, nov)).toEqual({
    total: SPENT,
    byCategory: { Food: 800, Groceries: 1240, Electronics: 1100, EMI: 1000 },
  });
  expect(monthIncome(rows, nov)).toBe(50000);
  expect(monthSummary(rows, nov)).toMatchObject({ spent: SPENT, income: 50000, transfers: 5000 });
  expect(monthSpending(rows, nov)).toEqual(monthSpend(rows, nov));
  const list = runQuery(rows, { ...defaultQuery(), date: monthDate(nov, nov) }, nov);
  expect(list.totals).toMatchObject({ spent: SPENT, income: 50000 });
  // rollover: December's carry is November's limit minus the same spending
  const config = { '2026-11': { limit: 5000, rollover: true } };
  expect(computeMonthlyBudget(new Date(2026, 11, 1), config, rows).carry).toBe(5000 - SPENT);
});

test('a refund in a later month lowers the purchase month in Budget and Home', () => {
  const late = rows.map((r) => (r.id === 3 ? { ...r, fullDate: at(12, 3) } : r));
  expect(monthSummary(late, nov).spent).toBe(SPENT);
  expect(monthSpending(late, new Date(2026, 11, 1)).total).toBe(0);
  expect(monthIncome(late, new Date(2026, 11, 1))).toBe(0);
});
