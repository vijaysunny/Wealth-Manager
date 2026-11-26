import {
  review,
  deltaLine,
  shareText,
  topPayeeGroup,
  showReviewCard,
  nextReviewAt,
  monthFromKey,
  monthKeyOf,
  prevMonth,
} from '../utils/MonthReview';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => 'n1'),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

const fmt = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const at = (m, d, h = 12, min = 0) => new Date(2026, m - 1, d, h, min).toISOString();
const ex = (id, m, d, amount, category, over = {}) => ({
  id,
  type: 'expense',
  amount,
  category,
  merchant: category,
  fullDate: at(m, d),
  ...over,
});
const nov = new Date(2026, 10, 15);
const now = new Date(2026, 11, 2, 10);

const rows = [
  // October: 21,560
  ex('o1', 10, 5, 21560, 'Rent'),
  // November
  { id: 'sal', type: 'income', amount: 47900, category: 'Salary', fullDate: at(11, 1) },
  ex('f1', 11, 3, 1910, 'Food'),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
    ex(`sw${i}`, 11, 2 + i, i <= 5 ? 400 : 302.5, 'Food', { merchant: i % 2 ? 'Swiggy' : 'Zomato' })
  ),
  ex('b1', 11, 10, 4310, 'Bills'),
  ex('s1', 11, 18, 1998, 'Subscriptions', { merchant: 'Google' }),
  ex('t1', 11, 12, 1240, 'Transport'),
  ex('g1', 11, 13, 1000, 'General'),
  ex('g2', 11, 14, 500, 'Shopping'),
  // a split: 800 Groceries + 500 paid for Ravi (not spending)
  ex('sp', 11, 20, 1300, 'Shopping', {
    splits: [
      { id: 'a', category: 'Groceries', amount: 800 },
      { id: 'b', personId: 'ravi', amount: 500 },
    ],
  }),
  // a refund of 200 on the Shopping purchase: Shopping goes down, income does not go up
  {
    id: 'rf',
    type: 'income',
    amount: 200,
    refundOf: 'g2',
    refundCategory: 'Shopping',
    refundDate: at(11, 14),
    fullDate: at(11, 25),
  },
  // not counted
  { id: 'tr', type: 'transfer', amount: 9999, fullDate: at(11, 5) },
  ex('nx', 11, 6, 7777, 'Food', { excludeFromReports: true }),
];
const SPENT = 5120 + 4310 + 1998 + 1240 + 1000 + 300 + 800;

test('figures: delta and percent, income and saved, top 4 + the rest add up to spent', () => {
  const r = review(nov, rows, {}, { now, lastBackupAt: now.toISOString() });
  expect(r.spent).toBe(SPENT);
  expect(r.prevSpent).toBe(21560);
  expect(r.delta).toBe(SPENT - 21560);
  expect(r.deltaPct).toBe(Math.round(((SPENT - 21560) / 21560) * 100));
  expect(r.income).toBe(47900);
  expect(r.saved).toBe(47900 - SPENT);
  expect(r.savedPct).toBe(Math.round(((47900 - SPENT) / 47900) * 100));
  expect(r.top.map((c) => [c.category, c.amount])).toEqual([
    ['Food', 5120],
    ['Bills', 4310],
    ['Subscriptions', 1998],
    ['Transport', 1240],
  ]);
  expect(r.restCount).toBe(3);
  expect(r.restTotal).toBe(1000 + 300 + 800);
  expect(r.top.reduce((s, c) => s + c.amount, 0) + r.restTotal).toBe(r.spent);
  expect(deltaLine(r, fmt)).toBe(
    `₹${(21560 - SPENT).toLocaleString('en-IN')} less than October (−${Math.abs(r.deltaPct)}%)`
  );
});

test('savedPct with no income is null (the screen shows —); a first month has no percent', () => {
  const r = review(nov, [ex('a', 11, 3, 100, 'Food')], {}, { now });
  expect(r.savedPct).toBeNull();
  expect(r.deltaPct).toBeNull();
  expect(deltaLine(r, fmt)).toBe('Nothing spent in October');
  expect(shareText(r, fmt)).toContain('Saved —');
  expect(deltaLine(review(nov, [], {}, { now }), fmt)).toBeNull();
  const same = review(nov, [ex('a', 10, 3, 100, 'Food'), ex('b', 11, 3, 100, 'Food')], {}, { now });
  expect(deltaLine(same, fmt)).toBe('Same as October');
  const more = review(nov, [ex('a', 10, 3, 100, 'Food'), ex('b', 11, 3, 150, 'Food')], {}, { now });
  expect(deltaLine(more, fmt)).toBe('₹50 more than October (+50%)');
  expect(deltaLine({ ...more, deltaPct: null }, fmt)).toBe('₹50 more than October');
});

test('over budget, biggest first, and how many stayed under', () => {
  const r = review(
    nov,
    rows,
    { categories: { Food: 4500, Bills: 4000, Transport: 2000, Health: 1000, Rent: 0 } },
    { now }
  );
  expect(r.overBudget).toEqual([
    { category: 'Food', by: 620, budget: 4500 },
    { category: 'Bills', by: 310, budget: 4000 },
  ]);
  expect(r.underCount).toBe(2);
  expect(review(nov, rows, undefined, { now }).overBudget).toEqual([]);
});

test('notes: the payee group, uncategorised count, setup nudges (max 3)', () => {
  const sbi = { id: 'sbi', name: 'SBI Card', type: 'Credit Card', last4: '1987' };
  const r = review(nov, rows, {}, { accounts: [sbi], now });
  expect(r.notes.map((n) => n.text)).toEqual([
    'Food delivery 9 times (₹3,210)',
    '1 transaction still uncategorised',
    'SBI Card ••1987 not set up',
  ]);
  const quiet = review(
    nov,
    rows.filter((x) => !x.id.startsWith('sw') && x.id !== 'g1'),
    {},
    { now, lastBackupAt: new Date(2026, 10, 1).toISOString() }
  );
  expect(quiet.notes.map((n) => n.text)).toEqual(['No backup in 31 days']);
  expect(review(nov, [], {}, { now }).notes.map((n) => n.text)).toEqual(['No backup yet']);
  expect(
    review(
      nov,
      [ex('u', 11, 3, 5, undefined), ex('v', 11, 4, 5, 'Other')],
      {},
      { now, lastBackupAt: now.toISOString() }
    ).notes[0].text
  ).toBe('2 transactions still uncategorised');
});

test('the payee group: built-in groups, else the payee itself; needs 3', () => {
  const rides = ['Uber', 'OLA CABS', 'Rapido'].map((m, i) =>
    ex(`r${i}`, 11, 3 + i, 100, 'Transport', { merchant: m })
  );
  expect(topPayeeGroup(rides, nov)).toEqual({ label: 'Rides', count: 3, total: 300 });
  const gym = [1, 2, 3].map((i) => ex(`g${i}`, 11, i, 50, 'Health', { merchant: 'Cult Fit' }));
  expect(topPayeeGroup(gym, nov)).toEqual({ label: 'Cult Fit', count: 3, total: 150 });
  expect(topPayeeGroup(gym.slice(0, 2), nov)).toBeNull();
  expect(topPayeeGroup([null, ex('x', 11, 1, 5, null, { merchant: null })], nov)).toBeNull();
  expect(topPayeeGroup(undefined, nov)).toBeNull();
});

test('month boundaries: just after midnight on the 1st is the new month (local time)', () => {
  const edge = [
    { ...ex('late', 10, 31, 70, 'Food'), fullDate: at(10, 31, 23, 59) },
    { ...ex('early', 11, 1, 30, 'Food'), fullDate: at(11, 1, 0, 1) },
  ];
  const r = review(nov, edge, {}, { now });
  expect([r.spent, r.prevSpent]).toEqual([30, 70]);
});

test('share text has totals and categories, never single payees', () => {
  const r = review(nov, rows, { categories: { Food: 4500 } }, { now });
  const text = shareText(r, fmt);
  expect(text.split('\n')[0]).toBe('November 2026 in review');
  expect(text).toContain(
    'Where it went: Food ₹5,120, Bills ₹4,310, Subscriptions ₹1,998, Transport ₹1,240, everything else ₹2,100'
  );
  expect(text).toContain('Over budget: Food by ₹620');
  expect(text).not.toMatch(/Swiggy|Zomato|Google|delivery/);
  const small = shareText(review(nov, [ex('a', 11, 1, 5, 'Food')], {}, { now }), fmt);
  expect(small).not.toContain('everything else');
  expect(shareText(review(nov, [], {}, { now }), fmt)).toBe(
    'November 2026 in review\nSpent ₹0\nIncome ₹0 · Saved —'
  );
});

test('when: the Home card on the 1st–7th; the next 1st at 9:00', () => {
  expect(showReviewCard(new Date(2026, 11, 7, 23))).toBe(true);
  expect(showReviewCard(new Date(2026, 11, 8))).toBe(false);
  expect(nextReviewAt(new Date(2026, 10, 26))).toEqual({
    at: new Date(2026, 11, 1, 9),
    month: new Date(2026, 10, 1),
  });
  expect(nextReviewAt(new Date(2026, 11, 1, 8))).toEqual({
    at: new Date(2026, 11, 1, 9),
    month: new Date(2026, 10, 1),
  });
  expect(nextReviewAt(new Date(2026, 11, 1, 9))).toEqual({
    at: new Date(2027, 0, 1, 9),
    month: new Date(2026, 11, 1),
  });
  expect(monthKeyOf(prevMonth(new Date(2027, 0, 15)))).toBe('2026-12');
  expect(monthFromKey('2026-11')).toEqual(new Date(2026, 10, 1));
  expect(monthFromKey('2026-13')).toBeNull();
  expect(monthFromKey(undefined)).toBeNull();
});

test('the reminder is planned once per date and replaced when the date moves on', async () => {
  const Notifications = require('expo-notifications');
  const Storage = require('../data/Storage').default;
  const { scheduleMonthReview } = require('../utils/MonthReviewReminder');
  await scheduleMonthReview(new Date(2026, 10, 26));
  await scheduleMonthReview(new Date(2026, 10, 27));
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync.mock.calls[0][0]).toMatchObject({
    content: { title: 'Your November summary is ready', data: { screen: 'MonthReview', month: '2026-11' } },
    trigger: { date: new Date(2026, 11, 1, 9) },
  });
  await scheduleMonthReview(new Date(2026, 11, 2));
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('n1');
  expect(Notifications.scheduleNotificationAsync.mock.calls[1][0].content.title).toBe(
    'Your December summary is ready'
  );
  expect(JSON.parse(await Storage.getItem('month_review_notification')).at).toBe(
    new Date(2027, 0, 1, 9).toISOString()
  );
  expect((await scheduleMonthReview()) > new Date()).toBe(true);
});

test('edge cases: ties, bad amounts, defaults, a refund bigger than the month', () => {
  // two payees with 3 each: the bigger total wins; equal totals keep a stable choice
  const a = [1, 2, 3].map((i) => ex(`a${i}`, 11, i, 10, 'X', { merchant: 'Alpha' }));
  const b = [1, 2, 3].map((i) => ex(`b${i}`, 11, i, 20, 'X', { merchant: 'Beta' }));
  expect(topPayeeGroup([...a, ...b], nov).label).toBe('Beta');
  expect(topPayeeGroup([...a, ex('a4', 11, 4, 'x', 'X', { merchant: 'Alpha' })], nov)).toEqual({
    label: 'Alpha',
    count: 4,
    total: 30,
  });
  // two categories with the same amount sort by name
  const tie = review(nov, [ex('t1', 11, 1, 5, 'Beta'), ex('t2', 11, 1, 5, 'Alpha')], {}, { now });
  expect(tie.top.map((c) => c.category)).toEqual(['Alpha', 'Beta']);
  // a refund bigger than the month's spending: shares stay 0, nothing breaks
  const neg = review(
    nov,
    [
      {
        id: 'r',
        type: 'income',
        amount: 50,
        refundOf: 'x',
        refundCategory: 'Food',
        refundDate: at(11, 1),
        fullDate: at(11, 2),
      },
    ],
    {},
    { now }
  );
  expect(neg.spent).toBe(-50);
  expect(neg.top).toEqual([]);
  expect(review(nov).spent).toBe(0);
  expect(review(nov, rows).notes.length).toBeGreaterThan(0);
  expect(showReviewCard() === new Date().getDate() <= 7).toBe(true);
  expect(nextReviewAt().at > new Date()).toBe(true);
});
