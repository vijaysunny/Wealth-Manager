import {
  accountsOverview,
  balanceMissing,
  groupAccounts,
  latestLimits,
  monthCounts,
  investmentsSummary,
  isInvestment,
} from '../utils/AccountsOverview';

// babel-jest hoists this above the imports
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const owner = [
  { id: 'axis', name: 'Axis Bank', type: 'Bank Account', balance: 0, createdFrom: 'review' },
  { id: 'eq', name: 'Equitas', type: 'Bank Account', balance: 0, createdFrom: 'capture' },
  { id: 'ac', name: 'Axis Card', type: 'Credit Card', balance: 0, createdFrom: 'review' },
  { id: 'sbi', name: 'SBI Card', type: 'Credit Card', balance: 1200 },
  {
    id: 'lite',
    name: 'UPI Lite',
    type: 'Wallet',
    subType: 'UPI Lite',
    balance: 1000,
    createdFrom: 'capture',
    lastUpdated: '2026-11-18',
  },
  { id: 'cash', name: 'Cash', type: 'Cash', balance: 500 },
  { id: 'mf', name: 'Nifty fund', type: 'Mutual Fund', balance: 20000 },
  { id: 'pf', name: 'EPF', type: 'Provident Fund', balance: 5000 },
  { id: 'bajaj', name: 'Bajaj', type: 'Loan', balance: 3000 },
];

test('three numbers and the missing count', () => {
  expect(accountsOverview(owner)).toEqual({
    netWorth: 22300,
    cashBank: 1500,
    investments: 25000,
    owed: 4200,
    missing: 2,
  });
  expect(accountsOverview()).toEqual({ netWorth: 0, cashBank: 0, investments: 0, owed: 0, missing: 0 });
});

test('balanceMissing: only auto-created spendable accounts with no known balance', () => {
  expect(balanceMissing(owner[0])).toBe(true);
  expect(balanceMissing({ ...owner[0], balanceSetAt: '2026-11-20' })).toBe(false);
  expect(balanceMissing(owner[2])).toBe(false); // card
  expect(balanceMissing(owner[4])).toBe(false); // SMS gave a balance
  expect(balanceMissing(owner[5])).toBe(false); // added by hand
  expect(balanceMissing(null)).toBe(false);
});

test('groups', () => {
  const g = groupAccounts(owner);
  expect(g.banks.map((a) => a.id)).toEqual(['axis', 'eq']);
  expect(g.cards.map((a) => a.id)).toEqual(['ac', 'sbi']);
  expect(g.wallets.map((a) => a.id)).toEqual(['lite', 'cash']);
  expect(g.investments.map((a) => a.id)).toEqual(['mf', 'pf']);
  expect(g.loans.map((a) => a.id)).toEqual(['bajaj']);
  expect(isInvestment(null)).toBe(false);
  expect(groupAccounts().banks).toEqual([]);
});

test('latest limits and month counts', () => {
  const txs = [
    { accountId: 'ac', availableLimit: 100, fullDate: '2026-11-01T00:00:00Z' },
    { accountId: 'ac', availableLimit: 275511.19, fullDate: '2026-11-18T00:00:00Z' },
    { accountId: 'ac', availableLimit: 50, fullDate: '2026-11-10T00:00:00Z' },
    { accountId: 'ac', fullDate: '2026-11-19T00:00:00Z' },
    { availableLimit: 9, fullDate: '2026-11-19T00:00:00Z' },
    null,
  ];
  expect(latestLimits(txs)).toEqual({ ac: 275511.19 });
  const now = new Date(2026, 10, 20);
  expect(
    monthCounts(
      [
        { accountId: 'axis', fullDate: new Date(2026, 10, 2).toISOString() },
        { accountId: 'axis', toAccountId: 'lite', fullDate: new Date(2026, 10, 3).toISOString() },
        { accountId: 'axis', fullDate: new Date(2026, 9, 3).toISOString() },
      ],
      now
    )
  ).toEqual({ axis: 2, lite: 1 });
  expect(monthCounts()).toEqual({});
});

test('investments summary', () => {
  expect(investmentsSummary([])).toBe('MF, stocks, FD/RD, PF · none added yet');
  expect(investmentsSummary([1])).toBe('MF, stocks, FD/RD, PF · 1 holding');
  expect(investmentsSummary([1, 2])).toBe('MF, stocks, FD/RD, PF · 2 holdings');
  expect(investmentsSummary()).toBe('MF, stocks, FD/RD, PF · none added yet');
});
