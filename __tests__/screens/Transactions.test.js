/** Phase 14 B2/B3/C3: Transactions with sort, filter sheet, chips, totals and the remembered sort. */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import Storage from '../../data/Storage';
import { addMany } from '../../data/TransactionRepo';
import AllTransactionsScreen, {
  SORT_KEY,
  queryFromParams,
  sectionsFor,
} from '../../screens/AllTransactionsScreen';
import { categoriesByUse } from '../../components/FilterSheet';
import { runQuery } from '../../utils/TransactionQuery';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (cb) => require('react').useEffect(cb, [cb]),
}));
jest.setTimeout(30000);

const now = new Date();
const thisMonth = (d) => new Date(now.getFullYear(), now.getMonth(), d, 10).toISOString();
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 10).toISOString();
const tx = (id, over) => ({
  id,
  type: 'expense',
  accountId: 'axis',
  account: 'Axis Bank',
  category: 'Food',
  fullDate: thisMonth(1),
  tags: [],
  ...over,
});
const ROWS = [
  tx('a', { merchant: 'Anjanadri', amount: 350, fullDate: thisMonth(1) }),
  tx('s', { merchant: 'Swiggy Instamart', amount: 322, fullDate: thisMonth(2) }),
  tx('p', {
    merchant: 'ODS parking',
    amount: 30,
    category: 'Transport',
    accountId: 'card',
    account: 'Card',
    fullDate: thisMonth(2),
  }),
  tx('i', {
    type: 'income',
    merchant: 'Employer',
    amount: 50000,
    category: 'Salary',
    fullDate: thisMonth(1),
  }),
  tx('old', { merchant: 'Old shop', amount: 999, fullDate: lastMonth, attachments: [{ id: 'f' }] }),
];
const accounts = [
  { id: 'axis', name: 'Axis Bank', type: 'Bank Account', last4: '0973', balance: 0 },
  { id: 'card', name: 'Axis Bank Credit Card', type: 'Credit Card', last4: '9070', balance: 0 },
];

beforeEach(async () => {
  await Storage.clear();
  await Storage.setItem('user_wealth_accounts', JSON.stringify(accounts));
  await addMany(ROWS, { dedup: false });
});

const open = async (params = {}, ready = 'Anjanadri') => {
  const n = { navigate: jest.fn(), goBack: jest.fn() };
  const utils = render(<AllTransactionsScreen navigation={n} route={{ params }} />);
  await screen.findByText(ready);
  return { n, ...utils };
};
const summary = () => screen.getByTestId('tx-summary');
const textOf = (el) =>
  []
    .concat(el.props.children)
    .flat(Infinity)
    .map((c) => (typeof c === 'object' && c ? textOf(c) : (c ?? '')))
    .join('');

test('summary totals match runQuery; income shows when there is some', async () => {
  await open();
  const { totals } = runQuery(ROWS, queryFromParams({}), now);
  expect(totals.count).toBe(5);
  expect(textOf(summary())).toBe('5 transactions · spent ₹1,701 · income ₹50,000');
});

test('opened with a query: chips, badge, removal and Clear all', async () => {
  await open({ query: { date: { preset: 'thisMonth' }, types: ['expense'], accountIds: ['axis'] } });
  const month = now.toLocaleDateString('en-GB', { month: 'long' });
  expect(screen.getByLabelText('Filters, 3 active')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Remove filter Axis ••0973' })).toBeTruthy();
  expect(textOf(summary())).toBe('2 transactions · spent ₹672');
  fireEvent.press(screen.getByRole('button', { name: `Remove filter ${month}` }));
  expect(screen.getByLabelText('Filters, 2 active')).toBeTruthy();
  expect(screen.getByText('Old shop')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Clear all' }));
  expect(screen.getByLabelText('Filters, 0 active')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  expect(screen.getByText('ODS parking')).toBeTruthy();
});

test('the accountId shortcut still works', async () => {
  await open({ accountId: 'card' }, 'ODS parking');
  expect(screen.getByLabelText('Filters, 1 active')).toBeTruthy();
  expect(textOf(summary())).toBe('1 transaction · spent ₹30');
});

test('amount sort shows a flat list with dates; Newest shows day headers; the sort is remembered', async () => {
  const { unmount } = await open();
  expect(screen.getAllByRole('header').length).toBeGreaterThan(1); // title + day headers
  fireEvent.press(screen.getByTestId('sort-button'));
  fireEvent.press(screen.getByRole('button', { name: 'Amount: high to low' }));
  expect(screen.getByLabelText('Sort: Amount: high to low')).toBeTruthy();
  expect(screen.getAllByRole('header')).toHaveLength(1); // only the screen title
  const day = new Date(thisMonth(2)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  expect(screen.getByText(`${day} · Food`)).toBeTruthy();
  await waitFor(async () => expect(await Storage.getItem(SORT_KEY)).toBe('amountDesc'));
  unmount();
  await open();
  await waitFor(() => expect(screen.getByLabelText('Sort: Amount: high to low')).toBeTruthy());
  expect(screen.getByLabelText('Filters, 0 active')).toBeTruthy();
});

test('filter sheet: live count, Show applies, Reset keeps the sort, closing discards', async () => {
  await open();
  fireEvent.press(screen.getByTestId('filter-button'));
  expect(screen.getByRole('button', { name: 'Show 5 transactions' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Payee A–Z' }));
  fireEvent.press(screen.getByRole('button', { name: 'Income' }));
  expect(screen.getByRole('button', { name: 'Show 1 transaction' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  expect(screen.getByLabelText('Filters, 0 active')).toBeTruthy();
  expect(screen.getByLabelText('Sort: Newest')).toBeTruthy();

  fireEvent.press(screen.getByTestId('filter-button'));
  fireEvent.press(screen.getByRole('button', { name: 'Payee A–Z' }));
  fireEvent.press(screen.getByRole('button', { name: 'Has file' }));
  fireEvent.press(screen.getByRole('button', { name: 'Reset' }));
  expect(screen.getByRole('button', { name: 'Payee A–Z' }).props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByRole('button', { name: 'Has file' }));
  fireEvent.press(screen.getByRole('button', { name: 'Show 1 transaction' }));
  expect(screen.getByLabelText('Filters, 1 active')).toBeTruthy();
  expect(screen.getByLabelText('Sort: Payee A–Z')).toBeTruthy();
  expect(screen.getByText('Old shop')).toBeTruthy();
  expect(screen.queryByText('Anjanadri')).toBeNull();
});

test('filter sheet: max < min shows an error and disables Show; no matches disables it too', async () => {
  await open();
  fireEvent.press(screen.getByTestId('filter-button'));
  fireEvent.changeText(screen.getByLabelText('Minimum amount'), '500');
  fireEvent.changeText(screen.getByLabelText('Maximum amount'), '100');
  expect(screen.getByText('Max is less than min.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'No matches' }).props.accessibilityState.disabled).toBe(true);
  fireEvent.changeText(screen.getByLabelText('Maximum amount'), '1000');
  expect(screen.queryByText('Max is less than min.')).toBeNull();
  const show = screen.getByRole('button', { name: 'Show 1 transaction' });
  expect(show.props.accessibilityState.disabled).toBe(false);
  fireEvent.changeText(screen.getByLabelText('Minimum amount'), 'abc');
  expect(screen.getByText('Enter an amount, like 500.')).toBeTruthy();
});

test('filter sheet: accounts, categories (+ more), custom dates', async () => {
  await Storage.setItem('user_categories', JSON.stringify(['Food', 'Transport', 'Salary', 'A1', 'A2', 'A3']));
  await open();
  fireEvent.press(screen.getByTestId('filter-button'));
  const sheet = within(screen.getByTestId('filter-sheet'));
  fireEvent.press(sheet.getByRole('button', { name: 'Axis Card ••9070' }));
  expect(screen.getByRole('button', { name: 'Show 1 transaction' })).toBeTruthy();
  fireEvent.press(sheet.getByRole('button', { name: 'Axis Card ••9070' }));
  expect(screen.queryByRole('button', { name: 'A3' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: '+ 1 more' }));
  fireEvent.press(screen.getByRole('button', { name: 'A3' }));
  expect(screen.getByRole('button', { name: 'No matches' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'A3' }));
  fireEvent.press(screen.getByRole('button', { name: 'Custom…' }));
  expect(screen.getByRole('button', { name: /^From: / })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Custom…' }));
  expect(screen.queryByRole('button', { name: /^From: / })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Last month' }));
  expect(screen.getByRole('button', { name: 'Show 1 transaction' })).toBeTruthy();
});

test('empty state offers Clear filters', async () => {
  await open({ query: { categories: ['Nope'] } }, 'No transactions match these filters');
  expect(screen.getByText('No transactions match these filters')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getByText('Anjanadri')).toBeTruthy();
});

test('helpers', () => {
  expect(queryFromParams({ query: { sort: 'payee' } }, 'newest').sort).toBe('payee');
  expect(queryFromParams(undefined).sort).toBe('newest');
  expect(sectionsFor([], 'payee')).toEqual([]);
  const oldest = sectionsFor(ROWS, 'oldest');
  expect(oldest[0].data[0].id).toBe('old');
  expect(
    categoriesByUse(
      [{ category: 'B' }, { category: 'A' }, { category: 'B' }, { type: 'transfer', category: 'T' }, null],
      ['C', 'A']
    )
  ).toEqual(['B', 'A', 'C']);
  expect(categoriesByUse(undefined)).toEqual([]);
});

test('accessibility: the filter button label carries the count', async () => {
  await open({ query: { flags: ['hasFile'] } }, 'Old shop');
  expect(within(screen.getByTestId('filter-button')).getByText('1')).toBeTruthy();
});
