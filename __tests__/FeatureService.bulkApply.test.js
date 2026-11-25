import Storage from '../data/Storage';
import * as Repo from '../data/TransactionRepo';
import { bulkApply, bulkSet, undoLastBulk } from '../utils/FeatureService';
import { clearUndo } from '../utils/UndoStore';
import { findSimilar } from '../utils/PayeeMatch';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));

const tx = (id, extra = {}) => ({
  id,
  type: 'expense',
  amount: 100,
  merchant: 'SWIGGY INST',
  title: 'SWIGGY INST',
  category: 'General',
  account: 'Bank',
  accountId: 1,
  tags: ['auto-sms'],
  fullDate: `2026-11-${String(10 + Number(id)).padStart(2, '0')}T12:00:00Z`,
  ...extra,
});
const byId = async () => Object.fromEntries((await Repo.getAll()).map((t) => [String(t.id), t]));
const rules = async () => JSON.parse((await Storage.getItem('category_rules')) || '[]');
const changes = {
  name: { from: 'SWIGGY INST', to: 'Swiggy Instamart' },
  category: { from: 'General', to: 'Food' },
  tags: { add: ['groceries'], remove: ['work'] },
};

beforeEach(async () => {
  await Storage.clear();
  clearUndo();
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([
      { id: 1, type: 'Bank Account', name: 'Bank', balance: 1000 },
      { id: 2, type: 'Credit Card', name: 'Card', balance: 0 },
    ])
  );
  await Repo.addMany(
    [
      tx(1),
      tx(2, { tags: ['work'] }),
      tx(3, { category: 'Health', categorySource: 'user', nameSource: 'user' }),
    ],
    {
      dedup: false,
    }
  );
});
afterEach(() => jest.restoreAllMocks());

test('name, category and tags per row; hand-set values kept; system tags kept; through updateInDb', async () => {
  const spy = jest.spyOn(Repo, 'updateInDb');
  const r = await bulkApply([1, 2, 3], changes);
  expect(r.updated).toBe(3);
  expect(spy).toHaveBeenCalledTimes(3);
  const rows = await byId();
  expect(rows[1]).toMatchObject({
    merchant: 'Swiggy Instamart',
    title: 'Swiggy Instamart',
    category: 'Food',
    nameSource: 'bulk',
    categorySource: 'bulk',
  });
  expect(rows[1].tags).toEqual(['auto-sms', 'groceries']);
  expect(rows[2].tags).toEqual(['groceries']);
  expect(rows[3]).toMatchObject({
    merchant: 'SWIGGY INST',
    category: 'Health',
    tags: ['auto-sms', 'groceries'],
  });
});

test('one atomic batch: a missing row is skipped, nothing half-written', async () => {
  const r = await bulkApply([1, 'missing'], { category: changes.category });
  expect(r.updated).toBe(1);
});

test('undo restores names, categories, tags and sources exactly, and removes the rule', async () => {
  const before = await byId();
  await bulkApply([1, 2, 3], changes, { ruleKey: 'swiggy inst', ruleLabel: 'SWIGGY INST' });
  expect(await rules()).toEqual([
    expect.objectContaining({ kind: 'payee', payeeKey: 'swiggy inst', rename: 'Swiggy Instamart' }),
  ]);
  const spy = jest.spyOn(Repo, 'updateInDb');
  expect(await undoLastBulk()).toEqual({ restored: 3, skipped: 0 });
  expect(spy).toHaveBeenCalledTimes(3);
  const after = await byId();
  for (const id of ['1', '2', '3']) {
    for (const f of ['merchant', 'title', 'category', 'tags', 'categorySource', 'nameSource'])
      expect(after[id][f]).toEqual(before[id][f]);
  }
  expect(await rules()).toEqual([]);
  expect(await undoLastBulk()).toBeNull();
});

test('undo of a merged rule puts the older rule back', async () => {
  await bulkApply([1], { category: changes.category }, { ruleKey: 'swiggy inst' });
  const first = await rules();
  await bulkApply([2], { tags: changes.tags }, { ruleKey: 'swiggy inst' });
  expect((await rules())[0]).toMatchObject({ category: 'Food', tagsAdd: ['groceries'] });
  await undoLastBulk();
  expect(await rules()).toEqual(first);
});

test('a row edited after the bulk change is kept on undo', async () => {
  await bulkApply([1, 2], { category: changes.category });
  await Repo.update(2, { category: 'Shopping' });
  expect(await undoLastBulk()).toEqual({ restored: 1, skipped: 1 });
  const rows = await byId();
  expect(rows[1].category).toBe('General');
  expect(rows[2].category).toBe('Shopping');
});

test('bulkSet moves balances on an account change, and undo moves them back', async () => {
  await Storage.setItem('category_rules', '[]');
  await Repo.add(tx(7, { merchant: 'X', title: 'X', amount: 50 }));
  const bal = async () =>
    Object.fromEntries(
      JSON.parse(await Storage.getItem('user_wealth_accounts')).map((a) => [a.id, a.balance])
    );
  const start = await bal();
  await bulkSet([7], { accountId: 2, account: 'Card' }, 'account');
  const moved = await bal();
  expect(moved[1]).toBe(start[1] + 50);
  expect(moved[2]).not.toBe(start[2]);
  await undoLastBulk();
  expect(await bal()).toEqual(start);
  expect((await bulkSet([7], { accountId: 1, account: 'Bank' })).updated).toBe(0);
});

test('integration: findSimilar then bulkApply on the old name', async () => {
  const all = await Repo.getAll();
  const before = all.find((t) => t.id === 1);
  const after = {
    ...before,
    merchant: 'Swiggy Instamart',
    title: 'Swiggy Instamart',
    category: 'Food',
    tags: ['groceries'],
  };
  await Repo.update(1, {
    merchant: after.merchant,
    title: after.title,
    category: 'Food',
    tags: ['groceries'],
    categorySource: 'user',
    nameSource: 'user',
  });
  const { matches, changes: ch, keptCategory } = findSimilar(before, after, await Repo.getAll());
  expect(matches.map((m) => m.id)).toEqual([3, 2]);
  expect(keptCategory).toBe(1);
  await bulkApply(
    matches.map((m) => m.id),
    ch
  );
  const rows = await byId();
  expect(rows[2]).toMatchObject({ merchant: 'Swiggy Instamart', category: 'Food' });
  expect(rows[3].category).toBe('Health');
});

test('integration: a rule saved from the sheet renames, categorises and tags the next SMS; hits counted', async () => {
  await bulkApply([2], changes, { ruleKey: 'swiggy inst', ruleLabel: 'SWIGGY INST' });
  await Repo.addMany(
    [
      tx(8, { smsId: 'sms:new', merchant: 'SWIGGY INST', title: 'SWIGGY INST' }),
      tx(9, { smsId: 'sms:hand', categorySource: 'user', category: 'Health' }),
    ],
    { balanceMode: 'none' }
  );
  const rows = await byId();
  expect(rows[8]).toMatchObject({
    merchant: 'Swiggy Instamart',
    category: 'Food',
    categorySource: 'rule',
    nameSource: 'rule',
  });
  expect(rows[8].tags).toEqual(['auto-sms', 'groceries']);
  expect(rows[9].category).toBe('Health');
  expect((await rules())[0].hits).toBe(2);
});

test('rules apply to statement imports and recurring postings, not to manual entries', async () => {
  await bulkApply([2], { category: changes.category }, { ruleKey: 'swiggy inst' });
  await Repo.addMany(
    [tx(10, { tags: ['imported'] }), tx(11, { tags: ['recurring', 'auto'] }), tx(12, { tags: [] })],
    { balanceMode: 'none' }
  );
  const rows = await byId();
  expect([rows[10].category, rows[11].category, rows[12].category]).toEqual(['Food', 'Food', 'General']);
});
