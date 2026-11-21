import { monthSpending, budgetStatus, categoryRows, previousMonthName } from '../utils/BudgetView';

// babel-jest hoists this above the imports
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const NOV = new Date(2026, 10, 10);
const at = (o) => ({ fullDate: new Date(2026, 10, 5, 12).toISOString(), type: 'expense', ...o });

test('monthSpending counts reportable expenses of the month only', () => {
  expect(
    monthSpending(
      [
        at({ amount: 1998.19, category: 'Subscriptions' }),
        at({ amount: 100, category: 'Food' }),
        at({ amount: 22.5, category: 'Food' }),
        at({ amount: 12511, type: 'transfer', category: 'Card Payment' }),
        at({ amount: 50, excludeFromReports: true, category: 'Food' }),
        at({ amount: 9, type: 'income' }),
        at({ amount: 5 }),
        at({ amount: 7, fullDate: new Date(2026, 9, 5).toISOString() }),
        null,
      ],
      NOV
    )
  ).toEqual({ total: 2125.69, byCategory: { Subscriptions: 1998.19, Food: 122.5, Other: 5 } });
  expect(monthSpending(undefined, NOV)).toEqual({ total: 0, byCategory: {} });
});

test('budgetStatus thresholds: >90% warn, >100% over', () => {
  expect(budgetStatus(90, 100)).toBe('ok');
  expect(budgetStatus(91, 100)).toBe('warn');
  expect(budgetStatus(100, 100)).toBe('warn');
  expect(budgetStatus(101, 100)).toBe('over');
  expect(budgetStatus(50, 0)).toBe('none');
  expect(budgetStatus(50, null)).toBe('none');
});

test('categoryRows: spend or limit, biggest first, bar ratio', () => {
  const rows = categoryRows(
    { Food: 322, Subscriptions: 1998, Transport: 178 },
    { Food: 300, Health: 500, Gifts: 0 }
  );
  expect(rows.map((r) => r.name)).toEqual(['Subscriptions', 'Food', 'Transport', 'Health']);
  expect(rows[0]).toEqual({ name: 'Subscriptions', spent: 1998, limit: null, ratio: 1, status: 'none' });
  expect(rows[1]).toMatchObject({ limit: 300, ratio: 1, status: 'over' });
  expect(rows[2].ratio).toBeCloseTo(178 / 1998);
  expect(rows[3]).toMatchObject({ spent: 0, limit: 500, ratio: 0, status: 'ok' });
  expect(categoryRows()).toEqual([]);
  expect(categoryRows({}, { A: 10, B: 10 }).map((r) => r.name)).toEqual(['A', 'B']);
});

test('previousMonthName', () => {
  expect(previousMonthName(NOV)).toBe('October');
  expect(previousMonthName(new Date(2026, 0, 3))).toBe('December');
});
