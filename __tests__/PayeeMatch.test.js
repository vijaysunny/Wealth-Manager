import {
  payeeKey,
  payeeName,
  diffEdit,
  findSimilar,
  willChangeFor,
  sourceOf,
  isLocked,
} from '../utils/PayeeMatch';

const tx = (over = {}) => ({
  id: 1,
  type: 'expense',
  amount: 100,
  merchant: 'SWIGGY INST',
  title: 'SWIGGY INST',
  category: 'General',
  tags: ['auto-sms'],
  fullDate: '2026-11-10T10:00:00.000Z',
  ...over,
});

describe('payeeKey', () => {
  test('case, punctuation and spaces are normalised', () => {
    expect(payeeKey(tx({ merchant: 'Shri Manjunath Medi' }))).toBe(
      payeeKey(tx({ merchant: '  SHRI   MANJUNATH. MEDI ' }))
    );
    expect(payeeKey(tx({ merchant: 'Shri Manjunath Medi' }))).toBe('shri manjunath medi');
  });
  test('& becomes and; trailing company words are dropped', () => {
    expect(payeeKey(tx({ merchant: 'Tata & Sons Pvt. Ltd.' }))).toBe('tata and sons');
    expect(payeeKey(tx({ merchant: 'Acme Payments India Private Limited' }))).toBe('acme');
  });
  test('ref digits and trailing number runs are dropped', () => {
    expect(payeeKey(tx({ merchant: 'AMAZON PAY 1234' }))).toBe('amazon pay');
    expect(payeeKey(tx({ merchant: 'Zomato ref987654321' }))).toBe('zomato');
  });
  test('a VPA wins over any name', () => {
    expect(payeeKey(tx({ vpa: 'ABC@okaxis', merchant: 'Someone' }))).toBe('abc@okaxis');
  });
  test('generic payees and category names never group', () => {
    for (const m of ['', 'Transfer', 'UPI transfer', 'ATM', 'cash', 'Transaction'])
      expect(payeeKey(tx({ merchant: m, title: m, category: 'Shopping' }))).toBeNull();
    expect(payeeKey(tx({ merchant: null, title: 'Food', category: 'Food' }))).toBeNull();
    expect(payeeKey(tx({ merchant: 'Food' }))).toBeNull();
    expect(payeeKey(tx({ merchant: 'Gym' }), { categories: ['Gym'] })).toBeNull();
    expect(payeeKey(null)).toBeNull();
  });
  test('no fuzzy matching', () => {
    expect(payeeKey(tx({ merchant: 'SWIGGY INST' }))).not.toBe(
      payeeKey(tx({ merchant: 'Swiggy Instamart' }))
    );
  });
  test('counterparty is used when there is no merchant', () => {
    expect(payeeKey(tx({ merchant: null, title: 'General', counterparty: 'RAVI K' }))).toBe('ravi k');
  });
});

describe('payeeName', () => {
  test('a title that repeats the category is no name', () => {
    expect(payeeName(tx({ merchant: null, title: 'General' }))).toBe('');
    expect(payeeName(tx())).toBe('SWIGGY INST');
  });
});

describe('diffEdit', () => {
  test('name only', () => {
    expect(diffEdit(tx(), tx({ merchant: 'Swiggy Instamart', title: 'Swiggy Instamart' }))).toEqual({
      name: { from: 'SWIGGY INST', to: 'Swiggy Instamart' },
    });
  });
  test('category only', () => {
    expect(diffEdit(tx(), tx({ category: 'Food' }))).toEqual({ category: { from: 'General', to: 'Food' } });
  });
  test('tags add and remove only; system tags ignored; case and # normalised', () => {
    expect(diffEdit(tx({ tags: ['work', 'auto-sms'] }), tx({ tags: ['#Groceries'] }))).toEqual({
      tags: { add: ['groceries'], remove: ['work'] },
    });
    expect(diffEdit(tx({ tags: ['Work'] }), tx({ tags: ['work', 'auto-sync'] }))).toEqual({});
  });
  test('all three', () => {
    const d = diffEdit(tx(), tx({ merchant: 'X', title: 'X', category: 'Food', tags: ['a'] }));
    expect(Object.keys(d).sort()).toEqual(['category', 'name', 'tags']);
  });
  test('amount, date, account, files or count in reports alone give {}', () => {
    expect(
      diffEdit(
        tx(),
        tx({
          amount: 5,
          fullDate: '2026-11-01T00:00:00.000Z',
          accountId: 3,
          attachments: [{ id: 1 }],
          excludeFromReports: true,
        })
      )
    ).toEqual({});
  });
  test('clearing the name is not a change to copy', () => {
    expect(diffEdit(tx(), tx({ merchant: null, title: 'General' }))).toEqual({});
  });
});

describe('findSimilar', () => {
  const before = tx({ id: 1 });
  const after = tx({
    id: 1,
    merchant: 'Swiggy Instamart',
    title: 'Swiggy Instamart',
    category: 'Food',
    tags: ['groceries'],
  });
  const others = [
    tx({ id: 2, fullDate: '2026-11-01T00:00:00.000Z' }),
    tx({ id: 3, fullDate: '2026-11-05T00:00:00.000Z' }),
    tx({ id: 4, type: 'income' }),
    tx({ id: 5, merchant: 'Zomato', title: 'Zomato' }),
    tx({ id: 6, loanLink: { loanId: 9 } }),
    tx({ id: 7, type: 'transfer' }),
    tx({ id: 8, deleted: true }),
  ];
  test('matches on the old name, same type, not self, newest first; loans and transfers skipped', () => {
    const r = findSimilar(before, after, [after, ...others]);
    expect(r.matches.map((m) => m.id)).toEqual([3, 2]);
    expect(r.matches[0].willChange).toEqual(['name', 'category', 'tags']);
    expect(r.skipped).toEqual([
      { id: 6, reason: 'loan' },
      { id: 7, reason: 'transfer' },
    ]);
    expect(Object.keys(r.changes).sort()).toEqual(['category', 'name', 'tags']);
  });
  test('also matches rows already carrying the new name', () => {
    const renamed = tx({ id: 9, merchant: 'Swiggy Instamart', title: 'Swiggy Instamart' });
    const r = findSimilar(before, after, [renamed]);
    expect(r.matches.map((m) => m.id)).toEqual([9]);
    expect(r.matches[0].willChange).toEqual(['category', 'tags']);
  });
  test('a row needing only a tag is a match; one already matching every change is not', () => {
    const b = tx({ id: 1 });
    const a = tx({ id: 1, tags: ['groceries'] });
    const r = findSimilar(b, a, [tx({ id: 2 }), tx({ id: 3, tags: ['groceries'] })]);
    expect(r.matches.map((m) => m.id)).toEqual([2]);
    expect(r.matches[0].willChange).toEqual(['tags']);
  });
  test('a removed tag counts as a change', () => {
    const r = findSimilar(tx({ id: 1, tags: ['work'] }), tx({ id: 1, tags: [] }), [
      tx({ id: 2, tags: ['work'] }),
    ]);
    expect(r.matches[0].willChange).toEqual(['tags']);
  });
  test('rows set by hand keep their category and name but get tags', () => {
    const hand = tx({ id: 2, categorySource: 'user', category: 'Health' });
    const named = tx({ id: 3, nameSource: 'user' });
    const r = findSimilar(before, after, [hand, named]);
    expect(r.matches.find((m) => m.id === 2).willChange).toEqual(['name', 'tags']);
    expect(r.matches.find((m) => m.id === 3).willChange).toEqual(['category', 'tags']);
    expect(r.keptCategory).toBe(1);
    expect(r.keptName).toBe(1);
  });
  test('nothing when there is no change, no payee, or the edit is a transfer', () => {
    expect(findSimilar(before, tx({ id: 1, amount: 3 }), others).matches).toEqual([]);
    const generic = tx({ id: 1, merchant: null, title: 'General' });
    expect(
      findSimilar(generic, { ...generic, category: 'Food' }, [
        tx({ id: 2, merchant: null, title: 'General' }),
      ]).matches
    ).toEqual([]);
    const tr = tx({ id: 1, type: 'transfer' });
    expect(findSimilar(tr, { ...tr, tags: ['x'] }, [tx({ id: 2, type: 'transfer' })]).matches).toEqual([]);
  });
  test('willChangeFor follows the ticked changes', () => {
    const r = findSimilar(before, after, others);
    const { name, tags } = r.changes;
    expect(willChangeFor(others[0], { name, tags })).toEqual(['name', 'tags']);
    expect(willChangeFor(others[0], {})).toEqual([]);
  });
});

describe('sources', () => {
  test('old rows count as parser; user and bulk are locked', () => {
    expect(sourceOf({}, 'category')).toBe('parser');
    expect(sourceOf({ nameSource: 'rule' }, 'name')).toBe('rule');
    expect(isLocked('user')).toBe(true);
    expect(isLocked('bulk')).toBe(true);
    expect(isLocked('rule')).toBe(false);
  });
});

describe('edge cases', () => {
  test('rows without tags, dates or a category; null rows in the list', () => {
    const b = { id: 1, type: 'expense', merchant: 'Acme' };
    const a = { ...b, category: 'Food', tags: ['x'] };
    expect(diffEdit(b, a)).toEqual({ category: { from: '', to: 'Food' }, tags: { add: ['x'], remove: [] } });
    const r = findSimilar(b, a, [
      null,
      { id: 2, type: 'expense', merchant: 'ACME' },
      { id: 3, type: 'expense', merchant: 'acme', fullDate: '2026-01-01' },
    ]);
    expect(r.matches.map((m) => m.id)).toEqual([3, 2]);
    expect(findSimilar(b, a, undefined).matches).toEqual([]);
  });
  test('a category cleared to nothing is not copied', () => {
    expect(diffEdit(tx(), tx({ category: '' }))).toEqual({});
  });
  test('payeeOf falls back to Transfer / Transaction', () => {
    expect(payeeKey({ type: 'transfer' })).toBeNull();
    expect(payeeKey({ type: 'expense' })).toBeNull();
  });
});
