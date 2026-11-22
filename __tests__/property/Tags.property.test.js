// D1: normalizeTag is idempotent and always gives a safe slug; tag search is AND over tags.
import fc from 'fast-check';
import { normalizeTag, parseSearch, matchesSearch, addTag, removeTag } from '../../utils/Tags';

test('normalizeTag: idempotent, output matches /^[a-z0-9-]{0,32}$/', () => {
  fc.assert(
    fc.property(fc.string({ unit: 'binary', maxLength: 80 }), (s) => {
      const once = normalizeTag(s);
      expect(once).toMatch(/^[a-z0-9-]{0,32}$/);
      expect(normalizeTag(once)).toBe(once);
    }),
    { numRuns: 500 }
  );
});

test('addTag never duplicates; removeTag undoes addTag', () => {
  fc.assert(
    fc.property(
      fc.array(fc.string({ maxLength: 12 }), { maxLength: 8 }),
      fc.string({ maxLength: 12 }),
      (start, extra) => {
        const tx = { id: 1, tags: [...new Set(start.map(normalizeTag).filter(Boolean))] };
        const added = addTag(addTag(tx, extra), extra);
        expect(new Set(added.tags).size).toBe(added.tags.length);
        const n = normalizeTag(extra);
        if (n && !tx.tags.includes(n)) expect(removeTag(added, extra).tags).toEqual(tx.tags);
      }
    )
  );
});

test('tag search over 200 generated rows returns exactly the rows holding every tag', () => {
  const pool = ['tax-2026', 'work', 'trip', 'reimburse', 'family'];
  const rows = fc
    .sample(fc.record({ amount: fc.integer({ min: 1, max: 99999 }), tags: fc.subarray(pool) }), {
      numRuns: 200,
      seed: 42,
    })
    .map((r, i) => ({ id: `t${i}`, type: 'expense', title: `Payee ${i}`, ...r }));
  const ids = (q) => rows.filter((tx) => matchesSearch(tx, parseSearch(q))).map((t) => t.id);
  const expected = (tags) => rows.filter((r) => tags.every((g) => r.tags.includes(g))).map((r) => r.id);
  expect(ids('#tax-2026')).toEqual(expected(['tax-2026']));
  expect(ids('#Tax-2026 #work')).toEqual(expected(['tax-2026', 'work']));
  expect(ids('#trip #family #work')).toEqual(expected(['trip', 'family', 'work']));
  expect(ids('#tax-2026').length).toBeGreaterThan(0);
  expect(ids('#nothing')).toEqual([]);
});
