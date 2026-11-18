import Storage from '../data/Storage';
import { addMany, getAll } from '../data/TransactionRepo';
import { rejectCapture } from '../utils/FeatureService';
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));
test('undone capture stays rejected across future scans', async () => {
  await Storage.clear();
  const tx = {
    id: 'one',
    smsId: 'same-source',
    type: 'expense',
    amount: 100,
    title: 'paid',
    category: 'Other',
    fullDate: '2026-10-10T12:00:00Z',
    account: 'Bank',
  };
  await addMany([tx]);
  await rejectCapture('one');
  expect((await addMany([{ ...tx, id: 'retry' }])).added).toBe(0);
  expect(await getAll()).toHaveLength(0);
});
