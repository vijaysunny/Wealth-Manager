import {
  defaultQuery,
  runQuery,
  dateRange,
  activeFilterChips,
  removeChip,
  activeCount,
  monthDate,
} from '../utils/TransactionQuery';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const tx = (id, over = {}) => ({
  id,
  type: 'expense',
  amount: 100,
  merchant: 'Shop',
  category: 'Food',
  accountId: 'axis',
  account: 'Axis Bank',
  fullDate: at(2026, 11, 10),
  tags: [],
  ...over,
});
const asOf = new Date(2026, 10, 25, 9); // 25 Nov 2026 local
const q = (over = {}) => ({ ...defaultQuery(), ...over });
const ids = (r) => r.rows.map((x) => x.id);

describe('dates (local time)', () => {
  const rows = [
    tx('oct31', { fullDate: new Date(2026, 9, 31, 23, 59).toISOString() }),
    tx('nov1', { fullDate: new Date(2026, 10, 1, 0, 0).toISOString() }),
    tx('nov30', { fullDate: new Date(2026, 10, 30, 23, 59).toISOString() }),
    tx('dec1', { fullDate: new Date(2026, 11, 1, 0, 0).toISOString() }),
    tx('sep1', { fullDate: new Date(2026, 8, 1, 0, 0).toISOString() }),
    tx('aug31', { fullDate: new Date(2026, 7, 31, 23, 0).toISOString() }),
    tx('mar31', { fullDate: new Date(2026, 2, 31, 23, 0).toISOString() }),
    tx('apr1', { fullDate: new Date(2026, 3, 1, 0, 0).toISOString() }),
  ];
  test('this month and last month', () => {
    expect(ids(runQuery(rows, q({ date: { preset: 'thisMonth' } }), asOf)).sort()).toEqual(['nov1', 'nov30']);
    expect(ids(runQuery(rows, q({ date: { preset: 'lastMonth' } }), asOf))).toEqual(['oct31']);
  });
  test('last 3 months = this month and the two before', () => {
    expect(ids(runQuery(rows, q({ date: { preset: 'last3' } }), asOf)).sort()).toEqual([
      'nov1',
      'nov30',
      'oct31',
      'sep1',
    ]);
  });
  test('last 3 months over a year end', () => {
    const r = dateRange({ preset: 'last3' }, new Date(2027, 0, 15));
    expect(r.from).toEqual(new Date(2026, 10, 1));
    expect(r.to).toEqual(new Date(2027, 1, 1));
  });
  test('this FY starts on 1 April', () => {
    expect(ids(runQuery(rows, q({ date: { preset: 'thisFY' } }), asOf))).not.toContain('mar31');
    expect(ids(runQuery(rows, q({ date: { preset: 'thisFY' } }), asOf))).toContain('apr1');
    expect(dateRange({ preset: 'thisFY' }, new Date(2027, 1, 10)).from).toEqual(new Date(2026, 3, 1));
    expect(dateRange({ preset: 'thisFY' }, new Date(2026, 3, 1)).from).toEqual(new Date(2026, 3, 1));
  });
  test('custom range is inclusive of both days; strings or dates', () => {
    const r = runQuery(rows, q({ date: { preset: 'custom', from: '2026-11-01', to: '2026-11-30' } }), asOf);
    expect(ids(r).sort()).toEqual(['nov1', 'nov30']);
    const open = runQuery(rows, q({ date: { preset: 'custom', from: new Date(2026, 10, 30) } }), asOf);
    expect(ids(open).sort()).toEqual(['dec1', 'nov30']);
    expect(dateRange({ preset: 'custom' }, asOf)).toEqual({ from: null, to: null });
  });
  test('all and unknown presets keep every row; bad dates are dropped by date filters only', () => {
    expect(runQuery(rows, q(), asOf).rows).toHaveLength(rows.length);
    expect(dateRange({ preset: 'nope' }, asOf)).toEqual({ from: null, to: null });
    const bad = [tx('bad', { fullDate: 'x' })];
    expect(runQuery(bad, q(), asOf).rows).toHaveLength(1);
    expect(runQuery(bad, q({ date: { preset: 'thisMonth' } }), asOf).rows).toHaveLength(0);
  });
});

describe('groups: OR inside, AND across', () => {
  const rows = [
    tx('a', { type: 'expense', category: 'Food', accountId: 'axis' }),
    tx('b', { type: 'income', category: 'Salary', accountId: 'sbi', account: 'SBI' }),
    tx('c', { type: 'transfer', category: 'Transfer', accountId: 'sbi', toAccountId: 'axis' }),
    tx('d', { type: 'expense', category: 'Bills', accountId: 'card', account: 'Card' }),
    tx('e', { type: 'expense', category: 'Food', accountId: null, account: 'Axis Bank' }),
  ];
  const accounts = [
    { id: 'axis', name: 'Axis Bank' },
    { id: 'sbi', name: 'SBI' },
  ];
  test('types', () => {
    expect(ids(runQuery(rows, q({ types: ['income', 'transfer'] }), asOf))).toEqual(['b', 'c']);
  });
  test('accounts: either side of a transfer, by id or by stored name', () => {
    expect(ids(runQuery(rows, q({ accountIds: ['axis'] }), asOf, { accounts }))).toEqual(['a', 'c', 'e']);
    expect(ids(runQuery(rows, q({ accountIds: ['card'] }), asOf))).toEqual(['d']);
  });
  test('categories, combined with types (AND)', () => {
    expect(ids(runQuery(rows, q({ categories: ['Food', 'Salary'] }), asOf))).toEqual(['a', 'b', 'e']);
    expect(ids(runQuery(rows, q({ categories: ['Food', 'Salary'], types: ['income'] }), asOf))).toEqual([
      'b',
    ]);
  });
  test('amount range is inclusive; a missing bound is open', () => {
    const rs = [
      tx('x', { amount: 500 }),
      tx('y', { amount: 2000 }),
      tx('z', { amount: 2000.01 }),
      tx('w', { amount: 499.99 }),
    ];
    expect(ids(runQuery(rs, q({ amountMin: 500, amountMax: 2000 }), asOf))).toEqual(['x', 'y']);
    expect(ids(runQuery(rs, q({ amountMin: 2000 }), asOf))).toEqual(['y', 'z']);
    expect(ids(runQuery(rs, q({ amountMax: 500 }), asOf))).toEqual(['w', 'x']);
  });
});

describe('flags', () => {
  const rows = [
    tx('review', { reviewStatus: 'pending', smsId: 's1' }),
    tx('unres', { accountUnresolved: true, smsId: 's2' }),
    tx('file', { attachments: [{ id: 1 }] }),
    tx('tags', { tags: ['work'] }),
    tx('systag', { tags: ['auto-sms'], smsId: 's3' }),
    tx('excl', { excludeFromReports: true, tags: ['imported'] }),
    tx('loan', { loanLink: { loanId: 1 }, gmailMsgId: 'g' }),
    tx('rec', { tags: ['recurring'] }),
  ];
  const f = (flag) => ids(runQuery(rows, q({ flags: [flag] }), asOf));
  test.each([
    ['needsReview', ['review', 'unres']],
    ['hasFile', ['file']],
    ['hasTags', ['tags']],
    ['notInReports', ['excl']],
    ['loanPayments', ['loan']],
    ['manual', ['file', 'tags']],
    ['sms', ['review', 'systag', 'unres']],
  ])('%s', (flag, expected) => expect(f(flag)).toEqual(expected));
  test('several flags are OR; an unknown flag matches nothing', () => {
    expect(ids(runQuery(rows, q({ flags: ['hasFile', 'loanPayments'] }), asOf))).toEqual(['file', 'loan']);
    expect(f('nope')).toEqual([]);
  });
});

test('text and #tags combine with filters', () => {
  const rows = [
    tx('a', { merchant: 'Google', tags: ['tax-2026'] }),
    tx('b', { merchant: 'Google', tags: [] }),
    tx('c', { merchant: 'Google', tags: ['tax-2026'], type: 'income' }),
  ];
  expect(ids(runQuery(rows, q({ text: 'google #tax-2026', types: ['expense'] }), asOf))).toEqual(['a']);
});

describe('sort', () => {
  const rows = [
    tx('1', { amount: 50, merchant: 'bravo', fullDate: at(2026, 11, 2) }),
    tx('2', { amount: 300, merchant: 'Alpha', fullDate: at(2026, 11, 5) }),
    tx('3', { amount: 50, merchant: 'charlie', fullDate: at(2026, 11, 5) }),
    tx('4', { amount: 300, merchant: 'alpha', fullDate: at(2026, 11, 1) }),
    tx('5', { amount: 10, merchant: null, title: null, category: 'Bills', fullDate: at(2026, 11, 3) }),
  ];
  const sorted = (sort) => ids(runQuery(rows, q({ sort }), asOf));
  test('newest and oldest; equal times break by id', () => {
    expect(sorted('newest')).toEqual(['2', '3', '5', '1', '4']);
    expect(sorted('oldest')).toEqual(['4', '1', '5', '2', '3']);
  });
  test('amount, ties newest first', () => {
    expect(sorted('amountDesc')).toEqual(['2', '4', '3', '1', '5']);
    expect(sorted('amountAsc')).toEqual(['5', '3', '1', '2', '4']);
  });
  test('payee ignores case, ties newest first', () => {
    expect(sorted('payee')).toEqual(['2', '4', '5', '1', '3']);
  });
  test('an unknown sort falls back to newest; the input is not changed', () => {
    const copy = rows.slice();
    expect(sorted('weird')).toEqual(sorted('newest'));
    expect(rows).toEqual(copy);
  });
});

test('totals follow report rules', () => {
  const rows = [
    tx('a', { amount: 100 }),
    tx('b', { amount: 50, excludeFromReports: true }),
    tx('c', { type: 'transfer', amount: 500 }),
    tx('d', { type: 'income', amount: 1000 }),
    tx('e', { amount: 10000, loanLink: { loanId: 1, interestOnly: true, principal: 9000 } }),
    tx('f', { amount: 0.1 }),
    tx('g', { amount: 0.2 }),
  ];
  expect(runQuery(rows, q(), asOf).totals).toEqual({ count: 7, spent: 1100.3, income: 1000, transfers: 500 });
});

describe('chips', () => {
  const accounts = [{ id: 'card', name: 'Axis Bank Credit Card ••9070', last4: '9070' }];
  const full = q({
    text: 'swiggy',
    date: { preset: 'thisMonth' },
    types: ['expense'],
    accountIds: ['card', 'gone'],
    categories: ['Food'],
    amountMin: 500,
    amountMax: 2000,
    flags: ['hasFile'],
    sort: 'amountDesc',
  });
  test('labels: month name, type, account with digits once, amount, flag; sort and text are not chips', () => {
    expect(activeFilterChips(full, accounts, asOf)).toEqual([
      { key: 'date', label: 'November' },
      { key: 'type:expense', label: 'Expenses' },
      { key: 'account:card', label: 'Axis Card ••9070' },
      { key: 'account:gone', label: 'Account' },
      { key: 'category:Food', label: 'Food' },
      { key: 'amount', label: '₹500–₹2,000' },
      { key: 'flag:hasFile', label: 'Has file' },
    ]);
    expect(activeCount(full)).toBe(7);
    expect(activeCount(defaultQuery())).toBe(0);
  });
  test('other date and amount labels', () => {
    const label = (over) => activeFilterChips(q(over), [], asOf)[0].label;
    expect(label({ date: { preset: 'lastMonth' } })).toBe('October');
    expect(label({ date: { preset: 'last3' } })).toBe('Last 3 months');
    expect(label({ date: { preset: 'thisFY' } })).toBe('FY 2026–27');
    expect(label({ date: { preset: 'custom', from: '2026-11-01', to: '2026-11-15' } })).toBe(
      '1 Nov – 15 Nov'
    );
    expect(label({ date: { preset: 'custom', from: '2026-11-01' } })).toBe('From 1 Nov');
    expect(label({ date: { preset: 'custom', to: '2026-11-15' } })).toBe('Until 15 Nov');
    expect(label({ amountMin: 500 })).toBe('Over ₹500');
    expect(label({ amountMax: 2000 })).toBe('Under ₹2,000');
    expect(label({ types: ['income'] })).toBe('Income');
    expect(label({ types: ['transfer'] })).toBe('Transfers');
    expect(label({ date: { preset: 'thisFY' } }, [], new Date(2027, 1, 1))).toBe('FY 2026–27');
  });
  test('removeChip removes exactly that filter; defaultQuery is fresh each time', () => {
    expect(removeChip(full, 'date').date).toEqual({ preset: 'all' });
    expect(removeChip(full, 'type:expense').types).toEqual([]);
    expect(removeChip(full, 'account:card').accountIds).toEqual(['gone']);
    expect(removeChip(full, 'category:Food').categories).toEqual([]);
    expect(removeChip(full, 'amount')).toMatchObject({ amountMin: null, amountMax: null });
    expect(removeChip(full, 'flag:hasFile').flags).toEqual([]);
    expect(removeChip(full, 'nope')).toEqual(full);
    const a = defaultQuery();
    a.types.push('x');
    expect(defaultQuery().types).toEqual([]);
  });
});

test('a query with missing fields behaves like the default', () => {
  const rows = [tx('a'), tx('b')];
  expect(runQuery(rows, { sort: 'newest' }, asOf).rows).toHaveLength(2);
  expect(runQuery(undefined, undefined, asOf).rows).toEqual([]);
  expect(activeFilterChips({}, undefined, asOf)).toEqual([]);
});

test('performance: 5,000 rows with every filter on (warning only)', () => {
  const rows = Array.from({ length: 5000 }, (_, i) =>
    tx(String(i), {
      amount: (i % 977) + 1,
      merchant: ['Swiggy', 'Uber', 'Amazon', 'Google'][i % 4],
      category: ['Food', 'Transport', 'Shopping', 'Bills'][i % 4],
      type: i % 7 === 0 ? 'income' : 'expense',
      tags: i % 5 ? [] : ['work'],
      fullDate: new Date(2026, i % 12, (i % 28) + 1, 10).toISOString(),
    })
  );
  const query = q({
    text: 'swiggy #work',
    date: { preset: 'thisFY' },
    types: ['expense'],
    accountIds: ['axis'],
    categories: ['Food', 'Bills'],
    amountMin: 10,
    amountMax: 900,
    flags: ['hasTags', 'manual'],
    sort: 'payee',
  });
  runQuery(rows, query, asOf); // warm up
  const start = performance.now();
  const r = runQuery(rows, query, asOf);
  const ms = performance.now() - start;
  expect(r.rows.length).toBeGreaterThan(0);
  if (ms > 50) console.warn(`runQuery over 5,000 rows took ${Math.round(ms)} ms (target < 50 ms)`);
  const all = runQuery(rows, q({ sort: 'payee' }), asOf);
  expect(all.rows).toHaveLength(5000);
});

test('monthDate: this month or a custom range for that month', () => {
  expect(monthDate(new Date(2026, 10, 3), asOf)).toEqual({ preset: 'thisMonth' });
  expect(monthDate(new Date(2026, 1, 3), asOf)).toEqual({
    preset: 'custom',
    from: '2026-02-01',
    to: '2026-02-28',
  });
  expect(activeFilterChips(q({ date: monthDate(new Date(2026, 1, 3), asOf) }), [], asOf)[0].label).toBe(
    '1 Feb – 28 Feb'
  );
});
