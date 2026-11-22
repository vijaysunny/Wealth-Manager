import { monthSummary, headerDate, monthLabel, inMonth } from '../utils/HomeSummary';

// babel-jest hoists this above the imports
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const NOV = new Date(2026, 10, 15);
const tx = (o) => ({ fullDate: new Date(2026, 10, 10, 12).toISOString(), ...o });

test('spent excludes transfers and excluded rows; transfers summed separately', () => {
  const s = monthSummary(
    [
      tx({ type: 'expense', amount: 1998.19 }),
      tx({ type: 'expense', amount: 281 }),
      tx({ type: 'transfer', transferKind: 'cc_bill', amount: 12511.38 }),
      tx({ type: 'transfer', transferKind: 'wallet_topup', amount: 500 }),
      tx({ type: 'expense', amount: 99, excludeFromReports: true }),
      tx({ type: 'expense', amount: 10, fullDate: new Date(2026, 9, 31, 12).toISOString() }),
    ],
    NOV
  );
  expect(s).toEqual({ spent: 2279.19, income: 0, transfers: 13011.38, savedPct: null });
});

test('saved % only with income, capped to -100…100', () => {
  expect(
    monthSummary([tx({ type: 'income', amount: 1000 }), tx({ type: 'expense', amount: 250 })], NOV).savedPct
  ).toBe(75);
  expect(
    monthSummary([tx({ type: 'income', amount: 100 }), tx({ type: 'expense', amount: 301 })], NOV).savedPct
  ).toBe(-100);
  expect(monthSummary([], NOV)).toEqual({ spent: 0, income: 0, transfers: 0, savedPct: null });
  expect(monthSummary(undefined, NOV).spent).toBe(0);
});

test('labels and month check', () => {
  expect(headerDate(new Date(2026, 10, 21))).toMatch(/Saturday.*21.*Nov/);
  expect(monthLabel(NOV)).toMatch(/November 2026/);
  expect(inMonth({ date: '2026-11-02' }, NOV)).toBe(true);
});

test('C6: Home "spent" leaves out principal of Interest only loans', () => {
  const tx = {
    type: 'expense',
    amount: 9414.69,
    fullDate: new Date(2026, 10, 7, 12).toISOString(),
    loanLink: { loanId: 'pl', kind: 'emi', principal: 7792.91, interest: 1621.78, interestOnly: true },
  };
  expect(monthSummary([tx], new Date(2026, 10, 20)).spent).toBe(1621.78);
});
