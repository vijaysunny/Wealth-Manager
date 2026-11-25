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
