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

describe('B5 select mode', () => {
  const { act } = require('@testing-library/react-native');
  const { getAll } = require('../../data/TransactionRepo');
  const SnackbarHost = require('../../components/ui/SnackbarHost').default;
  const { clearUndo } = require('../../utils/UndoStore');
  const { Alert } = require('react-native');

  const openSel = async () => {
    clearUndo();
    let beforeRemove = null;
    const n = {
      navigate: jest.fn(),
      goBack: jest.fn(),
      addListener: jest.fn((ev, cb) => {
        if (ev === 'beforeRemove') beforeRemove = cb;
        return () => {};
      }),
    };
    render(
      <>
        <AllTransactionsScreen navigation={n} route={{ params: {} }} />
        <SnackbarHost />
      </>
    );
    await screen.findByText('Anjanadri');
    return { n, beforeRemove: () => beforeRemove };
  };
  const row = (name) => screen.getByLabelText(new RegExp(`^${name}, `));
  const byId = async () => Object.fromEntries((await getAll()).map((x) => [x.id, x]));

  test('long-press starts it with that row selected; tap toggles; header shows count and expense total', async () => {
    await openSel();
    fireEvent(row('Anjanadri'), 'longPress');
    expect(screen.getByText('1 selected · ₹350')).toBeTruthy();
    expect(row('Anjanadri').props.accessibilityRole).toBe('checkbox');
    expect(row('Anjanadri').props.accessibilityState).toEqual({ checked: true });
    fireEvent.press(row('Swiggy Instamart'));
    fireEvent.press(row('Employer'));
    expect(screen.getByText('3 selected · ₹672')).toBeTruthy();
    fireEvent.press(row('Employer'));
    expect(screen.getByText('2 selected · ₹672')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Exit select mode' }));
    expect(screen.getByText('Transactions')).toBeTruthy();
  });

  test('Select all selects every match of the query, not only those on screen', async () => {
    await openSel();
    fireEvent.press(screen.getByRole('button', { name: 'Select' }));
    expect(screen.getByText('0 selected · ₹0')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Category' }).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: 'Select all 5' }));
    expect(screen.getByText('5 selected · ₹1,701')).toBeTruthy();
  });

  test('Category: bulk path with Undo; loan rows skipped with a note', async () => {
    await addMany(
      [tx('loan', { merchant: 'EMI', amount: 5000, loanLink: { loanId: 'l' }, category: 'Loan/EMI' })],
      { dedup: false }
    );
    await openSel();
    await screen.findByText('EMI');
    fireEvent(row('Anjanadri'), 'longPress');
    fireEvent.press(row('EMI'));
    fireEvent.press(screen.getByRole('button', { name: 'Category' }));
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Transport' })));
    expect(await screen.findByText('Updated 1 transaction · 1 skipped (loan payments)')).toBeTruthy();
    let rows = await byId();
    expect(rows.a).toMatchObject({ category: 'Transport', categorySource: 'bulk' });
    expect(rows.loan.category).toBe('Loan/EMI');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Undo' })));
    await screen.findByText('Undone');
    rows = await byId();
    expect(rows.a.category).toBe('Food');
  });

  test('Tag adds a tag (then #tag search finds them) and removes one all share', async () => {
    await openSel();
    fireEvent(row('Anjanadri'), 'longPress');
    fireEvent.press(row('Swiggy Instamart'));
    fireEvent.press(screen.getByRole('button', { name: 'Tag' }));
    fireEvent.changeText(screen.getByLabelText('Tag to add'), '#tax-2026');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Add tag' })));
    expect(await screen.findByText('Updated 2 transactions')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('tx-search'), '#tax-2026');
    expect(textOf(summary())).toBe('2 transactions · spent ₹672');
    fireEvent.press(screen.getByRole('button', { name: 'Select' }));
    fireEvent.press(screen.getByRole('button', { name: 'Select all 2' }));
    fireEvent.press(screen.getByRole('button', { name: 'Tag' }));
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Remove #tax-2026' })));
    await screen.findByText('No transactions match these filters');
  });

  test('Account moves rows (transfers skipped); Not in reports toggles; Rename payee', async () => {
    await openSel();
    fireEvent(row('Anjanadri'), 'longPress');
    fireEvent.press(screen.getByRole('button', { name: 'Account' }));
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Axis Card ••9070' })));
    await screen.findByText('Updated 1 transaction');
    expect((await byId()).a).toMatchObject({ accountId: 'card', account: 'Axis Bank Credit Card' });

    fireEvent(row('Anjanadri'), 'longPress');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Not in reports' })));
    await waitFor(async () => expect((await byId()).a.excludeFromReports).toBe(true));
    fireEvent(row('Anjanadri'), 'longPress');
    expect(screen.getByRole('button', { name: 'Count in reports' })).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.press(screen.getByRole('button', { name: 'Rename payee…' }));
    fireEvent.changeText(screen.getByLabelText('Payee name'), 'Anjanadri E.');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Rename' })));
    await waitFor(async () =>
      expect((await byId()).a).toMatchObject({ merchant: 'Anjanadri E.', nameSource: 'bulk' })
    );
  });

  test('Delete asks first; no Undo is offered', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openSel();
    fireEvent(row('Anjanadri'), 'longPress');
    fireEvent.press(row('ODS parking'));
    fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    const [title, body, buttons] = alert.mock.calls[0];
    expect(title).toBe('Delete 2 transactions?');
    expect(body).toBe('Their files are deleted too.');
    await act(async () => buttons.find((b) => b.text === 'Delete').onPress());
    expect(await screen.findByText('Deleted 2 transactions')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect((await byId()).a).toBeUndefined();
    alert.mockRestore();
  });

  test('Back exits select mode before leaving the screen', async () => {
    const { beforeRemove } = await openSel();
    fireEvent(row('Anjanadri'), 'longPress');
    const e = { preventDefault: jest.fn() };
    act(() => beforeRemove()(e));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(screen.getByText('Transactions')).toBeTruthy();
  });
});

test('hand-set filters are kept in the route, so they come back after Android closes the app', async () => {
  const setParams = jest.fn();
  const n = { navigate: jest.fn(), goBack: jest.fn(), setParams };
  render(<AllTransactionsScreen navigation={n} route={{ params: {} }} />);
  await screen.findByText('Anjanadri');
  fireEvent.changeText(screen.getByLabelText('Search transactions'), 'anjan');
  await waitFor(() =>
    expect(setParams).toHaveBeenLastCalledWith({ restoredQuery: expect.objectContaining({ text: 'anjan' }) })
  );
  const saved = setParams.mock.calls.at(-1)[0].restoredQuery;
  // a restored screen (same saved params) opens with them, and the remembered sort doesn't override
  await Storage.setItem('tx_list_sort', 'amountDesc');
  screen.unmount();
  render(
    <AllTransactionsScreen
      navigation={n}
      route={{ params: { query: { types: ['income'] }, restoredQuery: saved } }}
    />
  );
  expect(await screen.findByDisplayValue('anjan')).toBeTruthy();
  expect(screen.getByText('Anjanadri')).toBeTruthy();
  expect(queryFromParams({ restoredQuery: { ...saved, sort: 'payee' } }).sort).toBe('payee');
});
