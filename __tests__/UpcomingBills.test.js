import { upcoming, suggestions, billNext, windowOf, cardPaidFrom, nextBill } from '../utils/UpcomingBills';

jest.mock('expo-notifications', () => ({ setNotificationHandler: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const asOf = new Date(2026, 10, 26, 12);
const d = (y, m, day, h = 10) => new Date(y, m - 1, day, h).toISOString();
const ymd = (iso) => {
  const x = new Date(iso);
  return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;
};
const bank = { id: 'axis', name: 'Axis Bank', type: 'Bank Account', last4: '0973', balance: 32000 };
const card = {
  id: 'ac',
  name: 'Axis Card',
  type: 'Credit Card',
  last4: '9070',
  creditLimit: 100000,
  statementDay: 15,
  remindDue: true,
  statements: [{ date: d(2026, 11, 15), totalDue: 3914, dueDate: d(2026, 12, 5, 0) }],
};
const sbi = { id: 'sbi', name: 'SBI Card', type: 'Credit Card', last4: '1987' };
const loan = {
  id: 'bajaj',
  type: 'Loan',
  name: 'Bajaj Finance',
  originalAmount: 6000,
  interestRate: 0,
  tenure: 12,
  emiAmount: 500,
  loanType: 'No Cost EMI',
  firstEmiDate: d(2026, 4, 7, 0),
  payFromId: 'axis',
};
const google = {
  id: 'b1',
  key: 'google',
  name: 'Google',
  amount: 1998.19,
  cadence: 'monthly',
  anchorDay: 18,
  nextDate: d(2026, 12, 18, 0),
  accountId: 'axis',
  source: 'detected',
  count: 3,
  reminder: true,
};
const cardPayment = {
  id: 'p1',
  type: 'transfer',
  amount: 5000,
  accountId: 'axis',
  toAccountId: 'ac',
  fullDate: d(2026, 10, 3),
};
const accounts = [bank, card, sbi, loan];

test('merge and sort: card bill, loan EMI, saved bill, repeating entry; paused mandate; card not set up', () => {
  const r = upcoming({
    accounts,
    txs: [cardPayment],
    bills: [google],
    recurring: [
      {
        id: 'r1',
        type: 'expense',
        title: 'Rent',
        amount: 15000,
        frequency: 'Monthly',
        dayOfMonth: 1,
        nextDue: '2026-12-01',
        account: 'Axis Bank',
        active: true,
      },
    ],
    mandates: [
      { key: 'openai', payee: 'OpenAI LLC', amount: 399, status: 'paused', pausedUntil: d(2026, 12, 31, 23) },
    ],
    asOf,
  });
  expect(r.items.map((i) => [i.kind, i.name, ymd(i.date), i.amount])).toEqual([
    ['recurring', 'Rent', '2026-12-1', 15000],
    ['card', 'Axis Card ••9070 bill', '2026-12-5', 3914],
    ['loan', 'Bajaj Finance EMI', '2026-12-7', 500],
    ['bill', 'Google', '2026-12-18', 1998.19],
  ]);
  expect(r.items[1]).toMatchObject({
    sub: 'From the statement · reminder on 2 Dec',
    payFromId: 'axis',
    overdue: false,
  });
  expect(r.items[2].sub).toBe('Auto-debit · Axis ••0973 · 4 left');
  expect(r.items[3]).toMatchObject({ sub: 'Monthly · found in SMS · 3 times so far', payFromId: 'axis' });
  expect(ymd(r.items[3].reminderDate)).toBe('2026-12-16');
  expect(r.items[0].sub).toBe('Monthly · added by you');
  expect(r.total).toBe(21412.19);
  expect(r.afterBank).toEqual({ account: bank, balance: 10587.81 });
  expect(r.paused).toEqual([
    {
      id: 'mandate_openai',
      name: 'OpenAI LLC autopay',
      amount: 399,
      sub: 'Paused until 31 Dec · from the mandate SMS',
    },
  ]);
  expect(r.warnings).toEqual([{ kind: 'cardNotSetUp', card: sbi }]);
  expect(nextBill(r).name).toBe('Rent');
  expect(nextBill(null)).toBeNull();
});

test('30-day window edges: today counts, day 30 counts, day 31 does not', () => {
  const { from, to } = windowOf(asOf, 30);
  expect(ymd(from.toISOString())).toBe('2026-11-26');
  expect(ymd(to.toISOString())).toBe('2026-12-25');
  const at = (day) => ({
    id: day,
    name: `B${day}`,
    amount: 1,
    cadence: 'yearly',
    nextDate: d(2026, day > 30 ? 12 : 11, day > 30 ? day - 30 : day, 0),
  });
  const bills = [
    { ...at(26), name: 'today' },
    { ...at(55), name: 'day 30' },
    { ...at(56), name: 'day 31' },
  ];
  bills[1].nextDate = d(2026, 12, 25, 0);
  bills[2].nextDate = d(2026, 12, 26, 0);
  expect(upcoming({ bills, asOf }).items.map((i) => i.name)).toEqual(['today', 'day 30']);
});

test('a bill already paid this month moves to next month; missed dates roll forward; weekly repeats', () => {
  const paid = { id: 'g', type: 'expense', amount: 1998.19, merchant: 'Google', fullDate: d(2026, 11, 18) };
  expect(ymd(billNext({ ...google, nextDate: d(2026, 11, 18, 0) }, [paid], asOf).toISOString())).toBe(
    '2026-12-18'
  );
  expect(ymd(billNext({ ...google, nextDate: d(2026, 9, 18, 0) }, [], asOf).toISOString())).toBe(
    '2026-12-18'
  );
  expect(ymd(billNext({ name: 'X', cadence: 'monthly' }, [], asOf).toISOString())).toBe('2026-11-26');
  const weekly = {
    id: 'w',
    name: 'Milk',
    amount: 200,
    cadence: 'weekly',
    stepDays: 7,
    nextDate: d(2026, 11, 28, 0),
    source: 'manual',
  };
  const r = upcoming({ bills: [weekly], asOf });
  expect(r.items.map((i) => ymd(i.date))).toEqual(['2026-11-28', '2026-12-5', '2026-12-12', '2026-12-19']);
  expect(r.items[0]).toMatchObject({ sub: 'Weekly · added by you', reminderDate: null });
  expect(r.afterBank).toBeNull();
});

test('a paused mandate hides its bill until the pause ends', () => {
  const openai = {
    id: 'o',
    key: 'openai llc',
    name: 'OpenAI LLC',
    amount: 399,
    cadence: 'monthly',
    anchorDay: 4,
    nextDate: d(2026, 12, 4, 0),
  };
  const paused = {
    key: 'openai',
    payee: 'OpenAI LLC',
    amount: 399,
    status: 'paused',
    pausedUntil: d(2026, 12, 31, 23),
  };
  expect(upcoming({ bills: [openai], mandates: [paused], asOf }).items).toEqual([]);
  expect(
    upcoming({ bills: [openai], mandates: [{ ...paused, pausedUntil: undefined }], asOf }).items
  ).toEqual([]);
  expect(upcoming({ bills: [openai], mandates: [{ ...paused, status: 'active' }], asOf }).items).toHaveLength(
    1
  );
});

test('no duplicate: a series that is also a loan or a card bill is not suggested or listed', () => {
  const bajaj = (i, m) => ({
    id: `b${i}`,
    type: 'expense',
    amount: 500,
    merchant: 'Bajaj Finance',
    category: 'EMI',
    fullDate: d(2026, m, 7),
  });
  const gpay = (i, m) => ({
    id: `g${i}`,
    type: 'expense',
    amount: 1998.19,
    merchant: 'Google',
    fullDate: d(2026, m, 18),
  });
  const txs = [8, 9, 10, 11].flatMap((m, i) => [bajaj(i, m), gpay(i, m)]);
  expect(suggestions({ txs, accounts, asOf }).map((s) => s.name)).toEqual(['Google']);
  expect(suggestions({ txs, accounts, bills: [google], asOf })).toEqual([]);
  expect(suggestions({ txs, accounts, dismissed: ['google'], asOf })).toEqual([]);
  expect(suggestions()).toEqual([]);
  const dup = { ...google, id: 'dup', key: 'bajaj finance', name: 'Bajaj Finance' };
  expect(upcoming({ accounts, bills: [dup], asOf }).items.filter((i) => i.kind === 'bill')).toEqual([]);
});

test('cards: paid, beyond the window, overdue, no statement, no reminder; closed loans and card EMIs skipped', () => {
  const paidAll = { ...cardPayment, id: 'p2', amount: 3914, fullDate: d(2026, 11, 20) };
  expect(upcoming({ accounts: [card], txs: [paidAll], asOf }).items).toEqual([]);
  const late = { ...card, statements: [{ date: d(2026, 11, 15), totalDue: 100, dueDate: d(2027, 1, 5, 0) }] };
  expect(upcoming({ accounts: [late], asOf }).items).toEqual([]);
  const overdue = {
    ...card,
    remindDue: false,
    statements: [{ date: d(2026, 10, 15), totalDue: 100, dueDate: d(2026, 11, 5, 0) }],
  };
  expect(upcoming({ accounts: [overdue], asOf }).items[0]).toMatchObject({
    overdue: true,
    sub: 'From the statement',
    payFromId: null,
  });
  expect(upcoming({ accounts: [{ ...card, statements: [] }], asOf }).items).toEqual([]);
  expect(cardPaidFrom(card, [{ ...cardPayment, toAccountId: null, accountId: 'ac', flow: 'in' }])).toBeNull();
  const skipLoans = [
    { ...loan, status: 'closed' },
    { ...loan, id: 'ce', includedInCard: true },
    { ...loan, id: 'nx', emiAmount: 0 },
  ];
  expect(upcoming({ accounts: skipLoans, asOf }).items).toEqual([]);
  const noPay = { ...loan, payFromId: undefined };
  expect(upcoming({ accounts: [noPay], asOf }).items[0]).toMatchObject({
    sub: 'Auto-debit · 4 left',
    payFromId: null,
  });
});

test('repeating entries: income, paused, past dates and unknown accounts', () => {
  const base = {
    id: 'r',
    type: 'expense',
    amount: 10,
    frequency: 'Weekly',
    weekday: 1,
    nextDue: '2026-11-23',
    active: true,
  };
  const r = upcoming({
    recurring: [
      base,
      { ...base, id: 'i', type: 'income' },
      { ...base, id: 'p', active: false },
      null,
      { ...base, id: 'n', nextDue: null },
    ],
    asOf,
  });
  expect(r.items.map((i) => ymd(i.date))).toEqual(['2026-11-30', '2026-12-7', '2026-12-14', '2026-12-21']);
  expect(r.items[0]).toMatchObject({
    name: 'Repeating entry',
    sub: 'Weekly · added by you',
    payFromId: null,
  });
  const titled = upcoming({
    recurring: [{ ...base, title: undefined, category: 'Milk', frequency: undefined }],
    asOf,
  });
  expect(titled.items[0]).toMatchObject({ name: 'Milk', sub: 'Repeats · added by you' });
});

test('the bank after these: the one most bills use, else the one with most debits', () => {
  const hdfc = { id: 'hdfc', name: 'HDFC Bank', type: 'Bank Account', last4: '1111', balance: 500 };
  const spend = { id: 's', type: 'expense', amount: 1, accountId: 'hdfc', fullDate: d(2026, 11, 1) };
  expect(upcoming({ accounts: [bank, hdfc], txs: [spend], asOf }).afterBank).toEqual({
    account: hdfc,
    balance: 500,
  });
  const bill = { ...google, accountId: 'axis', reminder: false, source: 'manual', count: null };
  const r = upcoming({ accounts: [bank, hdfc], txs: [spend], bills: [bill], asOf });
  expect(r.afterBank.account).toBe(bank);
  expect(r.items[0].sub).toBe('Monthly · added by you');
  expect(upcoming({ bills: [{ ...bill, cadence: 'fortnightly', stepDays: 14 }], asOf }).items[0].sub).toMatch(
    /^Repeats/
  );
  expect(upcoming().items).toEqual([]);
});

test('defaults: no transactions, bills without a key or anchor day', () => {
  expect(cardPaidFrom(card)).toBeNull();
  const plain = { name: 'Gym', amount: 1500, cadence: 'monthly', nextDate: d(2026, 12, 10, 0) };
  expect(ymd(billNext(plain, undefined, asOf).toISOString())).toBe('2026-12-10');
  expect(upcoming({ bills: [{ ...plain, id: 'g' }], asOf }).items.map((i) => ymd(i.date))).toEqual([
    '2026-12-10',
  ]);
});

test('newBill: checks the fields; weekly keeps a 7-day step; the date cannot be past', () => {
  const { newBill } = require('../utils/UpcomingBills');
  const now = new Date(2026, 10, 26, 12);
  expect(() => newBill({ name: ' ' }, now)).toThrow('Enter a name.');
  expect(() => newBill({ name: 'Gym', amount: 0 }, now)).toThrow('Enter an amount.');
  expect(() => newBill({ name: 'Gym', amount: 'x' }, now)).toThrow('Enter an amount.');
  expect(() => newBill({ name: 'Gym', amount: 500, cadence: 'daily' }, now)).toThrow('Choose how often.');
  expect(() => newBill({ name: 'Gym', amount: 500 }, now)).toThrow('Choose the next due date');
  expect(() => newBill({ name: 'Gym', amount: 500, nextDate: new Date(2026, 10, 25) }, now)).toThrow(
    'today or later'
  );
  const b = newBill(
    {
      name: ' Cult Fit ',
      amount: '999.999',
      cadence: 'weekly',
      nextDate: new Date(2026, 10, 26, 20),
      reminder: 1,
    },
    now
  );
  expect(b).toMatchObject({
    name: 'Cult Fit',
    amount: 1000,
    cadence: 'weekly',
    stepDays: 7,
    anchorDay: 26,
    accountId: null,
    source: 'manual',
    reminder: true,
  });
  expect(b.key).toBeTruthy();
  expect(newBill({ name: 'Rent', amount: 100, nextDate: new Date(2026, 11, 1) }, now)).toMatchObject({
    cadence: 'monthly',
    stepDays: null,
    reminder: false,
  });
  expect(newBill({ name: 'Rent', amount: 100, nextDate: new Date(2099, 0, 1) }).nextDate).toBeTruthy();
});

test('more defaults: window and card payer with no arguments, odd amounts', () => {
  const w = windowOf();
  expect(w.to - w.from).toBeGreaterThan(29 * 86400000);
  expect(cardPaidFrom({ id: 'c' })).toBeNull();
  expect(cardPaidFrom({ id: 'c' }, null)).toBeNull();
  expect(billNext({ cadence: 'monthly', nextDate: d(2026, 12, 3) }).toString()).not.toBe('Invalid Date');
});
