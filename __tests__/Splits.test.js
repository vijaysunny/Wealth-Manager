import {
  partsTotal,
  yourSpending,
  validateSplit,
  equalSplit,
  cleanParts,
  iousForSplit,
  splitChanges,
  UNSPLIT_CHANGES,
  exportRows,
} from '../utils/Splits';
import { monthSpend, monthIncome, totalsOf, categoriesOf } from '../utils/Report';
import { runQuery, defaultQuery } from '../utils/TransactionQuery';
import { findSimilar, bulkPatch } from '../utils/PayeeMatch';

const tx = {
  id: 't1',
  type: 'expense',
  amount: 2840,
  merchant: 'Amazon',
  category: 'Shopping',
  fullDate: new Date(2026, 10, 12, 12).toISOString(),
};
const parts = [
  { id: 'a', category: 'Groceries', amount: 1240 },
  { id: 'b', category: 'Electronics', amount: 1100 },
  { id: 'c', personId: 'ravi', amount: 500 },
];
const nov = new Date(2026, 10, 1);

test('sum validation shows the difference and blocks bad parts', () => {
  expect(partsTotal(parts)).toBe(2840);
  expect(yourSpending(parts)).toBe(2340);
  expect(validateSplit(tx, parts)).toEqual({ ok: true, diff: 0, errors: [] });
  expect(validateSplit(tx, parts.slice(0, 2))).toMatchObject({
    ok: false,
    diff: 500,
    errors: ['500 still to assign.'],
  });
  expect(validateSplit(tx, [...parts, { category: 'X', amount: 10 }]).errors).toEqual(['10 too much.']);
  expect(validateSplit(tx, [{ amount: 0 }]).errors).toEqual([
    'Part 1 needs an amount.',
    'Part 1 needs a category or a person.',
    '2840 still to assign.',
  ]);
  expect(validateSplit(tx, [{ category: 'A', personId: 'x', amount: 2840 }]).errors).toEqual([
    'Part 1 needs a category or a person.',
  ]);
  expect(validateSplit(tx, [{ category: 'A', amount: 2840 }]).errors[0]).toMatch(/not a split/);
  expect(validateSplit(tx, [{ personId: 'ravi', amount: 2840 }]).ok).toBe(true);
  expect(validateSplit(tx, []).errors[0]).toBe('Add at least one part.');
  expect(validateSplit(null, []).ok).toBe(false);
});

test('equal split: the rounding remainder goes to the owner', () => {
  expect(equalSplit(tx, ['ravi', 'priya'])).toEqual([
    { id: 'p0', category: 'Shopping', amount: 948 },
    { id: 'p1', personId: 'ravi', amount: 946 },
    { id: 'p2', personId: 'priya', amount: 946 },
  ]);
  expect(equalSplit({ amount: 1.5 }, ['x', 'y']).map((p) => p.amount)).toEqual([0.5, 0.5, 0.5]);
  expect(equalSplit({ amount: 1 }, ['x', 'y'])[0]).toEqual({ id: 'p0', category: 'Other', amount: 0.34 });
  const p = equalSplit(tx, ['a', 'b', 'c']);
  expect(partsTotal(p)).toBe(2840);
});

test('reports by category with splits; person parts are not spending', () => {
  const split = { ...tx, ...splitChanges(parts) };
  expect(split.splits[2]).toEqual({ id: 'c', amount: 500, personId: 'ravi' });
  expect(monthSpend([split], nov)).toEqual({
    total: 2340,
    byCategory: { Groceries: 1240, Electronics: 1100 },
  });
  expect(monthIncome([split], nov)).toBe(0);
  expect(totalsOf([split]).spent).toBe(2340);
  expect(categoriesOf(split)).toEqual(['Groceries', 'Electronics']);
  expect(runQuery([split], { ...defaultQuery(), categories: ['Electronics'] }).rows).toHaveLength(1);
  expect(runQuery([split], { ...defaultQuery(), categories: ['Shopping'] }).rows).toHaveLength(0);
});

test('unsplit restores the single category', () => {
  const split = { ...tx, ...splitChanges(parts) };
  const back = { ...split, ...UNSPLIT_CHANGES };
  expect(monthSpend([back], nov)).toEqual({ total: 2840, byCategory: { Shopping: 2840 } });
  expect(iousForSplit(tx, [], [{ id: 'old', txId: 't1', personId: 'ravi', amount: 500 }])).toEqual([]);
});

test('IOUs from a split: replaced on edit; settled parts kept and protected', () => {
  const now = '2026-11-20T00:00:00.000Z';
  const first = iousForSplit(tx, parts, [{ id: 'other', personId: 'x', amount: 1 }], { now });
  expect(first).toEqual([
    { id: 'other', personId: 'x', amount: 1 },
    {
      id: `iou_t1_ravi_${Date.parse(now)}`,
      personId: 'ravi',
      amount: 500,
      direction: 'owedToMe',
      txId: 't1',
      note: 'Amazon',
      date: tx.fullDate,
    },
  ]);
  const again = iousForSplit(
    tx,
    [...parts.slice(0, 2), { personId: 'ravi', amount: 300 }, { personId: 'ravi', amount: 200 }],
    first,
    { now }
  );
  expect(again.filter((i) => i.personId === 'ravi')).toHaveLength(1);
  const settled = [{ id: 's', txId: 't1', personId: 'ravi', amount: 200, settledAt: now }];
  expect(iousForSplit(tx, parts, settled, { now }).map((i) => [i.amount, !!i.settledAt])).toEqual([
    [200, true],
    [300, false],
  ]);
  expect(() => iousForSplit(tx, [{ personId: 'ravi', amount: 100 }], settled)).toThrow(/already settled/);
  expect(
    iousForSplit({ id: 'z', title: 'Dinner' }, [{ personId: 'p', amount: 5 }]).map((i) => i.note)
  ).toEqual(['Dinner']);
  expect(iousForSplit({ id: 'z' }, [{ personId: 'p', amount: 5 }], [], { note: 'N' })[0].note).toBe('N');
  expect(iousForSplit({ id: 'z' }, [{ personId: 'p', amount: 5 }])[0].note).toBe('Split');
});

test('cleanParts keeps only what applies', () => {
  expect(
    cleanParts([
      { amount: '10.005', category: 'A', personId: '' },
      { amount: 5, personId: 7, category: 'B' },
    ])
  ).toEqual([
    { id: 'p0', amount: 10.01, category: 'A' },
    { id: 'p1', amount: 5, personId: '7' },
  ]);
});

test('export rows: one per part with a Split of column', () => {
  const split = { ...tx, ...splitChanges(parts) };
  const rows = exportRows([split, { id: 'x', amount: 5, category: 'Food' }], { ravi: { name: 'Ravi' } });
  expect(rows.map((r) => [r.amount, r.category, r.splitOf])).toEqual([
    [1240, 'Groceries', 'Amazon'],
    [1100, 'Electronics', 'Amazon'],
    [500, 'Paid for Ravi', 'Amazon'],
    [5, 'Food', ''],
  ]);
  expect(
    exportRows([{ ...split, merchant: null, title: null, splits: [{ personId: 'q', amount: 1 }] }])[0]
  ).toMatchObject({ category: 'Paid for someone', splitOf: '' });
  expect(exportRows()).toEqual([]);
});

test("Part A: findSimilar skips split rows for a category change (reason 'split'); name and tags still apply", () => {
  const before = { id: 1, type: 'expense', merchant: 'AMZN', category: 'Shopping', fullDate: '2026-11-01' };
  const after = { ...before, category: 'Gifts' };
  const split = {
    id: 2,
    type: 'expense',
    merchant: 'AMZN',
    category: 'Shopping',
    fullDate: '2026-11-02',
    splits: parts,
  };
  const plain = { id: 3, type: 'expense', merchant: 'AMZN', category: 'Shopping', fullDate: '2026-11-03' };
  const r = findSimilar(before, after, [before, split, plain]);
  expect(r.matches.map((m) => m.id)).toEqual([3]);
  expect(r.skipped).toEqual([{ id: 2, reason: 'split' }]);
  const renamed = findSimilar(before, { ...after, merchant: 'Amazon' }, [before, split]);
  expect(renamed.matches.map((m) => [m.id, m.willChange])).toEqual([[2, ['name']]]);
  expect(renamed.skipped).toEqual([]);
  expect(bulkPatch(split, renamed.changes, { force: true })).toEqual({
    merchant: 'Amazon',
    title: 'Amazon',
    nameSource: 'bulk',
  });
});

test('edge cases: defaults and bad numbers', () => {
  expect(partsTotal()).toBe(0);
  expect(yourSpending()).toBe(0);
  expect(partsTotal([{ amount: 'x' }, { amount: 2 }])).toBe(2);
  expect(validateSplit(tx).errors).toContain('Add at least one part.');
  expect(equalSplit(null)).toEqual([{ id: 'p0', category: 'Other', amount: 0 }]);
  expect(cleanParts()).toEqual([]);
  expect(cleanParts([{ id: 'k', amount: 1, category: 'A' }])[0].id).toBe('k');
  expect(iousForSplit({ id: 'z' }, [{ category: 'A', amount: 5 }], undefined, { now: 'bad' })).toEqual([]);
  expect(
    iousForSplit({ id: 'z' }, [{ personId: 'p', amount: 5 }], [{ id: 'm', settledAt: 'x' }], {
      now: 'bad',
    })[1].id
  ).toBe('iou_z_p_0');
});
