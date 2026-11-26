import {
  balanceOf,
  peopleSummary,
  itemsLine,
  settle,
  markSettled,
  unsettle,
  nameMatches,
  settleSuggestions,
  learnPayee,
  settlementChanges,
  remindText,
  newPerson,
  newIou,
  openFor,
} from '../utils/People';
import { monthIncome } from '../utils/Report';
import { computeNetWorth } from '../utils/BalanceService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const ravi = { id: 'ravi', name: 'Ravi', payeeKeys: [] };
const priya = { id: 'priya', name: 'Priya', payeeKeys: [] };
const kiran = { id: 'kiran', name: 'Kiran', payeeKeys: [] };
const ious = [
  {
    id: 'i1',
    personId: 'ravi',
    amount: 500,
    direction: 'owedToMe',
    note: 'Amazon',
    date: '2026-11-12T06:00:00.000Z',
  },
  {
    id: 'i2',
    personId: 'priya',
    amount: 800,
    direction: 'owedToMe',
    note: 'Dinner',
    date: '2026-11-01T06:00:00.000Z',
  },
  {
    id: 'i3',
    personId: 'priya',
    amount: 450,
    direction: 'owedToMe',
    note: 'Trip fuel',
    date: '2026-11-05T06:00:00.000Z',
  },
  {
    id: 'i4',
    personId: 'kiran',
    amount: 300,
    direction: 'iOwe',
    note: 'Movie tickets',
    date: '2026-11-20T06:00:00.000Z',
  },
  {
    id: 'i5',
    personId: 'ravi',
    amount: 99,
    direction: 'owedToMe',
    note: 'Old',
    date: '2026-10-01T06:00:00.000Z',
    settledAt: '2026-10-02',
  },
];

test('IOU totals and net per person', () => {
  const s = peopleSummary([ravi, priya, kiran, { id: 'none', name: 'Nobody' }], ious);
  expect([s.owedToMe, s.iOwe, s.net]).toEqual([1750, 300, 1450]);
  expect(s.rows.map((r) => [r.person.name, r.net])).toEqual([
    ['Priya', 1250],
    ['Ravi', 500],
    ['Kiran', -300],
  ]);
  expect(s.rows[0].items.map((i) => i.id)).toEqual(['i3', 'i2']);
  expect(itemsLine(s.rows[1].items)).toBe('Amazon · 12 Nov');
  expect(itemsLine(s.rows[0].items)).toBe('Trip fuel, Dinner · 2 items');
  expect(itemsLine([])).toBe('');
  expect(balanceOf()).toEqual({ owedToMe: 0, iOwe: 0, net: 0 });
  expect(peopleSummary().rows).toEqual([]);
  const tie = peopleSummary(
    [
      { id: 'b', name: 'B' },
      { id: 'a', name: 'A' },
    ],
    [
      { id: 1, personId: 'b', amount: 5 },
      { id: 2, personId: 'a', amount: 5 },
    ]
  );
  expect(tie.rows.map((r) => r.person.name)).toEqual(['A', 'B']);
});

test('settle oldest first; partial settle leaves the rest open', () => {
  const r = settle(ious, 'priya', 1000, { date: '2026-11-24', txId: 'cr' });
  expect(r.left).toBe(0);
  expect(r.settled).toEqual(['i2', 'i3']);
  const p = r.ious.filter((i) => i.personId === 'priya');
  expect(p.map((i) => [i.amount, i.settledAt || null, i.settledByTxId || null])).toEqual([
    [800, '2026-11-24', 'cr'],
    [200, '2026-11-24', 'cr'],
    [250, null, null],
  ]);
  expect(balanceOf(openFor('priya', r.ious)).owedToMe).toBe(250);
  const over = settle(ious, 'ravi', 600);
  expect(over.left).toBe(100);
  expect(settle(ious, 'kiran', 300).settled).toEqual([]);
  expect(settle(undefined, 'x', 5)).toEqual({ ious: [], settled: [], left: 5 });
});

test('mark settled by hand and undo', () => {
  const m = markSettled(ious, 'i4', 'D');
  expect(m.find((i) => i.id === 'i4').settledAt).toBe('D');
  expect(unsettle(m, 'i4').find((i) => i.id === 'i4').settledAt).toBeUndefined();
  expect(unsettle(m, 'i1')).toEqual(m);
  expect(markSettled(undefined, 'x')).toEqual([]);
});

test('name prefix matches whole words', () => {
  expect(nameMatches(ravi, 'RAVI K')).toBe(true);
  expect(nameMatches(ravi, 'Ravindra')).toBe(false);
  expect(nameMatches({ name: 'Ravi Kumar' }, 'RAVI')).toBe(false);
  expect(nameMatches({ name: '' }, 'x')).toBe(false);
  expect(nameMatches(null, 'x')).toBe(false);
});

const credit = (over) => ({
  id: 'c',
  type: 'income',
  amount: 500,
  counterparty: 'RAVI K',
  fullDate: '2026-11-24T06:00:00.000Z',
  ...over,
});

test('the suggestion matches on a name prefix and on a learned payeeKey, never on amount alone', () => {
  expect(settleSuggestions([credit()], [ravi, priya], ious).map((s) => [s.person.id, s.owed])).toEqual([
    ['ravi', 500],
  ]);
  expect(settleSuggestions([credit({ counterparty: 'SOMEONE', merchant: 'Someone' })], [ravi], ious)).toEqual(
    []
  );
  const learned = learnPayee(ravi, credit({ counterparty: null, vpa: 'ravi.k@okaxis' }));
  expect(learned.payeeKeys).toEqual(['ravi.k@okaxis']);
  expect(learnPayee(learned, credit({ counterparty: null, vpa: 'ravi.k@okaxis' }))).toBe(learned);
  expect(learnPayee(ravi, { type: 'income' })).toBe(ravi);
  expect(
    settleSuggestions([credit({ counterparty: 'XYZ', vpa: 'ravi.k@okaxis' })], [learned], ious)
  ).toHaveLength(1);
  // more than owed, before the item, already a settlement, a refund, dismissed, an expense: no
  for (const over of [
    { amount: 501 },
    { fullDate: '2026-11-01T00:00:00Z' },
    { kind: 'settlement' },
    { refundOf: 'x' },
    { settleDismissed: true },
    { type: 'expense' },
  ])
    expect(settleSuggestions([credit(over)], [ravi], ious)).toEqual([]);
  expect(settleSuggestions([credit()], [ravi], [])).toEqual([]);
  expect(
    settleSuggestions(
      [null, credit({ id: 'a', fullDate: '2026-11-22T00:00:00Z' }), credit()],
      [ravi],
      ious
    ).map((s) => s.tx.id)
  ).toEqual(['c', 'a']);
});

test("a settled credit isn't income", () => {
  const c = { ...credit(), ...settlementChanges('ravi') };
  expect(c).toMatchObject({ kind: 'settlement', excludeFromReports: true, settledPersonId: 'ravi' });
  expect(monthIncome([c, { ...credit(), kind: 'settlement' }], new Date(2026, 10, 1))).toBe(0);
  expect(monthIncome([credit()], new Date(2026, 10, 1))).toBe(500);
});

test('net worth includes IOUs', () => {
  const accounts = [{ id: 'b', type: 'Bank Account', balance: 10000 }];
  expect(computeNetWorth(accounts, [], { ious })).toEqual({
    assets: 11750,
    liabilities: 300,
    netWorth: 11450,
  });
  expect(computeNetWorth(accounts)).toEqual({ assets: 10000, liabilities: 0, netWorth: 10000 });
});

test('remind text', () => {
  const fmt = (n) => `₹${n}`;
  expect(remindText(ravi, openFor('ravi', ious), 'me@okaxis', fmt)).toBe(
    'Hi Ravi, ₹500 for Amazon (12 Nov). UPI: me@okaxis'
  );
  expect(remindText({ name: 'Priya S' }, openFor('priya', ious), '', fmt)).toBe(
    'Hi Priya, ₹800 for Dinner (1 Nov), ₹450 for Trip fuel (5 Nov). Total ₹1250.'
  );
  expect(remindText(null, [{ amount: 5, date: '2026-11-01T06:00:00Z' }])).toBe('Hi , ₹5 for this (1 Nov).');
});

test('new person and IOU validation', () => {
  expect(newPerson([], '  Ravi   K ', 5)).toEqual({ id: 'person_5', name: 'Ravi K', payeeKeys: [] });
  expect(() => newPerson([ravi], 'ravi')).toThrow(/already/);
  expect(() => newPerson([], ' ')).toThrow(/name/);
  expect(newIou({ personId: 7, amount: '300.004', note: ' Movie ' }, 9)).toEqual({
    id: 'iou_9',
    personId: '7',
    amount: 300,
    direction: 'iOwe',
    note: 'Movie',
    date: new Date(9).toISOString(),
  });
  expect(newIou({ personId: 'x', amount: 5, direction: 'owedToMe', date: 'D' }).direction).toBe('owedToMe');
  expect(() => newIou({ amount: 5 })).toThrow(/person/);
  expect(() => newIou({ personId: 'x', amount: 0 })).toThrow(/amount/);
});

test('edge cases: defaults, ties, missing fields', () => {
  expect(balanceOf([{ amount: 'x' }, { amount: 5 }])).toEqual({ owedToMe: 5, iOwe: 0, net: 5 });
  expect(openFor('x')).toEqual([]);
  expect(itemsLine()).toBe('');
  // same date: ordered by id; paying exactly the first leaves the second untouched
  const same = [
    { id: 'b', personId: 'p', amount: 10, date: 'D' },
    { id: 'a', personId: 'p', amount: 10, date: 'D' },
  ];
  const r = settle(same, 'p', 10);
  expect(r.settled).toEqual(['a']);
  expect(r.ious.find((i) => i.id === 'b').settledAt).toBeUndefined();
  const part = settle([{ id: 'a', personId: 'p', amount: 10, date: 'D' }], 'p', 4, { date: 'E' });
  expect(part.ious[0]).toEqual({ id: 'a', personId: 'p', amount: 4, date: 'D', settledAt: 'E' });
  expect(markSettled([{ id: 1 }], 1)[0].settledAt).toEqual(expect.any(String));
  // the sender's name falls back to the payee name, then the title; people without payeeKeys
  const p = { id: 'p', name: 'Asha' };
  const owe = [{ id: 1, personId: 'p', amount: 50, date: '2026-01-01' }];
  expect(
    settleSuggestions([{ type: 'income', amount: 5, merchant: 'Asha R', fullDate: '2026-02-01' }], [p], owe)
  ).toHaveLength(1);
  expect(
    settleSuggestions([{ type: 'income', amount: 5, title: 'Asha', fullDate: '2026-02-01' }], [p], owe)
  ).toHaveLength(1);
  expect(settleSuggestions([{ type: 'income', amount: 5, fullDate: '2026-02-01' }], [p], owe)).toEqual([]);
  expect(settleSuggestions()).toEqual([]);
  expect(learnPayee(p, { type: 'income', vpa: 'a@x' }).payeeKeys).toEqual(['a@x']);
  expect(remindText(p)).toBe('Hi Asha, .');
  expect(newPerson(undefined, 'A').name).toBe('A');
  expect(newIou({ personId: 'p', amount: 1 }).note).toBe('');
});

test('reopenSettledBy: a deleted settlement reopens what it settled and folds a remainder back', () => {
  const { reopenSettledBy, settle: settleIous } = require('../utils/People');
  const ious = [
    { id: 'a', personId: 'r', amount: 300, direction: 'owedToMe', date: '2026-11-01' },
    { id: 'b', personId: 'r', amount: 500, direction: 'owedToMe', date: '2026-11-02' },
    {
      id: 'c',
      personId: 'r',
      amount: 50,
      direction: 'owedToMe',
      date: '2026-11-03',
      settledAt: 'x',
      settledByTxId: 'other',
    },
  ];
  const r = settleIous(ious, 'r', 400, { date: '2026-11-20T00:00:00.000Z', txId: 'cr' });
  expect(r.ious).toHaveLength(4); // b was split into 100 settled + 400 open
  const back = reopenSettledBy(r.ious, 'cr');
  expect(back.map((i) => [i.id, i.amount, !!i.settledAt])).toEqual([
    ['a', 300, false],
    ['b', 500, false],
    ['c', 50, true],
  ]);
  expect(reopenSettledBy(ious, 'nothing')).toBe(ious);
  expect(reopenSettledBy(undefined, 'x')).toEqual([]);
});
