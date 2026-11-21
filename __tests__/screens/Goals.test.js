/** C5.7 Goals: empty state + templates, goal card, delete confirmation. */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import Storage from '../../data/Storage';
import GoalScreen from '../../screens/GoalScreen';
import AddGoalScreen from '../../screens/AddGoalScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return { useFocusEffect: (cb) => R.useEffect(cb, []) };
});
jest.mock('@react-native-community/datetimepicker', () => () => null);

const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });

test('empty: readable help, Create a goal, four templates that prefill AddGoal', async () => {
  const n = nav();
  render(<GoalScreen navigation={n} />);
  expect(await screen.findByText('Save for something specific')).toBeTruthy();
  expect(screen.getByText(/Moving money between accounts is a separate transfer/)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Create a goal' }));
  expect(n.navigate).toHaveBeenCalledWith('AddGoal');
  fireEvent.press(screen.getByRole('button', { name: 'Start a goal: Trip' }));
  expect(n.navigate).toHaveBeenCalledWith('AddGoal', { template: 'trip' });
  expect(screen.getAllByRole('button', { name: /^Start a goal/ })).toHaveLength(4);
});

test('AddGoal uses the template name', async () => {
  render(<AddGoalScreen navigation={nav()} route={{ params: { template: 'emergency' } }} />);
  expect(await screen.findByDisplayValue('Emergency fund')).toBeTruthy();
  expect(screen.getByDisplayValue('6')).toBeTruthy(); // expected return %
});

test('goal card shows progress and monthly need; delete asks first', async () => {
  const deadline = new Date();
  deadline.setMonth(deadline.getMonth() + 6);
  await Storage.setItem(
    'user_goals',
    JSON.stringify([
      {
        id: 'g1',
        name: 'Goa trip',
        targetAmount: 60000,
        savedAmount: 15000,
        roi: 0,
        deadline: deadline.toISOString(),
        linkedAsset: 'Axis Bank',
      },
    ])
  );
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const n = nav();
  render(<GoalScreen navigation={n} />);
  expect(await screen.findByText('Goa trip')).toBeTruthy();
  expect(screen.getByText('25%')).toBeTruthy();
  expect(screen.getByText('Save ₹7,500 a month')).toBeTruthy();
  expect(screen.getByText('Kept in: Axis Bank')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Add money to Goa trip' }));
  expect(n.navigate).toHaveBeenCalledWith('MoneyTool', { tab: 'Goals', goalId: 'g1' });
  fireEvent.press(screen.getByRole('button', { name: 'Delete Goa trip' }));
  const [title, , buttons] = alert.mock.calls[0];
  expect(title).toBe('Delete goal?');
  await buttons.find((b) => b.text === 'Delete').onPress();
  await waitFor(async () => expect(JSON.parse(await Storage.getItem('user_goals'))).toEqual([]));
  alert.mockRestore();
});
