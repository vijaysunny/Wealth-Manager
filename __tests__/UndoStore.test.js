import { recordBulk, lastBulk, takeUndo, clearUndo, UNDO_TTL_MS } from '../utils/UndoStore';

const entry = (id, before, after) => ({ id, before, after });

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-25T10:00:00Z'));
  clearUndo();
});
afterEach(() => jest.useRealTimers());

test('undo restores only the changed fields', () => {
  recordBulk('apply', [
    entry(
      1,
      { category: 'General', categorySource: undefined },
      { category: 'Food', categorySource: 'bulk' }
    ),
  ]);
  const plan = takeUndo([{ id: 1, category: 'Food', categorySource: 'bulk', merchant: 'X', amount: 5 }]);
  expect(plan.patches).toEqual([{ id: 1, changes: { category: 'General', categorySource: undefined } }]);
  expect(plan.skipped).toBe(0);
  expect(lastBulk()).toBeNull(); // one level: taken once
});

test('the created rule is handed back for removal', () => {
  recordBulk('apply', [entry(1, { category: 'A' }, { category: 'B' })], {
    rule: { id: 'r1', previous: null },
  });
  expect(takeUndo([{ id: 1, category: 'B' }]).rule).toEqual({ id: 'r1', previous: null });
});

test('expires after 10 minutes', () => {
  recordBulk('apply', [entry(1, { category: 'A' }, { category: 'B' })]);
  jest.advanceTimersByTime(UNDO_TTL_MS - 1);
  expect(lastBulk()).not.toBeNull();
  jest.advanceTimersByTime(2);
  expect(lastBulk()).toBeNull();
  expect(takeUndo([{ id: 1, category: 'B' }])).toBeNull();
});

test('a row changed since is skipped and counted; a deleted row too', () => {
  recordBulk('apply', [
    entry(1, { category: 'A', tags: ['x'] }, { category: 'B', tags: ['x', 'y'] }),
    entry(2, { category: 'A' }, { category: 'B' }),
    entry(3, { category: 'A' }, { category: 'B' }),
  ]);
  const plan = takeUndo([
    { id: 1, category: 'C', tags: ['x', 'y'] },
    { id: '2', category: 'B' },
  ]);
  expect(plan.patches).toEqual([{ id: 2, changes: { category: 'A' } }]);
  expect(plan.skipped).toBe(2);
});

test('a newer bulk change replaces the older one', () => {
  recordBulk('apply', [entry(1, { category: 'A' }, { category: 'B' })]);
  recordBulk('account', [entry(2, { accountId: 1 }, { accountId: 2 })]);
  expect(lastBulk()).toMatchObject({ kind: 'account', count: 1 });
});

test('recording nothing clears the store', () => {
  recordBulk('apply', [entry(1, { category: 'A' }, { category: 'B' })]);
  recordBulk('apply', []);
  expect(lastBulk()).toBeNull();
});

test('missing arguments are safe', () => {
  recordBulk('apply');
  expect(lastBulk()).toBeNull();
  recordBulk('apply', [entry(1, { category: 'A' }, { category: 'B' })]);
  expect(takeUndo()).toEqual({ patches: [], skipped: 1, rule: null });
});
