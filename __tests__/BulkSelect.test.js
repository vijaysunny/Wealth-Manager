import {
  selectionTotal,
  eligibleFor,
  sharedTags,
  reportsAction,
  tagChange,
  selectedRows,
} from '../utils/BulkSelect';

const rows = [
  { id: 1, type: 'expense', amount: 350, tags: ['work', 'tax'] },
  { id: 2, type: 'expense', amount: 322.1, tags: ['work', 'auto-sms'], excludeFromReports: true },
  { id: 3, type: 'income', amount: 1000, tags: ['work'] },
  { id: 4, type: 'transfer', amount: 500 },
  { id: 5, type: 'expense', amount: 30, loanLink: { loanId: 1 } },
  null,
];

test('selectionTotal sums selected expenses only', () => {
  expect(selectionTotal(rows, ['1', '2', 3, 4])).toBe(672.1);
  expect(selectionTotal(rows, new Set())).toBe(0);
  expect(selectionTotal(undefined, [1])).toBe(0);
  expect(selectionTotal([{ id: 9, type: 'expense', amount: 'x' }], [9])).toBe(0);
});

test('eligibleFor skips loan payments and transfers with a note', () => {
  expect(eligibleFor(rows, [1, 4, 5])).toEqual({
    ids: [1],
    skipped: 2,
    note: '2 skipped (loan payments / transfers)',
  });
  expect(eligibleFor(rows, [5])).toEqual({ ids: [], skipped: 1, note: '1 skipped (loan payments)' });
  expect(eligibleFor(rows, [4]).note).toBe('1 skipped (transfers)');
  expect(eligibleFor(rows, [1, 2])).toEqual({ ids: [1, 2], skipped: 0, note: '' });
  expect(eligibleFor(rows, undefined).ids).toEqual([]);
});

test('sharedTags: user tags on every selected row', () => {
  expect(sharedTags(rows, [1, 2, 3])).toEqual(['work']);
  expect(sharedTags(rows, [1])).toEqual(['work', 'tax']);
  expect(sharedTags(rows, [])).toEqual([]);
});

test('reportsAction flips to Count in reports when all are left out', () => {
  expect(reportsAction(rows, [2])).toEqual({ label: 'Count in reports', exclude: false });
  expect(reportsAction(rows, [1, 2])).toEqual({ label: 'Not in reports', exclude: true });
  expect(reportsAction(rows, [])).toEqual({ label: 'Not in reports', exclude: true });
});

test('tagChange', () => {
  expect(tagChange('#Tax 2026')).toEqual({ tags: { add: ['tax-2026'], remove: [] } });
  expect(tagChange('work', true)).toEqual({ tags: { add: [], remove: ['work'] } });
  expect(tagChange('  ')).toBeNull();
  expect(selectedRows(rows, [1]).map((r) => r.id)).toEqual([1]);
});
