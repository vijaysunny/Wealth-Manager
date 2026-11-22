/** C5.5 Accounts: net-worth card numbers, missing balances, Set balance, Set due, investments. */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import Storage from '../../data/Storage';
import { addMany } from '../../data/TransactionRepo';
import WealthScreen from '../../screens/WealthScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return { useFocusEffect: (cb) => R.useEffect(cb, []) };
});
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
jest.setTimeout(30000);

const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });
const accounts = [
  { id: 'axis', name: 'Axis Bank', type: 'Bank Account', last4: '0973', balance: 0, createdFrom: 'review' },
  {
    id: 'ac',
    name: 'Axis Bank Credit Card',
    type: 'Credit Card',
    last4: '9070',
    balance: 0,
    createdFrom: 'review',
  },
  { id: 'sbi', name: 'SBI Credit Card', type: 'Credit Card', last4: '1987', balance: 0, dueDay: 5 },
  {
    id: 'lite',
    name: 'UPI Lite',
    type: 'Wallet',
    subType: 'UPI Lite',
    linkedBankId: 'axis',
    balance: 1000,
    createdFrom: 'capture',
    lastUpdated: '2026-11-18T00:00:00Z',
  },
];

beforeEach(async () => {
  await Storage.setItem('user_wealth_accounts', JSON.stringify(accounts));
  await addMany(
    [
      {
        id: 'c1',
        type: 'expense',
        amount: 30,
        accountId: 'ac',
        account: 'Axis Bank Credit Card',
        availableLimit: 275511.19,
        fullDate: new Date().toISOString(),
      },
    ],
    { dedup: false }
  );
});

test('net-worth card: total, missing balances, three numbers', async () => {
  render(<WealthScreen navigation={nav()} />);
  expect(await screen.findByText('1 balance missing · set it to see the real figure')).toBeTruthy();
  expect(screen.getByTestId('networth').props.children).toBe('₹1,000');
  expect(screen.getByText('Cash & bank')).toBeTruthy();
  expect(screen.getByText('Available ₹2,75,511.19')).toBeTruthy();
  expect(screen.getByText('Topped up from Axis ••0973')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Investments' }).props.accessibilityState.expanded).toBe(false);
  expect(screen.getByText('MF, stocks, FD/RD, PF · none added yet')).toBeTruthy();
});

test('Set balance clears the missing warning', async () => {
  render(<WealthScreen navigation={nav()} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Set balance for Axis Bank' }));
  fireEvent.changeText(screen.getByTestId('balance-input'), '25,000');
  fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(async () =>
    expect(
      JSON.parse(await Storage.getItem('user_wealth_accounts')).find((a) => a.id === 'axis').balance
    ).toBe(25000)
  );
  await waitFor(() => expect(screen.queryByText(/balance missing/)).toBeNull());
  const saved = JSON.parse(await Storage.getItem('user_wealth_accounts')).find((a) => a.id === 'axis');
  expect(saved.balance).toBe(25000);
  expect(saved.balanceSetAt).toBeTruthy();
});

test('Set due stores the day and schedules reminders', async () => {
  const Notifications = require('expo-notifications');
  render(<WealthScreen navigation={nav()} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Set due date for Axis Bank Credit Card' }));
  fireEvent.changeText(screen.getByTestId('due-input'), '12');
  fireEvent.press(screen.getAllByRole('button', { name: 'Save' }).pop());
  await waitFor(async () =>
    expect(JSON.parse(await Storage.getItem('user_wealth_accounts')).find((a) => a.id === 'ac').dueDay).toBe(
      12
    )
  );
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled();
});

test('investments open with Add rows', async () => {
  const n = nav();
  render(<WealthScreen navigation={n} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Investments' }));
  fireEvent.press(screen.getByRole('button', { name: 'Add FD / RD' }));
  expect(n.navigate).toHaveBeenCalledWith('AddInvestment', { kind: 'fd' });
});

test('D4/B3: pulling to refresh grows an FD started 90 days ago', async () => {
  const { RefreshControl } = require('react-native');
  const start = new Date(Date.now() - 90 * 86400000).toISOString();
  const fd = {
    id: 'fd',
    name: 'SBI FD',
    type: 'Fixed Deposit',
    subType: 'Fixed Deposit',
    principal: 100000,
    interestRate: 7,
    startDate: start,
    balance: 100000,
  };
  await Storage.setItem('user_wealth_accounts', JSON.stringify([...accounts, fd]));
  render(<WealthScreen navigation={nav()} />);
  await screen.findByText('Cash & bank');
  await act(async () => {
    await screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
  });
  const saved = JSON.parse(await Storage.getItem('user_wealth_accounts')).find((a) => a.id === 'fd');
  // ≈ one quarter at 7%: 1,00,000 → about 1,01,700
  expect(saved.balance).toBeGreaterThan(101500);
  expect(saved.balance).toBeLessThan(101900);
});
