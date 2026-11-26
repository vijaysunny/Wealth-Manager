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
  expect(screen.getByText('Available ₹2,75,511.19 · add limit')).toBeTruthy();
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

test('B6: a card without a limit shows Set up; tapping a card opens Card detail', async () => {
  const n = nav();
  render(<WealthScreen navigation={n} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Set up Axis Card ••9070' }));
  expect(n.navigate).toHaveBeenCalledWith('CardSetup', { cardId: 'ac' });
  fireEvent.press(screen.getByTestId('account-sbi'));
  expect(n.navigate).toHaveBeenCalledWith('CardDetail', { cardId: 'sbi' });
  fireEvent.press(screen.getByTestId('account-axis'));
  expect(n.navigate).toHaveBeenCalledWith('EditAsset', expect.anything());
});

test('B6: a set-up card shows this cycle, "Pay ₹X by <date>" and what you owe; labels never repeat digits', async () => {
  const day = new Date();
  const statementDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 2);
  const list = accounts.map((a) =>
    a.id === 'ac'
      ? {
          ...a,
          name: 'Axis Bank Credit Card ••9070',
          creditLimit: 300000,
          statementDay: statementDay.getDate(),
          due: { mode: 'afterStatement', days: 4 },
          statements: [{ date: statementDay.toISOString(), totalDue: 3914, minDue: 200 }],
        }
      : a
  );
  await Storage.setItem('user_wealth_accounts', JSON.stringify(list));
  render(<WealthScreen navigation={nav()} />);
  const sub = await screen.findByTestId('card-sub-ac');
  const text = [].concat(sub.props.children).flat().join('');
  expect(text).toMatch(/^This cycle ₹[\d,.]+ · /);
  expect(screen.getByText(/^Pay ₹3,914 by \d{1,2} [A-Z][a-z]{2}$/)).toBeTruthy();
  // owed = limit − available (₹2,75,511.19 in the SMS) = ₹24,488.81
  expect((await screen.findAllByText('₹24,488.81')).length).toBeGreaterThanOrEqual(2); // row + Liabilities tile
  expect(screen.getByTestId('liabilities-total').props.children.join('')).toBe('₹24,488.81 owed');
  const labels = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel || '');
  labels.forEach((l) => {
    const groups = l.match(/\d{4}/g) || [];
    expect(new Set(groups).size).toBe(groups.length);
  });
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

test('C1: Liabilities shows both groups; a card EMI says "in card balance" and is not in the total', async () => {
  const at = (offset) => {
    const d = new Date();
    d.setMonth(d.getMonth() + offset);
    return d.toISOString();
  };
  const list = [
    ...accounts,
    {
      id: 'bajaj',
      name: 'Bajaj Finance',
      type: 'Loan',
      loanKind: 'personal',
      loanType: 'No Cost EMI',
      originalAmount: 6456,
      emiAmount: 538,
      tenure: 12,
      firstEmiDate: at(-3),
      balance: 0,
    },
    {
      id: 'emi',
      name: 'Phone EMI',
      type: 'Loan',
      loanKind: 'cardEmi',
      includedInCard: true,
      onCardId: 'ac',
      loanType: 'Reducing',
      originalAmount: 25000,
      interestRate: 15,
      emiAmount: 2256.46,
      tenure: 12,
      firstEmiDate: at(-2),
    },
    { id: 'old', name: 'Old gold loan', type: 'Loan', status: 'closed', balance: 0 },
  ];
  await Storage.setItem('user_wealth_accounts', JSON.stringify(list));
  const n = nav();
  render(<WealthScreen navigation={n} />);
  expect(await screen.findByText('Credit cards')).toBeTruthy();
  expect(screen.getByText('Loans & EMIs')).toBeTruthy();
  expect(screen.getByText(/₹538\/mo · 8 left · next /)).toBeTruthy();
  expect(screen.getByText('Phone EMI · Axis Card')).toBeTruthy();
  expect(screen.getByText(/₹2,256\/mo · 9 left · in card balance/)).toBeTruthy();
  // header total = Bajaj ₹4,304 (the Axis card from SMS isn't set up: not counted; SBI was added by hand, owes 0)
  expect(screen.getByTestId('liabilities-total').props.children.join('')).toBe('₹4,304 owed');
  expect(screen.getByTestId('cards-not-counted').props.children.join('')).toBe(
    'Axis Card ••9070 not set up · its debt is not counted yet'
  );
  expect(screen.queryByText('Old gold loan')).toBeNull();
  fireEvent.press(screen.getByText('Show closed (1)'));
  expect(screen.getByText('Old gold loan')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Add loan or EMI' }));
  expect(n.navigate).toHaveBeenCalled();
});

test('E4: People row (always), "You owe people" in Liabilities, net worth counts IOUs', async () => {
  await Storage.setItem(
    'ious',
    JSON.stringify([
      { id: 'i1', personId: 'p', amount: 500, direction: 'owedToMe', date: '2026-11-12' },
      { id: 'i2', personId: 'p', amount: 300, direction: 'iOwe', date: '2026-11-20' },
    ])
  );
  const n = nav();
  render(<WealthScreen navigation={n} />);
  expect(await screen.findByText('Net worth includes ₹500 people owe you')).toBeTruthy();
  expect(screen.getByTestId('networth').props.children).toBe('₹1,200');
  expect(screen.getByText('Owed to you ₹500 · You owe ₹300')).toBeTruthy();
  fireEvent.press(screen.getByTestId('you-owe-people'));
  fireEvent.press(screen.getByTestId('people-row'));
  expect(n.navigate.mock.calls).toEqual([['People'], ['People']]);
  await Storage.removeItem('ious');
});

test('E4: with nobody owing, the People row invites splitting', async () => {
  render(<WealthScreen navigation={nav()} />);
  expect(await screen.findByText('Topped up from Axis ••0973')).toBeTruthy();
  expect(screen.getByText('Split bills and IOUs')).toBeTruthy();
  expect(screen.queryByTestId('you-owe-people')).toBeNull();
});
