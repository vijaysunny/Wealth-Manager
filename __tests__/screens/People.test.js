/** Phase 14 E4: Split, People and Person screens with real storage (in-memory SQLite). */
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
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('../../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));
jest.setTimeout(30000);

const { Share, Alert } = require('react-native');
const Storage = require('../../data/Storage').default;
const { addMany, getAll } = require('../../data/TransactionRepo');
const SplitScreen = require('../../screens/SplitScreen').default;
const { resolveParts } = require('../../screens/SplitScreen');
const PeopleScreen = require('../../screens/PeopleScreen').default;
const PersonScreen = require('../../screens/PersonScreen').default;

const at = (d) => new Date(2026, 10, d, 12).toISOString();
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });
const list = async (k) => JSON.parse((await Storage.getItem(k)) || '[]');
const byId = async () => Object.fromEntries((await getAll()).map((t) => [t.id, t]));

beforeEach(async () => {
  await Storage.clear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([{ id: 'card', name: 'Axis Card', type: 'Credit Card', last4: '9070', balance: 0 }])
  );
  await Storage.setItem('user_categories', JSON.stringify(['Shopping', 'Groceries', 'Electronics']));
  await Storage.setItem('people', JSON.stringify([{ id: 'ravi', name: 'Ravi', payeeKeys: [] }]));
  await addMany(
    [
      {
        id: 'amz',
        type: 'expense',
        amount: 2840,
        merchant: 'Amazon',
        category: 'Shopping',
        accountId: 'card',
        account: 'Axis Card',
        date: '12 Nov',
        fullDate: at(12),
      },
      { id: 'cr', type: 'income', amount: 500, counterparty: 'RAVI K', title: 'RAVI K', fullDate: at(24) },
    ],
    { dedup: false }
  );
});

test('resolveParts: the first part takes the rest until typed into', () => {
  const tx = { amount: 100 };
  expect(
    resolveParts(
      tx,
      [
        { id: 'a', category: 'A', text: '' },
        { id: 'b', category: 'B', text: '30' },
      ],
      true
    )
  ).toEqual([
    { id: 'a', category: 'A', amount: 70 },
    { id: 'b', category: 'B', amount: 30 },
  ]);
  const two = (b) => [
    { id: 'a', text: '' },
    { id: 'b', text: b },
  ];
  expect(resolveParts(tx, two('200'), true)[0].amount).toBe(0);
  expect(resolveParts(tx, two('x'), true)[0].amount).toBe(100);
  expect(resolveParts(tx, [{ id: 'a', text: '1,000' }], false)[0].amount).toBe(1000);
});

test('Split: categories + a person; the bar shows the totals; Save writes parts and an IOU', async () => {
  const n = nav();
  render(<SplitScreen navigation={n} route={{ params: { txId: 'amz' } }} />);
  expect(await screen.findByText('Amazon')).toBeTruthy();
  expect(screen.getByText('Axis Card ••9070 · 12 Nov')).toBeTruthy();
  // the first part takes it all: one category is not a split yet
  expect(screen.getByRole('button', { name: 'Save split' })).toBeDisabled();
  fireEvent.press(screen.getByRole('button', { name: '+ Category' }));
  fireEvent.press(screen.getByRole('button', { name: 'Electronics' }));
  fireEvent.changeText(screen.getByLabelText('Amount for Electronics'), '1100');
  fireEvent.press(screen.getByRole('button', { name: '+ Person' }));
  fireEvent.press(screen.getByRole('button', { name: 'Ravi' }));
  fireEvent.changeText(screen.getByLabelText('Amount for Ravi owes you'), '500');
  expect(screen.getByLabelText('Amount for Shopping').props.value).toBe('1240');
  expect(screen.getByText('Adds up to ₹2,840')).toBeTruthy();
  expect(screen.getByText('Your spending: ₹2,340')).toBeTruthy();
  // change the first part's category
  fireEvent.press(screen.getByRole('button', { name: /Category for part 1: Shopping/ }));
  fireEvent.press(screen.getByRole('button', { name: 'Groceries' }));
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Save split' })));
  await waitFor(() => expect(n.goBack).toHaveBeenCalled());
  expect((await byId()).amz.splits.map((p) => [p.category || p.personId, p.amount])).toEqual([
    ['Groceries', 1240],
    ['Electronics', 1100],
    ['ravi', 500],
  ]);
  expect((await list('ious')).map((i) => [i.personId, i.amount, i.note])).toEqual([['ravi', 500, 'Amazon']]);
});

test('Split: typed amounts that do not add up block Save; equal split with a new person', async () => {
  render(<SplitScreen navigation={nav()} route={{ params: { txId: 'amz' } }} />);
  await screen.findByText('Amazon');
  fireEvent.press(screen.getByRole('button', { name: '+ Category' }));
  fireEvent.press(screen.getByRole('button', { name: 'Electronics' }));
  fireEvent.changeText(screen.getByLabelText('Amount for Shopping'), '1000');
  fireEvent.changeText(screen.getByLabelText('Amount for Electronics'), '1000');
  expect(screen.getByText('₹840 left to assign')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Save split' })).toBeDisabled();
  fireEvent.press(screen.getByRole('button', { name: 'Remove Electronics' }));
  fireEvent.press(screen.getByRole('button', { name: 'Split equally with people…' }));
  fireEvent.press(screen.getByRole('button', { name: 'Add person' }));
  fireEvent.changeText(screen.getByLabelText('Name'), 'Priya');
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Add' })));
  fireEvent.press(await screen.findByRole('button', { name: 'Ravi' }));
  fireEvent.press(screen.getByRole('button', { name: 'Split 3 ways' }));
  expect(screen.getByLabelText('Amount for Shopping').props.value).toBe('948');
  expect(screen.getByLabelText('Amount for Priya owes you').props.value).toBe('946');
  expect(screen.getByLabelText('Amount for Ravi owes you').props.value).toBe('946');
  expect(screen.getByText('Your spending: ₹948')).toBeTruthy();
  expect((await list('people')).map((p) => p.name)).toEqual(['Ravi', 'Priya']);
});

test('Split: Remove split restores the category', async () => {
  const { saveSplit } = require('../../utils/FeatureService');
  await saveSplit('amz', [
    { category: 'Shopping', amount: 2340 },
    { personId: 'ravi', amount: 500 },
  ]);
  const n = nav();
  render(<SplitScreen navigation={n} route={{ params: { txId: 'amz' } }} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Remove split' }));
  const buttons = Alert.alert.mock.calls.at(-1)[2];
  await act(async () => buttons.find((b) => b.text === 'Remove').onPress());
  await waitFor(async () => expect((await byId()).amz.splits).toBeUndefined());
  expect(await list('ious')).toEqual([]);
});

test('People: totals, the settle suggestion (Yes, settle), rows, Record "I owe"', async () => {
  const { saveSplit } = require('../../utils/FeatureService');
  await saveSplit('amz', [
    { category: 'Shopping', amount: 2340 },
    { personId: 'ravi', amount: 500 },
  ]);
  const n = nav();
  render(<PeopleScreen navigation={n} />);
  expect(await screen.findByText('₹500 received from RAVI K')).toBeTruthy();
  expect(screen.getByText(/Is this Ravi paying you back\?/)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Ravi, ₹500 owes you' }));
  expect(n.navigate).toHaveBeenCalledWith('Person', { personId: 'ravi' });
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Yes, settle' })));
  await waitFor(() => expect(screen.queryByText('₹500 received from RAVI K')).toBeNull());
  expect((await byId()).cr.kind).toBe('settlement');
  expect(screen.getByRole('button', { name: 'Ravi, settled' })).toBeTruthy();

  fireEvent.press(screen.getByRole('button', { name: 'Record "I owe"' }));
  fireEvent.press(within(screen.getByTestId('iou-person-ravi')).getByRole('button', { name: 'Ravi' }));
  fireEvent.changeText(screen.getByLabelText('Amount'), '300');
  fireEvent.changeText(screen.getByLabelText('What for'), 'Movie tickets');
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Save' })));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ravi, ₹300 you owe' })).toBeTruthy());
  expect(
    within(screen.getByRole('button', { name: 'Ravi, ₹300 you owe' })).getByText(
      'Movie tickets · 24 Nov'.replace(
        '24 Nov',
        new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      )
    )
  ).toBeTruthy();
});

test("People: No, it's income dismisses; Add person; empty state", async () => {
  await Storage.setItem('people', '[]');
  render(<PeopleScreen navigation={nav()} />);
  expect(await screen.findByText(/No one yet/)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Add person' }));
  fireEvent.changeText(screen.getByLabelText('Name'), 'Ravi');
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Add' })));
  expect(await screen.findByRole('button', { name: 'Ravi, settled' })).toBeTruthy();
  const ravi = (await list('people'))[0];
  await Storage.setItem(
    'ious',
    JSON.stringify([
      { id: 'i', personId: ravi.id, amount: 500, direction: 'owedToMe', note: 'X', date: at(1) },
    ])
  );
  screen.unmount();
  render(<PeopleScreen navigation={nav()} />);
  const no = await screen.findByRole('button', { name: "No, it's income" });
  await act(async () => fireEvent.press(no));
  await waitFor(async () => expect((await byId()).cr.settleDismissed).toBe(true));
});

test('Person: Remind shares the text with the UPI ID; Mark settled and Reopen', async () => {
  await Storage.setItem('owner_upi_id', 'me@okaxis');
  await Storage.setItem(
    'ious',
    JSON.stringify([
      {
        id: 'i1',
        personId: 'ravi',
        amount: 500,
        direction: 'owedToMe',
        note: 'Amazon',
        date: at(12),
        txId: 'amz',
      },
    ])
  );
  const share = jest.spyOn(Share, 'share').mockResolvedValue({});
  const n = nav();
  render(<PersonScreen navigation={n} route={{ params: { personId: 'ravi' } }} />);
  expect(await screen.findByText('Owes you ₹500')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Remind' })));
  expect(share).toHaveBeenCalledWith({ message: 'Hi Ravi, ₹500 for Amazon (12 Nov). UPI: me@okaxis' });
  fireEvent.press(screen.getByText('Amazon'));
  expect(n.navigate).toHaveBeenCalledWith('TransactionDetail', {
    transaction: expect.objectContaining({ id: 'amz' }),
  });
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Mark settled: Amazon' })));
  expect(await screen.findByText('All settled')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Show settled (1)' }));
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Reopen: Amazon' })));
  expect(await screen.findByText('Owes you ₹500')).toBeTruthy();
});

test('Person: without a UPI ID the reminder says how to add one', async () => {
  await Storage.setItem(
    'ious',
    JSON.stringify([
      { id: 'i1', personId: 'ravi', amount: 300, direction: 'iOwe', note: 'Movie', date: at(20) },
    ])
  );
  render(<PersonScreen navigation={nav()} route={{ params: { personId: 'ravi' } }} />);
  expect(await screen.findByText('You owe ₹300')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Remind' })).toBeNull();
});

test('Transaction detail: Split opens the Split screen; a split row says how many parts', async () => {
  const EditTransactionScreen = require('../../screens/EditTransactionScreen').default;
  const n = nav();
  const { unmount } = render(
    <EditTransactionScreen navigation={n} route={{ params: { transaction: (await byId()).amz } }} />
  );
  fireEvent.press(await screen.findByRole('button', { name: 'Split' }));
  expect(n.navigate).toHaveBeenCalledWith('Split', { txId: 'amz' });
  unmount();
  const { saveSplit } = require('../../utils/FeatureService');
  await saveSplit('amz', [
    { category: 'Shopping', amount: 2340 },
    { personId: 'ravi', amount: 500 },
  ]);
  render(<EditTransactionScreen navigation={n} route={{ params: { transaction: (await byId()).amz } }} />);
  expect(await screen.findByRole('button', { name: 'Split into 2 parts · Edit' })).toBeTruthy();
});
