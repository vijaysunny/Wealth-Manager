/** Deleting a transaction takes its open IOUs with it and unlinks refunds that point at it. */
import Storage from '../data/Storage';
import { addMany, getAll, remove } from '../data/TransactionRepo';
import { saveSplit, addPerson, linkRefund, bulkDelete, setIouSettled } from '../utils/FeatureService';
import { monthSpend, monthIncome } from '../utils/Report';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));

const at = (m, d) => new Date(2026, m - 1, d, 12).toISOString();
const nov = new Date(2026, 10, 1);
const dec = new Date(2026, 11, 1);
const list = async (k) => JSON.parse((await Storage.getItem(k)) || '[]');

beforeEach(async () => {
  await Storage.clear();
  await addMany(
    [
      {
        id: 'amz',
        type: 'expense',
        amount: 2840,
        category: 'Shopping',
        merchant: 'Amazon',
        fullDate: at(11, 12),
      },
      {
        id: 'shoe',
        type: 'expense',
        amount: 1499,
        category: 'Shopping',
        merchant: 'Myntra',
        fullDate: at(11, 20),
      },
      { id: 'rf', type: 'income', amount: 1499, category: 'Refund', merchant: 'Myntra', fullDate: at(12, 3) },
      { id: 'other', type: 'expense', amount: 100, category: 'Food', fullDate: at(11, 21) },
    ],
    { dedup: false }
  );
});

const splitForRavi = async () => {
  const ravi = await addPerson('Ravi');
  await saveSplit('amz', [
    { category: 'Groceries', amount: 1240 },
    { category: 'Electronics', amount: 1100 },
    { personId: ravi.id, amount: 500 },
  ]);
  return ravi;
};

test('deleting a split purchase removes its open IOU; other IOUs stay', async () => {
  const ravi = await splitForRavi();
  await Storage.setItem(
    'ious',
    JSON.stringify([
      ...(await list('ious')),
      { id: 'hand', personId: ravi.id, amount: 200, direction: 'owedToMe' },
    ])
  );
  expect((await list('ious')).map((i) => i.amount).sort()).toEqual([200, 500]);
  await remove('amz');
  expect((await list('ious')).map((i) => i.id)).toEqual(['hand']);
});

test('a settled IOU stays as history when its purchase is deleted (bulk delete)', async () => {
  await splitForRavi();
  const [iou] = await list('ious');
  await setIouSettled(iou.id, true);
  await bulkDelete(['amz', 'other']);
  expect(await list('ious')).toEqual([
    expect.objectContaining({ id: iou.id, settledAt: expect.any(String) }),
  ]);
});

test('deleting a purchase unlinks its refund: income again, November no longer lowered', async () => {
  await linkRefund('rf', 'shoe');
  expect(monthSpend(await getAll(), nov).byCategory.Shopping).toBe(2840);
  expect(monthIncome(await getAll(), dec)).toBe(0);
  await remove('shoe');
  const rows = await getAll();
  const rf = rows.find((t) => t.id === 'rf');
  expect(rf.refundOf).toBeUndefined();
  expect(rf.refundCandidate).toBe(true); // offered again in Review → Check
  expect(monthSpend(rows, nov).byCategory.Shopping).toBe(2840);
  expect(monthIncome(rows, dec)).toBe(1499);
});

test('bulk delete unlinks too; deleting something unlinked changes nothing else; a bad ious value is ignored', async () => {
  await linkRefund('rf', 'shoe');
  await Storage.setItem('ious', '{broken');
  await bulkDelete(['shoe']);
  expect((await getAll()).find((t) => t.id === 'rf').refundOf).toBeUndefined();
  await Storage.setItem('ious', JSON.stringify({ not: 'a list' }));
  expect(await remove('other')).toBe(true);
  expect(await remove('missing')).toBe(false);
});

test('deleting the credit that settled an IOU makes it owed again (People and net worth)', async () => {
  const { settleFromCredit } = require('../utils/FeatureService');
  const ravi = await splitForRavi();
  await addMany([{ id: 'back', type: 'income', amount: 300, merchant: 'RAVI K', fullDate: at(11, 25) }], {
    dedup: false,
  });
  await settleFromCredit('back', ravi.id); // part-settles the ₹500
  expect((await list('ious')).filter((i) => !i.settledAt).map((i) => i.amount)).toEqual([200]);
  await remove('back');
  const ious = await list('ious');
  expect(ious).toHaveLength(1);
  expect(ious[0]).toMatchObject({ personId: ravi.id, amount: 500 });
  expect(ious[0].settledAt).toBeUndefined();
});
