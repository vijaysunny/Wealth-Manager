/** C5.6 Budget: spent vs budget, Set, carry forward, category rows and limit sheet. */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { addMany } from '../../data/TransactionRepo';
import { getMonthlyBudget } from '../../utils/MonthlyBudgets';
import BudgetScreen from '../../screens/BudgetScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
}));
jest.setTimeout(30000);

const now = new Date();
const at = (o) => ({
  fullDate: new Date(now.getFullYear(), now.getMonth(), 1, 12).toISOString(),
  type: 'expense',
  ...o,
});

beforeEach(async () => {
  await addMany(
    [
      at({ id: 's', amount: 1998, category: 'Subscriptions' }),
      at({ id: 'f', amount: 322, category: 'Food' }),
      at({ id: 'c', amount: 12511, type: 'transfer', category: 'Card Payment' }),
    ],
    { dedup: false }
  );
});

test('spent shows no budget, rows biggest first with Set limit, transfers excluded', async () => {
  render(<BudgetScreen navigation={{ navigate: jest.fn() }} />);
  expect(await screen.findByText('/ no budget')).toBeTruthy();
  expect(screen.getByTestId('budget-spent').props.children).toBe('₹2,320');
  expect(screen.getAllByText(' · Set limit')).toHaveLength(2);
  expect(screen.queryByText('Card Payment')).toBeNull();
  expect(screen.getByText(/^Leftover from /)).toBeTruthy();
});

test('Set saves the monthly budget', async () => {
  render(<BudgetScreen navigation={{ navigate: jest.fn() }} />);
  await screen.findByText('/ no budget');
  fireEvent.changeText(screen.getByTestId('budget-input'), '40,000');
  fireEvent.press(screen.getByRole('button', { name: 'Set' }));
  expect(await screen.findByText('/ ₹40,000')).toBeTruthy();
  expect((await getMonthlyBudget(now, [])).limit).toBe(40000);
});

test("B4: tapping a row opens that category's transactions for the month", async () => {
  const navigate = jest.fn();
  render(<BudgetScreen navigation={{ navigate }} />);
  fireEvent.press(await screen.findByTestId('cat-Food'));
  expect(navigate).toHaveBeenCalledWith('Transactions', {
    query: { date: { preset: 'thisMonth' }, categories: ['Food'], types: ['expense'] },
  });
});

test('the limit button opens the limit sheet; over the limit turns danger', async () => {
  render(<BudgetScreen navigation={{ navigate: jest.fn() }} />);
  fireEvent.press(await screen.findByTestId('limit-Food'));
  fireEvent.changeText(screen.getByTestId('limit-input'), '300');
  fireEvent.press(screen.getByRole('button', { name: 'Save limit' }));
  expect(await screen.findByText('Over by ₹22')).toBeTruthy();
  expect((await getMonthlyBudget(now, [])).categories).toEqual({ Food: 300 });
  fireEvent.press(screen.getByTestId('limit-Food'));
  fireEvent.changeText(screen.getByTestId('limit-input'), '');
  fireEvent.press(screen.getByRole('button', { name: 'Save limit' }));
  await waitFor(async () => expect((await getMonthlyBudget(now, [])).categories).toEqual({}));
});

test('carry forward switch saves rollover', async () => {
  render(<BudgetScreen navigation={{ navigate: jest.fn() }} />);
  await screen.findByText('/ no budget');
  fireEvent(screen.getByLabelText('Carry unused budget forward'), 'valueChange', true);
  await waitFor(async () => expect((await getMonthlyBudget(now, [])).rollover).toBe(true));
});
