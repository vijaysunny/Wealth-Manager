/** Phase 14 E4: splits and People through the real repo (in-memory SQLite). */
import Storage from '../data/Storage';
import { addMany, getAll } from '../data/TransactionRepo';
import {
  saveSplit,
  removeSplit,
  addPerson,
  addIou,
  setIouSettled,
  settleFromCredit,
  dismissSettle,
  saveNetWorthSnapshot,
} from '../utils/FeatureService';
import { monthSpend, monthIncome } from '../utils/Report';
import { peopleSummary, settleSuggestions } from '../utils/People';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));

const at = (d) => new Date(2026, 10, d, 12).toISOString();
const nov = new Date(2026, 10, 1);
const list = async (k) => JSON.parse((await Storage.getItem(k)) || '[]');
const byId = async () => Object.fromEntries((await getAll()).map((t) => [t.id, t]));

beforeEach(async () => {
  await Storage.clear();
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([{ id: 'bank', name: 'Bank', type: 'Bank Account', balance: 1000 }])
  );
  await addMany(
    [
      {
        id: 'amz',
        type: 'expense',
        amount: 2840,
        merchant: 'Amazon',
        category: 'Shopping',
        fullDate: at(12),
      },
      {
        id: 'cr',
        type: 'income',
        amount: 500,
        counterparty: 'RAVI K',
        vpa: 'ravik@okaxis',
        title: 'RAVI K',
        fullDate: at(24),
      },
    ],
    { dedup: false }
  );
});

test('split → IOU → settle suggestion → Yes, settle: not income, IOU closed, payee learned', async () => {
  const ravi = await addPerson('Ravi');
  await saveSplit('amz', [
    { category: 'Groceries', amount: 1240 },
    { category: 'Electronics', amount: 1100 },
    { personId: ravi.id, amount: 500 },
  ]);
  let rows = await byId();
  expect(rows.amz.splits).toHaveLength(3);
  expect(monthSpend(Object.values(rows), nov)).toEqual({
    total: 2340,
    byCategory: { Groceries: 1240, Electronics: 1100 },
  });
  let ious = await list('ious');
  expect(peopleSummary(await list('people'), ious).owedToMe).toBe(500);

  const sugg = settleSuggestions(Object.values(rows), await list('people'), ious);
  expect(sugg.map((s) => [s.tx.id, s.person.name])).toEqual([['cr', 'Ravi']]);
  await settleFromCredit('cr', ravi.id);
  rows = await byId();
  expect(rows.cr).toMatchObject({ kind: 'settlement', excludeFromReports: true });
  expect(monthIncome(Object.values(rows), nov)).toBe(0);
  ious = await list('ious');
  expect(ious[0]).toMatchObject({ settledAt: rows.cr.fullDate, settledByTxId: 'cr' });
  expect((await list('people'))[0].payeeKeys).toEqual(['ravik@okaxis']);
  // the settled part can't be removed from the split now
  await expect(removeSplit('amz')).rejects.toThrow(/already settled/);
  await expect(settleFromCredit('cr', ravi.id)).rejects.toThrow(/owes you nothing/);
});

test('a bad split is refused; removing a split restores the category and drops open IOUs', async () => {
  const ravi = await addPerson('Ravi');
  await expect(
    saveSplit('amz', [
      { category: 'A', amount: 100 },
      { personId: ravi.id, amount: 100 },
    ])
  ).rejects.toThrow(/still to assign/);
  await expect(saveSplit('nope', [])).rejects.toThrow(/no longer exists/);
  await saveSplit('amz', [
    { category: 'Shopping', amount: 2340 },
    { personId: ravi.id, amount: 500 },
  ]);
  expect(await list('ious')).toHaveLength(1);
  await removeSplit('amz');
  expect((await byId()).amz.splits).toBeUndefined();
  expect(await list('ious')).toEqual([]);
  expect(monthSpend(await getAll(), nov).total).toBe(2840);
});

test('Record "I owe", mark settled and undo; No, it\'s income; people and net worth', async () => {
  await expect(addPerson('')).rejects.toThrow(/name/);
  const kiran = await addPerson('Kiran');
  await expect(addPerson('kiran')).rejects.toThrow(/already/);
  const iou = await addIou({ personId: kiran.id, amount: 300, note: 'Movie tickets' });
  expect(peopleSummary(await list('people'), await list('ious')).iOwe).toBe(300);
  await saveNetWorthSnapshot();
  expect((await list('networth_history')).at(-1)).toMatchObject({
    assets: 1000,
    liabilities: 300,
    netWorth: 700,
  });
  await setIouSettled(iou.id);
  expect((await list('ious'))[0].settledAt).toEqual(expect.any(String));
  await setIouSettled(iou.id, false);
  expect((await list('ious'))[0].settledAt).toBeUndefined();
  await dismissSettle('cr');
  expect((await byId()).cr.settleDismissed).toBe(true);
  await expect(settleFromCredit('cr', 'gone')).rejects.toThrow(/removed/);
  await Storage.setItem('ious', 'not json');
  await expect(addIou({ personId: kiran.id, amount: 5 })).resolves.toMatchObject({ amount: 5 });
});
