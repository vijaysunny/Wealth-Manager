import fc from 'fast-check';
import {
  normalizeTag,
  addTag,
  removeTag,
  visibleTags,
  recentTags,
  parseSearch,
  matchesSearch,
  isSystemTag,
  SYSTEM_TAGS,
} from '../utils/Tags';

test('normalizeTag', () => {
  expect(normalizeTag('  #Tax 2026! ')).toBe('tax-2026');
  expect(normalizeTag('Auto-SMS')).toBe('auto-sms');
  expect(normalizeTag('##work')).toBe('work');
  expect(normalizeTag('a  -- b')).toBe('a-b');
  expect(normalizeTag('x'.repeat(50))).toHaveLength(32);
  expect(normalizeTag('!!!')).toBe('');
  expect(normalizeTag(null)).toBe('');
});

test('normalizeTag output is always a valid slug (property)', () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      const t = normalizeTag(s);
      return /^[a-z0-9-]{0,32}$/.test(t) && normalizeTag(t) === t;
    })
  );
});

test('addTag / removeTag: no duplicates, normalised', () => {
  let tx = { id: 1, tags: ['Auto-SMS'] };
  tx = addTag(tx, '#Tax 2026');
  tx = addTag(tx, 'tax-2026');
  tx = addTag(tx, '');
  expect(tx.tags).toEqual(['auto-sms', 'tax-2026']);
  expect(removeTag(tx, '#TAX-2026').tags).toEqual(['auto-sms']);
  expect(addTag({}, 'x').tags).toEqual(['x']);
  expect(removeTag({}, 'x').tags).toEqual([]);
});

test('system tags are hidden but recognised', () => {
  expect(SYSTEM_TAGS).toEqual(['auto-sms', 'auto-sync', 'ai', 'imported', 'recurring', 'auto']);
  expect(isSystemTag('Auto-Sync')).toBe(true);
  expect(visibleTags(['Auto-SMS', '#work', 'auto-sync'])).toEqual(['work']);
  expect(visibleTags(undefined)).toEqual([]);
});

test('recentTags: newest first, unique, user tags only, limited', () => {
  const txs = [
    { fullDate: '2026-11-01T00:00:00Z', tags: ['old', 'shared'] },
    { fullDate: '2026-11-18T00:00:00Z', tags: ['auto-sms', 'tax-2026', 'shared'] },
    { fullDate: '2026-11-10T00:00:00Z', tags: ['reimburse'] },
    { tags: ['nodate'] },
  ];
  expect(recentTags(txs)).toEqual(['tax-2026', 'shared', 'reimburse', 'old', 'nodate']);
  expect(recentTags(txs, 2)).toEqual(['tax-2026', 'shared']);
  expect(recentTags()).toEqual([]);
});

test('parseSearch splits text and #tags', () => {
  expect(parseSearch('google #tax-2026 #work')).toEqual({ text: 'google', tags: ['tax-2026', 'work'] });
  expect(parseSearch('  ')).toEqual({ text: '', tags: [] });
  expect(parseSearch('#A #a Swiggy  Food')).toEqual({ text: 'swiggy food', tags: ['a'] });
  expect(parseSearch()).toEqual({ text: '', tags: [] });
});

test('matchesSearch: AND across tags; text over payee, category, amount, file names', () => {
  const tx = {
    title: 'Google',
    merchant: 'Google One',
    category: 'Subscriptions',
    amount: 1998.19,
    tags: ['auto-sms', 'tax-2026', 'subscription'],
    attachments: [{ name: 'invoice-nov.pdf' }],
  };
  expect(matchesSearch(tx, parseSearch('#tax-2026'))).toBe(true);
  expect(matchesSearch(tx, parseSearch('#tax-2026 #work'))).toBe(false);
  expect(matchesSearch(tx, parseSearch('google #subscription'))).toBe(true);
  expect(matchesSearch(tx, parseSearch('1998.19'))).toBe(true);
  expect(matchesSearch(tx, parseSearch('1,998.19'))).toBe(true);
  expect(matchesSearch(tx, parseSearch('invoice'))).toBe(true);
  expect(matchesSearch(tx, parseSearch('#auto-sms'))).toBe(true);
  expect(matchesSearch(tx, parseSearch('swiggy'))).toBe(false);
  expect(matchesSearch(tx, parseSearch(''))).toBe(true);
  expect(matchesSearch(null, parseSearch(''))).toBe(false);
  expect(matchesSearch({ amount: 'x' }, { text: 'x' })).toBe(false);
  expect(matchesSearch({ title: 'a' })).toBe(true);
});
