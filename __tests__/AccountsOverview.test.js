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
  expect(accountsOverview(owner)).toMatchObject({
    netWorth: 22300,
    cashBank: 1500,
    investments: 25000,
    liabilities: 4200,
    owed: 4200,
    missing: 2,
  });
  expect(accountsOverview()).toMatchObject({
    netWorth: 0,
    cashBank: 0,
    investments: 0,
    liabilities: 0,
    owed: 0,
    missing: 0,
  });
});

describe('C1/C5: liabilities', () => {
  const NOW = new Date(2026, 10, 22, 12);
  const at = (m, d) => new Date(2026, m - 1, d, 12).toISOString();
  const axisCard = {
    id: 'ac',
    name: 'Axis Bank Credit Card ••9070',
    type: 'Credit Card',
    balance: -4857.94,
    createdFrom: 'review',
    creditLimit: 300000,
  };
  const sbiCard = {
    id: 'sbi',
    name: 'SBI Credit Card ••1987',
    type: 'Credit Card',
    balance: -50,
    createdFrom: 'review',
  };
  const bajaj = {
    id: 'bajaj',
    name: 'Bajaj Finance',
    type: 'Loan',
    loanType: 'No Cost EMI',
    originalAmount: 6456,
    emiAmount: 538,
    tenure: 12,
    firstEmiDate: at(8, 7),
    balance: 999999,
  };
  const phoneEmi = {
    id: 'emi',
    name: 'Phone EMI',
    type: 'Loan',
    loanKind: 'cardEmi',
    includedInCard: true,
    onCardId: 'ac',
    originalAmount: 25000,
    interestRate: 15,
    tenure: 12,
    emiAmount: 2256.46,
    firstEmiDate: at(9, 15),
  };
  const closed = { id: 'old', name: 'Old loan', type: 'Loan', status: 'closed', balance: 5000 };
  const bank = {
    id: 'axis',
    name: 'Axis Bank ••0973',
    type: 'Bank Account',
    balance: 33330,
    balanceSetAt: 'x',
  };
  const txs = [
    {
      id: 's',
      type: 'expense',
      amount: 30,
      accountId: 'ac',
      fullDate: at(11, 17),
      availableLimit: 274919.19,
    },
  ];
  const list = [bank, axisCard, sbiCard, bajaj, phoneEmi, closed];

  test('total = card owed + loan outstanding; excludes card EMIs and closed loans; SBI not set up is not counted', () => {
    const ov = accountsOverview(list, { txs, asOf: NOW });
    expect(ov.liabilities).toBe(29384.81); // 25,080.81 + 4,304 (design 05-accounts.png)
    expect(ov.owed).toBe(29384.81);
    expect(ov.netWorth).toBe(3945.19);
    expect(ov.notCounted.map((a) => a.id)).toEqual(['sbi']);
    const { cards, loans, closed: shut } = ov.groups.liabilities;
    expect(cards.map((c) => [c.account.id, c.owed, c.counted, c.setUp])).toEqual([
      ['ac', 25080.81, true, true],
      ['sbi', -50, false, false],
    ]);
    expect(loans.map((l) => [l.account.id, l.outstanding, l.inCard])).toEqual([
      ['bajaj', 4304, false],
      ['emi', 19094.92, true],
    ]);
    expect(shut.map((l) => l.account.id)).toEqual(['old']);
  });

  test('an overpaid card (confirmed) counts as an asset in Cash & bank, not as a smaller debt', () => {
    const confirmed = { ...sbiCard, balanceSetAt: '2026-11-20' };
    const ov = accountsOverview([bank, confirmed], { txs: [], asOf: NOW });
    expect(ov.cardCredit).toBe(50);
    expect(ov.cashBank).toBe(33380);
    expect(ov.liabilities).toBe(0);
    expect(ov.netWorth).toBe(33380);
    // a card added by hand (not from SMS) counts its balance
    expect(
      accountsOverview([{ id: 'm', type: 'Credit Card', balance: 700 }], { txs: [], asOf: NOW }).liabilities
    ).toBe(700);
  });
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
