import { groupByDay, dayTitle, touchesAccount, shortAccountName } from '../utils/TransactionList';

// babel-jest hoists this above the imports
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const at = (d, h, o) => ({ fullDate: new Date(2026, 10, d, h).toISOString(), ...o });

test('groups by day, newest first; day total ignores transfers and excluded rows', () => {
  const groups = groupByDay([
    at(17, 9, { id: 'p', type: 'expense', amount: 30 }),
    at(18, 10, { id: 'g', type: 'expense', amount: 1998.19 }),
    at(18, 12, { id: 'u', type: 'transfer', amount: 500 }),
    at(17, 11, { id: 'b', type: 'expense', amount: 75 }),
    at(17, 12, { id: 's', type: 'income', amount: 10 }),
    at(17, 13, { id: 'x', type: 'expense', amount: 999, excludeFromReports: true }),
    { id: 'bad', fullDate: 'nope' },
    null,
  ]);
  expect(groups.map((g) => g.title)).toEqual(['WED, 18 NOV', 'TUE, 17 NOV']);
  expect(groups[0].total).toBe(-1998.19);
  expect(groups[0].data.map((t) => t.id)).toEqual(['u', 'g']);
  expect(groups[1].total).toBe(-95);
  expect(groupByDay()).toEqual([]);
});

test('dayTitle', () => {
  expect(dayTitle(new Date(2026, 10, 16))).toBe('MON, 16 NOV');
});

test('touchesAccount by id or name on either side', () => {
  const axis = { id: 7, name: 'Axis Bank' };
  expect(touchesAccount({ accountId: 7 }, axis)).toBe(true);
  expect(touchesAccount({ toAccountId: '7' }, axis)).toBe(true);
  expect(touchesAccount({ account: 'Axis Bank' }, axis)).toBe(true);
  expect(touchesAccount({ toAccount: 'Axis Bank' }, axis)).toBe(true);
  expect(touchesAccount({ account: 'SBI' }, axis)).toBe(false);
  expect(touchesAccount({ account: 'SBI' }, null)).toBe(true);
});

test('shortAccountName', () => {
  expect(shortAccountName('Axis Bank', '0973')).toBe('Axis ••0973');
  expect(shortAccountName('Axis Bank Credit Card', '9070')).toBe('Axis Card ••9070');
  expect(shortAccountName('UPI Lite')).toBe('UPI Lite');
  expect(shortAccountName()).toBe('');
});
