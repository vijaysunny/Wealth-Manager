/**
 * D4 / A2: Review accounts screen with real storage (in-memory SQLite).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';

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
jest.setTimeout(30000);
jest.mock('../../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));

const Storage = require('../../data/Storage').default;
const { addMany, getAll } = require('../../data/TransactionRepo');
const ReviewAccountsScreen = require('../../screens/ReviewAccountsScreen').default;

const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });
const { Alert } = require('react-native');
beforeEach(() => jest.spyOn(Alert, 'alert').mockImplementation(() => {}));
let seq = 0;
const cap = (o) => {
  seq += 1;
  return {
    id: `t${seq}`,
    smsId: `sms:T:${seq}`,
    type: 'expense',
    amount: 10,
    category: 'Food',
    title: 'Food',
    fullDate: new Date(Date.UTC(2026, 10, 1, 0, 0, seq)).toISOString(),
    accountType: 'Bank Account',
    bankName: 'Axis Bank',
    last4: '0973',
    ...o,
  };
};
const axis = (n) => Array.from({ length: n }, () => cap());
const axisCard = (n) => Array.from({ length: n }, () => cap({ accountType: 'Credit Card', last4: '9070' }));
const sbiCard = (n) =>
  Array.from({ length: n }, () => cap({ accountType: 'Credit Card', bankName: 'SBI', last4: '1987' }));

beforeEach(async () => {
  seq = 0;
  await Storage.clear();
  await Storage.setItem('user_wealth_accounts', JSON.stringify([{ id: 'cash', name: 'Cash', type: 'Cash' }]));
  await addMany([...axis(12), ...axisCard(9), ...sbiCard(8)], { balanceMode: 'captured' });
});

test('renders one card per discovered account and the Add all footer', async () => {
  render(<ReviewAccountsScreen navigation={nav()} />);
  expect(await screen.findByText('Axis Bank ••0973')).toBeTruthy();
  expect(screen.getByText('Axis Bank Credit Card ••9070')).toBeTruthy();
  expect(screen.getByText('SBI Credit Card ••1987')).toBeTruthy();
  expect(screen.getByText('Savings account · 12 transactions')).toBeTruthy();
  expect(screen.getByText('New accounts · 3')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add all 3 accounts' })).toBeTruthy();
});

test('Add account on Axis resolves its 12 transactions and the card disappears', async () => {
  render(<ReviewAccountsScreen navigation={nav()} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Add Axis Bank ••0973' }));
  await waitFor(() => expect(screen.queryByText('Axis Bank ••0973')).toBeNull(), { timeout: 8000 });
  const rows = await getAll();
  const onAxis = rows.filter((t) => t.bankName === 'Axis Bank' && t.accountType === 'Bank Account');
  expect(onAxis).toHaveLength(12);
  onAxis.forEach((t) => expect(t.accountUnresolved).toBeFalsy());
  expect(screen.getByText('New accounts · 2')).toBeTruthy();
});

test('Add all empties the list', async () => {
  render(<ReviewAccountsScreen navigation={nav()} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Add all 3 accounts' }));
  await screen.findByText('No new accounts in your SMS.');
  expect((await getAll()).filter((t) => t.accountUnresolved)).toHaveLength(0);
});

test('Link to existing assigns the group to the chosen account', async () => {
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([{ id: 'mysbi', name: 'My SBI card', type: 'Credit Card', balance: 0 }])
  );
  render(<ReviewAccountsScreen navigation={nav()} />);
  fireEvent.press(
    await screen.findByRole('button', { name: 'Link SBI Credit Card ••1987 to an existing account' })
  );
  fireEvent.press(await screen.findByRole('button', { name: 'My SBI card' }));
  await waitFor(() => expect(screen.queryByText('SBI Credit Card ••1987')).toBeNull(), { timeout: 8000 });
  const sbi = (await getAll()).filter((t) => t.bankName === 'SBI');
  expect(sbi).toHaveLength(8);
  sbi.forEach((t) => expect(t.accountId).toBe('mysbi'));
});

test('Check tab lists the other review items', async () => {
  await addMany([cap({ accountType: 'Bank Account', bankName: 'Axis Bank', last4: '0973', id: 'dup' })], {
    balanceMode: 'captured',
  });
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([
      { id: 'a1', name: 'Axis Salary', type: 'Bank Account', balance: 0 },
      { id: 'a2', name: 'Axis Joint', type: 'Bank Account', balance: 0 },
    ])
  );
  await addMany([cap({ last4: null, id: 'amb' })], { balanceMode: 'captured' });
  render(<ReviewAccountsScreen navigation={nav()} />);
  fireEvent.press(await screen.findByRole('tab', { name: /^Check/ }));
  const pick = await screen.findByRole('button', { name: 'Axis Salary' });
  expect(within(screen.root).getByRole('button', { name: 'Axis Joint' })).toBeTruthy();
  fireEvent.press(pick);
  await waitFor(async () => expect((await getAll()).find((t) => t.id === 'amb').accountId).toBe('a1'));
});
