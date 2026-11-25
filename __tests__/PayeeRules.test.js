import { ruleFromChanges, mergeRule, restoreRule } from '../utils/PayeeRules';

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
