/** Phase 14 E5: Review → Check offers refund matches; Transaction detail shows both links. */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return { useFocusEffect: (cb) => R.useEffect(cb, []), useNavigation: () => ({ navigate: jest.fn() }) };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('../../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));
jest.setTimeout(30000);

const Storage = require('../../data/Storage').default;
const { addMany, getAll } = require('../../data/TransactionRepo');
const ReviewAccountsScreen = require('../../screens/ReviewAccountsScreen').default;
const EditTransactionScreen = require('../../screens/EditTransactionScreen').default;

const at = (d) => new Date(2026, 10, d, 12).toISOString();
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), push: jest.fn() });
const byId = async () => Object.fromEntries((await getAll()).map((t) => [t.id, t]));

beforeEach(async () => {
  await Storage.clear();
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([{ id: 'card', name: 'Axis Card', type: 'Credit Card', last4: '9070', balance: 0 }])
  );
  await addMany(
    [
      {
        id: 'buy',
        type: 'expense',
        amount: 1499,
        merchant: 'Amazon',
        category: 'Shopping',
        accountId: 'card',
        account: 'Axis Card',
        fullDate: at(10),
        date: '10 Nov 2026',
      },
      {
        id: 'big',
        type: 'expense',
        amount: 2840,
        merchant: 'Amazon',
        category: 'Shopping',
        accountId: 'card',
        account: 'Axis Card',
        fullDate: at(12),
        splits: [{ id: 1, amount: 2840, category: 'Shopping' }],
      },
      {
        id: 'r',
        type: 'income',
        amount: 1499,
        merchant: 'Amazon',
        accountId: 'card',
        account: 'Axis Card',
        fullDate: at(23),
        refundCandidate: true,
        reviewStatus: 'confirmed',
      },
    ],
    { dedup: false }
  );
});

test('Review → Check: best match first, split shown as a part refund, Link refund links it', async () => {
  render(<ReviewAccountsScreen navigation={nav()} />);
  fireEvent.press(await screen.findByRole('tab', { name: /^Check · 1/ }));
  fireEvent.press(await screen.findByRole('button', { name: 'Match to a purchase' }));
  expect(screen.getByText('Refund of ₹1,499 from Amazon')).toBeTruthy();
  expect(screen.getByText('Best match')).toBeTruthy();
  expect(screen.getByText(/would be a part refund/)).toBeTruthy();
  expect(screen.getByText(/November Shopping goes down by ₹1,499/)).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Link refund' })));
  await waitFor(async () => expect((await byId()).r.refundOf).toBe('buy'));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Match to a purchase' })).toBeNull());
});

test('Not a refund keeps it income and drops the hint', async () => {
  render(<ReviewAccountsScreen navigation={nav()} />);
  fireEvent.press(await screen.findByRole('tab', { name: /^Check · 1/ }));
  fireEvent.press(await screen.findByRole('button', { name: 'Match to a purchase' }));
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Not a refund' })));
  await waitFor(async () => expect((await byId()).r.refundDismissed).toBe(true));
});

test('detail: the refund opens its purchase and can be unlinked; the purchase shows Refunded', async () => {
  const { linkRefund } = require('../../utils/FeatureService');
  await linkRefund('r', 'buy');
  const rows = await byId();
  const n = nav();
  const { unmount } = render(
    <EditTransactionScreen navigation={n} route={{ params: { transaction: rows.r } }} />
  );
  fireEvent.press(await screen.findByRole('button', { name: /^Refund of Amazon/ }));
  expect(n.push).toHaveBeenCalledWith('TransactionDetail', {
    transaction: expect.objectContaining({ id: 'buy' }),
  });
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Unlink refund' })));
  await waitFor(async () => expect((await byId()).r.refundOf).toBeUndefined());
  unmount();
  await linkRefund('r', 'buy');
  render(<EditTransactionScreen navigation={n} route={{ params: { transaction: (await byId()).buy } }} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Refunded ₹1,499' }));
  expect(n.push).toHaveBeenLastCalledWith('TransactionDetail', {
    transaction: expect.objectContaining({ id: 'r' }),
  });
});
