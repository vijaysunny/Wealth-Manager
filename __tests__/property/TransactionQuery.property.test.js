/** Phase 14 C1: runQuery returns a subset, sorting keeps the set, the default query keeps every row. */
import fc from 'fast-check';
import { runQuery, defaultQuery, SORTS, FLAG_LABELS } from '../../utils/TransactionQuery';

const txArb = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom('expense', 'income', 'transfer'),
  amount: fc.integer({ min: 1, max: 10000000 }).map((p) => p / 100),
  merchant: fc.constantFrom('Swiggy', 'zomato', 'Uber', null),
  category: fc.constantFrom('Food', 'Transport', 'Bills', 'General'),
  accountId: fc.constantFrom('a', 'b', 'c'),
  fullDate: fc
    .date({ min: new Date(2025, 0, 1), max: new Date(2027, 11, 31), noInvalidDate: true })
    .map((d) => d.toISOString()),
  excludeFromReports: fc.boolean(),
  tags: fc.subarray(['work', 'auto-sms', 'tax-2026']),
});
const queryArb = fc.record({
  text: fc.constantFrom('', 'swiggy', '#work', 'uber #tax-2026'),
  date: fc.constantFrom(
    { preset: 'all' },
    { preset: 'thisMonth' },
    { preset: 'last3' },
    { preset: 'thisFY' }
  ),
  types: fc.subarray(['expense', 'income', 'transfer']),
  accountIds: fc.subarray(['a', 'b', 'c']),
  categories: fc.subarray(['Food', 'Transport', 'Bills']),
  amountMin: fc.option(fc.integer({ min: 0, max: 50000 }), { nil: null }),
  amountMax: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: null }),
  flags: fc.subarray(Object.keys(FLAG_LABELS)),
  sort: fc.constantFrom(...SORTS),
});
const asOf = new Date(2026, 10, 25);

test('the result is a subset; count = rows.length; spent ≥ 0', () => {
  fc.assert(
    fc.property(fc.array(txArb, { maxLength: 60 }), queryArb, (rows, query) => {
      const { rows: out, totals } = runQuery(rows, query, asOf);
      const input = new Set(rows);
      expect(out.every((r) => input.has(r))).toBe(true);
      expect(totals.count).toBe(out.length);
      expect(totals.spent).toBeGreaterThanOrEqual(0);
    })
  );
});

test('sorting does not change the set', () => {
  fc.assert(
    fc.property(fc.array(txArb, { maxLength: 60 }), queryArb, (rows, query) => {
      const sets = SORTS.map((sort) =>
        runQuery(rows, { ...query, sort }, asOf)
          .rows.map((r) => r.id)
          .sort()
          .join(',')
      );
      expect(new Set(sets).size).toBe(1);
    })
  );
});

test('the default query keeps every row', () => {
  fc.assert(
    fc.property(fc.array(txArb, { maxLength: 60 }), (rows) => {
      expect(runQuery(rows, defaultQuery(), asOf).rows).toHaveLength(rows.length);
    })
  );
});
