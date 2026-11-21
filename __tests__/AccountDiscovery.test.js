import { discoverAccounts, checkItems, waitingCount } from '../utils/AccountDiscovery';

let n = 0;
const cap = (o = {}) => {
  n += 1;
  return {
    id: `t${n}`,
    smsId: `s${n}`,
    accountUnresolved: true,
    reviewReason: 'new_account',
    reviewStatus: 'pending',
    accountType: 'Bank Account',
    bankName: 'Axis Bank',
    last4: '0973',
    fullDate: new Date(Date.UTC(2026, 10, 1 + n)).toISOString(),
    ...o,
  };
};
const axisCard = (o) => cap({ accountType: 'Credit Card', last4: '9070', ...o });
const sbiCard = (o) => cap({ accountType: 'Credit Card', bankName: 'SBI', last4: '1987', ...o });

test('empty input → no groups', () => {
  expect(discoverAccounts([])).toEqual([]);
  expect(discoverAccounts()).toEqual([]);
});

test('groups by signature with counts, biggest first', () => {
  const txs = [cap(), cap(), cap(), axisCard(), axisCard(), sbiCard()];
  const groups = discoverAccounts(txs);
  expect(groups.map((g) => [g.suggested.name, g.count])).toEqual([
    ['Axis Bank ••0973', 3],
    ['Axis Bank Credit Card ••9070', 2],
    ['SBI Credit Card ••1987', 1],
  ]);
  expect(groups[0].txIds).toHaveLength(3);
  expect(groups[0].suggested).toMatchObject({ type: 'Bank Account', last4: '0973', bankName: 'Axis Bank' });
  expect(waitingCount(groups)).toBe(6);
});

test('ignores resolved, confirmed and other review reasons', () => {
  const txs = [
    cap({ accountUnresolved: false }),
    cap({ reviewReason: 'pick_account' }),
    cap({ reviewStatus: 'confirmed' }),
    { id: 'manual', type: 'expense' },
    null,
  ];
  expect(discoverAccounts(txs)).toEqual([]);
});

test('a no-digits Axis debit folds into the single Axis savings group', () => {
  const txs = [cap(), cap({ last4: null, id: 'google' })];
  const [g, ...rest] = discoverAccounts(txs);
  expect(rest).toEqual([]);
  expect(g.count).toBe(2);
  expect(g.txIds).toContain('google');
  expect(g.suggested.name).toBe('Axis Bank ••0973');
  expect(g.firstTxId).not.toBe('google');
});

test('no-digits group stays separate when two digit groups of that bank exist', () => {
  const txs = [cap(), cap({ last4: '1111' }), cap({ last4: null })];
  expect(discoverAccounts(txs)).toHaveLength(3);
});

test('no-digits group never folds into a card group', () => {
  const txs = [axisCard(), cap({ last4: null })];
  expect(discoverAccounts(txs)).toHaveLength(2);
});

test('carries the latest available limit seen for a card', () => {
  const txs = [
    axisCard({ availableLimit: 270000, fullDate: '2026-11-01T00:00:00Z' }),
    axisCard({ availableLimit: 275511.19, fullDate: '2026-11-17T00:00:00Z' }),
    axisCard({ fullDate: '2026-11-18T00:00:00Z' }),
  ];
  expect(discoverAccounts(txs)[0].availableLimit).toBeCloseTo(275511.19, 2);
  expect(discoverAccounts([cap()])[0].availableLimit).toBeNull();
});

test('keeps the stored suggestion when the capture has one', () => {
  const s = { name: 'My Axis', type: 'Bank Account', last4: '0973' };
  expect(discoverAccounts([cap({ suggestedAccount: s })])[0].suggested).toBe(s);
});

test('same count sorts by name', () => {
  const groups = discoverAccounts([sbiCard(), axisCard()]);
  expect(groups.map((g) => g.suggested.name)).toEqual([
    'Axis Bank Credit Card ••9070',
    'SBI Credit Card ••1987',
  ]);
});

test('checkItems = pending review items that are not new-account groups', () => {
  const txs = [
    cap(),
    cap({ reviewReason: 'pick_account' }),
    { id: 'x', reviewStatus: 'pending', transferCandidate: true },
  ];
  expect(checkItems(txs).map((t) => t.reviewReason || t.id)).toEqual(['pick_account', 'x']);
});
