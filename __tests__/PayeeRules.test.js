import {
  ruleFromChanges,
  mergeRule,
  restoreRule,
  countHits,
  rulePreview,
  ruleMatches,
  ruleLine,
  recentPayees,
} from '../utils/PayeeRules';

const changes = {
  name: { from: 'SWIGGY INST', to: 'Swiggy Instamart' },
  category: { from: 'General', to: 'Food' },
  tags: { add: ['groceries'], remove: ['work'] },
};

test('ruleFromChanges copies each ticked change', () => {
  expect(ruleFromChanges('swiggy inst', changes, 'SWIGGY INST')).toEqual({
    kind: 'payee',
    payeeKey: 'swiggy inst',
    label: 'SWIGGY INST',
    rename: 'Swiggy Instamart',
    category: 'Food',
    tagsAdd: ['groceries'],
    tagsRemove: ['work'],
  });
  expect(ruleFromChanges('k', { category: changes.category }).label).toBe('k');
  expect(ruleFromChanges('k', {})).toBeNull();
  expect(ruleFromChanges(null, changes)).toBeNull();
  expect(ruleFromChanges('k', { tags: { add: [], remove: [] } })).toBeNull();
});

test('a new rule is appended with an id, date and 0 hits', () => {
  const old = [{ pattern: 'uber', category: 'Transport' }];
  const r = mergeRule(old, ruleFromChanges('k', changes), Date.parse('2026-11-25T00:00:00Z'));
  expect(r.previous).toBeNull();
  expect(r.rules).toHaveLength(2);
  expect(r.rules[1]).toMatchObject({
    id: r.id,
    hits: 0,
    createdAt: '2026-11-25T00:00:00.000Z',
    category: 'Food',
  });
  expect(mergeRule(undefined, { kind: 'payee', payeeKey: 'x' }).rules).toHaveLength(1);
});

test('a second rule for the payee merges: newest wins per field, tags unioned', () => {
  const first = mergeRule([], ruleFromChanges('k', changes));
  const second = mergeRule(first.rules, {
    kind: 'payee',
    payeeKey: 'k',
    category: 'Groceries',
    tagsAdd: ['work', 'home'],
    tagsRemove: ['groceries-old'],
  });
  expect(second.id).toBe(first.id);
  expect(second.previous).toEqual(first.rules[0]);
  expect(second.rules).toHaveLength(1);
  expect(second.rules[0]).toMatchObject({
    rename: 'Swiggy Instamart',
    category: 'Groceries',
    tagsAdd: ['groceries', 'work', 'home'],
    tagsRemove: ['groceries-old'],
  });
  const third = mergeRule(second.rules, {
    kind: 'payee',
    payeeKey: 'k',
    tagsRemove: ['groceries', 'work', 'home'],
  });
  expect(third.rules[0].tagsAdd).toBeUndefined();
});

test('restoreRule removes a new rule or puts the old one back', () => {
  const first = mergeRule([], ruleFromChanges('k', changes));
  expect(restoreRule(first.rules, first)).toEqual([]);
  const second = mergeRule(first.rules, { kind: 'payee', payeeKey: 'k', category: 'X' });
  expect(restoreRule(second.rules, second)).toEqual(first.rules);
  expect(restoreRule(undefined, second)).toEqual([]);
  expect(restoreRule(undefined, first)).toEqual([]);
});

test('countHits adds one per stored transaction that used a rule', () => {
  const rules = [{ id: 'a', hits: 2 }, { id: 'b' }, { pattern: 'x' }];
  expect(countHits(rules, [{ ruleIds: ['a'] }, { ruleIds: ['a', 'b'] }, {}])).toEqual([
    { id: 'a', hits: 4 },
    { id: 'b', hits: 1 },
    { pattern: 'x' },
  ]);
  expect(countHits(rules, [{}])).toBe(rules);
  expect(countHits(undefined, [{ ruleIds: ['a'] }])).toEqual([]);
  expect(countHits(rules)).toBe(rules);
});

describe('rules screen helpers', () => {
  const rows = [
    {
      id: 1,
      type: 'expense',
      merchant: 'SWIGGY INST',
      title: 'SWIGGY INST',
      category: 'General',
      fullDate: '2026-11-02',
    },
    {
      id: 2,
      type: 'expense',
      merchant: 'Swiggy inst',
      title: 'Swiggy inst',
      category: 'Food',
      tags: ['groceries'],
      fullDate: '2026-11-03',
    },
    {
      id: 3,
      type: 'expense',
      merchant: 'Uber',
      title: 'Uber',
      note: 'trip',
      category: 'General',
      fullDate: '2026-11-04',
    },
    { id: 4, type: 'transfer', merchant: 'SWIGGY INST', fullDate: '2026-11-05' },
    {
      id: 5,
      type: 'income',
      merchant: 'SWIGGY INST',
      title: 'SWIGGY INST',
      category: 'Refund',
      fullDate: '2026-11-06',
      categorySource: 'user',
    },
    null,
  ];
  const payee = {
    id: 'p',
    kind: 'payee',
    payeeKey: 'swiggy inst',
    label: 'SWIGGY INST',
    category: 'Food',
    tagsAdd: ['groceries'],
    tagsRemove: ['x'],
    hits: 14,
  };
  test("rulePreview finds the rule's rows like the A3 sheet", () => {
    const r = rulePreview(payee, rows);
    expect(r.changes).toEqual({
      category: { from: '', to: 'Food' },
      tags: { add: ['groceries'], remove: [] },
    });
    expect(r.matches.map((m) => m.id)).toEqual([5, 1]);
    expect(r.matches[0].willChange).toEqual(['tags']);
    expect(r.keptCategory).toBe(1);
    expect(r.skipped).toEqual([{ id: 4, reason: 'transfer' }]);
    expect(rulePreview({ pattern: 'trip', category: 'Transport' }, rows).matches.map((m) => m.id)).toEqual([
      3,
    ]);
    expect(rulePreview({ pattern: '  ', category: 'X' }, rows).matches).toEqual([]);
    expect(rulePreview({ kind: 'payee', rename: 'S', label: 'L' }, undefined).changes).toEqual({
      name: { from: 'L', to: 'S' },
    });
    expect(ruleMatches({ kind: 'payee', rename: 'S' }, rows[0])).toBe(false);
    expect(ruleMatches(payee, null)).toBe(false);
  });
  test('ruleLine', () => {
    expect(ruleLine({ ...payee, rename: 'Swiggy Instamart' })).toBe(
      'SWIGGY INST → Swiggy Instamart · Food · #groceries · no #x · used 14 times'
    );
    expect(ruleLine({ pattern: 'uber', category: 'Transport', hits: 1 })).toBe(
      'Contains "uber" → Transport · used 1 time'
    );
    expect(ruleLine({ kind: 'payee', payeeKey: 'k' })).toBe('k → nothing · used 0 times');
  });
  test('recentPayees: distinct, newest first, no transfers or generic payees', () => {
    expect(recentPayees(rows)).toEqual([
      { key: 'swiggy inst', name: 'SWIGGY INST' },
      { key: 'uber', name: 'Uber' },
    ]);
    expect(recentPayees(rows, 1)).toHaveLength(1);
    expect(recentPayees(undefined)).toEqual([]);
    expect(recentPayees([{ type: 'expense', vpa: 'a@b' }])).toEqual([{ key: 'a@b', name: 'a@b' }]);
  });
});
