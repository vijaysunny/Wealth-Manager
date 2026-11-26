/** Phase 14 E2: Upcoming bills screen and the Home "Next bill" row, with real storage. */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react-native';

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
jest.mock('@react-native-community/datetimepicker', () => {
  const { Pressable, Text } = require('react-native');
  const DatePicker = ({ onChange, value }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Pick date"
      onPress={() => onChange({}, new Date(value.getTime() + 3 * 86400000))}
    >
      <Text>picker</Text>
    </Pressable>
  );
  return DatePicker;
});
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => 'n1'),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
jest.mock('../../utils/NotificationService', () => ({
  sendTransactionNotification: jest.fn(),
  notificationsAllowed: jest.fn(async () => true),
}));
jest.setTimeout(30000);

const Storage = require('../../data/Storage').default;
const { addMany } = require('../../data/TransactionRepo');
const UpcomingBillsScreen = require('../../screens/UpcomingBillsScreen').default;
const Notifications = require('expo-notifications');

const DAY = 86400000;
const today = new Date();
const inDays = (n, h = 10) => {
  const x = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n, h);
  return x.toISOString();
};
const short = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });
const list = async (k) => JSON.parse((await Storage.getItem(k)) || '[]');

const bank = { id: 'axis', name: 'Axis Bank', type: 'Bank Account', last4: '0973', balance: 30000 };
const card = {
  id: 'ac',
  name: 'Axis Card',
  type: 'Credit Card',
  last4: '9070',
  creditLimit: 100000,
  statements: [{ date: inDays(-10), totalDue: 3914, dueDate: inDays(5, 0) }],
};
const sbi = { id: 'sbi', name: 'SBI Card', type: 'Credit Card', last4: '1987' };

beforeEach(async () => {
  await Storage.clear();
  jest.clearAllMocks();
  await Storage.setItem('user_wealth_accounts', JSON.stringify([bank, card, sbi]));
  await Storage.setItem(
    'recurring_bills',
    JSON.stringify([
      {
        id: 'gym',
        key: 'gym',
        name: 'Gym',
        amount: 1500,
        cadence: 'monthly',
        anchorDay: new Date(inDays(9)).getDate(),
        nextDate: inDays(9, 0),
        accountId: 'axis',
        source: 'manual',
        reminder: false,
      },
    ])
  );
  await Storage.setItem(
    'mandates',
    JSON.stringify([
      { key: 'openai', payee: 'OpenAI LLC', amount: 399, status: 'paused', pausedUntil: inDays(20, 23) },
    ])
  );
  await addMany(
    [
      {
        id: 'pay',
        type: 'transfer',
        amount: 100,
        accountId: 'axis',
        toAccountId: 'ac',
        fullDate: inDays(-40),
      },
      ...[3, 2, 1].map((m) => ({
        id: `n${m}`,
        type: 'expense',
        amount: 649,
        merchant: 'Netflix',
        accountId: 'axis',
        fullDate: new Date(today.getTime() - m * 30 * DAY + 2 * DAY).toISOString(),
      })),
    ],
    { dedup: false }
  );
});

test('summary, list, paused, card not set up; rows open the card; Set up opens setup', async () => {
  const n = nav();
  render(<UpcomingBillsScreen navigation={n} />);
  expect(await screen.findByText('Axis Card ••9070 bill')).toBeTruthy();
  expect(screen.getByTestId('bills-total').props.children).toBe('₹5,414');
  expect(screen.getByText('Axis ••0973 after these')).toBeTruthy();
  expect(screen.getByText('₹24,586')).toBeTruthy();
  expect(screen.getByText('Gym')).toBeTruthy();
  expect(screen.getByText('OpenAI LLC autopay')).toBeTruthy();
  expect(screen.getByText(`Paused until ${short(inDays(20))} · from the mandate SMS`)).toBeTruthy();
  expect(screen.getByText("SBI Card ••1987 bill isn't shown until the card is set up.")).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: /^Axis Card ••9070 bill/ }));
  expect(n.navigate).toHaveBeenCalledWith('CardDetail', { cardId: 'ac' });
  fireEvent.press(screen.getByRole('button', { name: 'Set up SBI Card' }));
  expect(n.navigate).toHaveBeenCalledWith('CardSetup', { cardId: 'sbi' });
});

test('Review 1 found: Add makes it a bill; Not a bill hides it for good', async () => {
  render(<UpcomingBillsScreen navigation={nav()} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Review 1 found' }));
  expect(within(screen.getByTestId('found-netflix')).getByText('Netflix · ₹649')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Add Netflix' })));
  await waitFor(async () =>
    expect((await list('recurring_bills')).map((b) => b.name)).toEqual(['Gym', 'Netflix'])
  );
  expect(screen.getByRole('button', { name: 'None found' })).toBeDisabled();
});

test('Not a bill', async () => {
  render(<UpcomingBillsScreen navigation={nav()} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Review 1 found' }));
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Netflix is not a bill' })));
  await waitFor(async () => expect(await list('bill_dismissed')).toEqual(['netflix']));
  expect(screen.getByText('All reviewed.')).toBeTruthy();
});

test('Add a bill with a reminder schedules it; a saved bill can turn the reminder off and be deleted', async () => {
  render(<UpcomingBillsScreen navigation={nav()} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Add a bill' }));
  expect(screen.getByRole('button', { name: 'Save bill' })).toBeDisabled();
  fireEvent.changeText(screen.getByLabelText('Bill name'), 'Rent');
  fireEvent.changeText(screen.getByLabelText('Amount'), '15000');
  fireEvent.press(screen.getByRole('button', { name: /^Next due:/ }));
  fireEvent.press(screen.getByRole('button', { name: 'Pick date' }));
  expect(screen.getByRole('button', { name: `Next due: ${short(inDays(10))}` })).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Save bill' })));
  await waitFor(async () =>
    expect((await list('recurring_bills')).map((b) => b.name)).toEqual(['Gym', 'Rent'])
  );
  const rent = (await list('recurring_bills'))[1];
  expect(rent).toMatchObject({
    amount: 15000,
    cadence: 'monthly',
    accountId: 'axis',
    reminder: true,
    source: 'manual',
  });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.objectContaining({ title: 'Rent due in 2 days' }) })
  );
  await waitFor(() => expect(screen.getAllByText('Monthly · added by you')).toHaveLength(2));

  fireEvent.press(screen.getByRole('button', { name: /^Rent, ₹15,000/ }));
  const { Switch } = require('react-native');
  const sw = screen.UNSAFE_getAllByType(Switch).find((x) => x.props.value === true);
  await act(async () => fireEvent(sw, 'valueChange', false));
  await waitFor(async () => expect((await list('recurring_bills'))[1].reminder).toBe(false));
  fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  fireEvent.press(screen.getByRole('button', { name: /^Gym, ₹1,500/ }));
  expect(screen.getByText('₹1,500 · Monthly · added by you')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Delete bill' })));
  await waitFor(async () => expect((await list('recurring_bills')).map((b) => b.name)).toEqual(['Rent']));
});

test('Home shows the next bill and opens Upcoming bills', async () => {
  const HomeScreen = require('../../screens/HomeScreen').default;
  const n = nav();
  render(<HomeScreen navigation={n} />);
  expect(await screen.findByText(`Next bill: Axis Card ••9070 ₹3,914 · ${short(inDays(5))}`)).toBeTruthy();
  fireEvent.press(screen.getByTestId('next-bill'));
  expect(n.navigate).toHaveBeenCalledWith('UpcomingBills');
});
