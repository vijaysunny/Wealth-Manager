import { addMany, getAll } from '../data/TransactionRepo';
import Storage from '../data/Storage';
import { migrateTags, normalizedTags, TAG_MIGRATION_KEY } from '../data/TagMigration';

// babel-jest hoists this above the imports
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

test('normalizedTags: null when already clean', () => {
  expect(normalizedTags(['auto-sms', 'work'])).toBeNull();
  expect(normalizedTags(undefined)).toBeNull();
  expect(normalizedTags(['Auto-SMS', '#Work', 'work', ''])).toEqual(['auto-sms', 'work']);
});

test('migrates old tags once; safe to run twice; balances untouched', async () => {
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([{ id: 'a', name: 'Axis Bank', type: 'Bank Account', balance: 500 }])
  );
  await addMany(
    [
      {
        id: 't1',
        type: 'expense',
        amount: 10,
        accountId: 'a',
        account: 'Axis Bank',
        fullDate: '2026-11-01T10:00:00Z',
        tags: ['Auto-SMS', 'Tax 2026'],
      },
      { id: 't2', type: 'expense', amount: 20, fullDate: '2026-11-02T10:00:00Z', tags: ['Auto-Sync', 'AI'] },
      { id: 't3', type: 'expense', amount: 30, fullDate: '2026-11-03T10:00:00Z', tags: ['work'] },
      { id: 't4', type: 'expense', amount: 40, fullDate: '2026-11-04T10:00:00Z' },
    ],
    { dedup: false, balanceMode: 'none' }
  );
  expect(await migrateTags()).toEqual({ changed: 2, skipped: false });
  const byId = Object.fromEntries((await getAll()).map((t) => [t.id, t]));
  expect(byId.t1.tags).toEqual(['auto-sms', 'tax-2026']);
  expect(byId.t2.tags).toEqual(['auto-sync', 'ai']);
  expect(byId.t3.tags).toEqual(['work']);
  expect(byId.t4.tags).toBeUndefined();
  expect(byId.t1.amount).toBe(10);
  expect(JSON.parse(await Storage.getItem('user_wealth_accounts'))[0].balance).toBe(500);
  expect(await migrateTags()).toEqual({ changed: 0, skipped: true });
  await Storage.setItem(TAG_MIGRATION_KEY, 'false');
  expect(await migrateTags()).toEqual({ changed: 0, skipped: false });
});
