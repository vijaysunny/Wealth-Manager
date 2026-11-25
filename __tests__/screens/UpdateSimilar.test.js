/** Phase 14 A3/C3: after saving payee / category / tag changes, offer to copy them to the same payee. */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import Storage from '../../data/Storage';
import { addMany, getAll } from '../../data/TransactionRepo';
import EditTransactionScreen from '../../screens/EditTransactionScreen';
import SnackbarHost from '../../components/ui/SnackbarHost';
import { clearUndo } from '../../utils/UndoStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
}));
jest.mock('../../utils/AttachmentPickers', () => ({}));
jest.setTimeout(30000);

const row = (id, day, extra = {}) => ({
  id,
  type: 'expense',
  amount: 100 + day,
  merchant: 'SWIGGY INST',
  title: 'SWIGGY INST',
  category: 'General',
  account: 'Axis Bank',
  accountId: 'axis',
  fullDate: new Date(2026, 10, day, 10).toISOString(),
  date: `${day} Nov 2026`,
  tags: ['auto-sms'],
  ...extra,
});

beforeEach(async () => {
  await Storage.clear();
  clearUndo();
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([{ id: 'axis', name: 'Axis Bank', type: 'Bank Account', last4: '0973', balance: 1000 }])
  );
  await Storage.setItem('user_categories', JSON.stringify(['General', 'Food', 'Shopping']));
  await addMany(
    [
      row('t1', 20),
      row('t2', 2),
      row('t3', 3, { tags: ['groceries'] }),
      row('t4', 4),
      row('t5', 5, { category: 'Health', categorySource: 'user' }),
      row('loan', 6, { loanLink: { loanId: 'l1' } }),
      row('other', 7, { merchant: 'Zomato', title: 'Zomato' }),
    ],
    { dedup: false }
  );
});

const open = async (id = 't1') => {
  const n = { navigate: jest.fn(), goBack: jest.fn() };
  const tx = (await getAll()).find((x) => x.id === id);
  render(
    <>
      <EditTransactionScreen navigation={n} route={{ params: { transaction: tx } }} />
      <SnackbarHost />
    </>
  );
  await screen.findByText('Axis ••0973');
  return n;
};
const pickCategory = (c) => {
  fireEvent.press(screen.getByRole('button', { name: /^Category/ }));
  fireEvent.press(screen.getByRole('button', { name: c }));
};
const addTag = (g) => {
  fireEvent.press(screen.getByRole('button', { name: 'Tags' }));
  const input = screen.getByTestId('tag-input');
  fireEvent.changeText(input, g);
  fireEvent(input, 'submitEditing');
};
const save = () => fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

test('a category change shows only the Category row and the right count', async () => {
  const n = await open();
  pickCategory('Food');
  save();
  expect(await screen.findByText('Apply to 3 more from this payee?')).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: 'Copy category change' })).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: 'Copy payee change' })).toBeNull();
  expect(screen.getByText(/1 with a category you set by hand keeps it/)).toBeTruthy();
  expect(screen.getByText(/1 skipped \(loan payments\)/)).toBeTruthy();
  expect(n.goBack).not.toHaveBeenCalled();
});

test('name + category + tag: three rows; unticking updates N and the rule line; none ticked disables Update', async () => {
  await open();
  fireEvent.changeText(screen.getByTestId('payee-input'), 'Swiggy Instamart');
  pickCategory('Food');
  addTag('groceries');
  save();
  expect(await screen.findByText('Apply to 4 more from this payee?')).toBeTruthy();
  expect(screen.getByText('SWIGGY INST: rename to Swiggy Instamart · Food · #groceries')).toBeTruthy();
  fireEvent.press(screen.getByRole('checkbox', { name: 'Copy category change' }));
  expect(screen.getByText('SWIGGY INST: rename to Swiggy Instamart · #groceries')).toBeTruthy();
  fireEvent.press(screen.getByRole('checkbox', { name: 'Copy payee change' }));
  // only the tag is left: t3 already has it
  expect(screen.getByText('Apply to 3 more from this payee?')).toBeTruthy();
  fireEvent.press(screen.getByRole('checkbox', { name: 'Copy tags change' }));
  expect(screen.getByRole('button', { name: 'Update 0' }).props.accessibilityState.disabled).toBe(true);
});

test('a tag-only change: a row that already has the tag is not counted', async () => {
  await open();
  addTag('groceries');
  save();
  expect(await screen.findByText('Apply to 3 more from this payee?')).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: 'Copy category change' })).toBeNull();
});

test('unticking a transaction lowers N; Update applies, saves the rule, and Undo restores', async () => {
  const n = await open();
  pickCategory('Food');
  save();
  await screen.findByText('Apply to 3 more from this payee?');
  const rowBoxes = screen.getAllByRole('checkbox').filter((c) => !/^Copy/.test(c.props.accessibilityLabel));
  fireEvent.press(rowBoxes[0]);
  fireEvent.press(screen.getByRole('button', { name: 'Update 2' }));
  await waitFor(() => expect(n.goBack).toHaveBeenCalled());
  expect(await screen.findByText('Updated 2 transactions')).toBeTruthy();
  let all = await getAll();
  const cat = (id) => all.find((x) => x.id === id).category;
  expect(['t2', 't3', 't4'].map(cat).filter((c) => c === 'Food')).toHaveLength(2);
  expect(cat('t5')).toBe('Health');
  expect(JSON.parse(await Storage.getItem('category_rules'))).toEqual([
    expect.objectContaining({ kind: 'payee', payeeKey: 'swiggy inst', category: 'Food' }),
  ]);
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Undo' })));
  await screen.findByText('Undone');
  all = await getAll();
  expect(['t2', 't3', 't4'].map(cat)).toEqual(['General', 'General', 'General']);
  expect(JSON.parse(await Storage.getItem('category_rules'))).toEqual([]);
});

test('turning off "Also for future SMS" saves no rule', async () => {
  const n = await open();
  pickCategory('Food');
  save();
  await screen.findByText('Apply to 3 more from this payee?');
  fireEvent(screen.getByTestId('future-switch'), 'valueChange', false);
  fireEvent.press(screen.getByRole('button', { name: 'Update 3' }));
  await waitFor(() => expect(n.goBack).toHaveBeenCalled());
  expect(JSON.parse((await Storage.getItem('category_rules')) || '[]')).toEqual([]);
});

test('Only this one changes no other rows', async () => {
  const n = await open();
  pickCategory('Food');
  save();
  await screen.findByText('Apply to 3 more from this payee?');
  fireEvent.press(screen.getByRole('button', { name: 'Only this one' }));
  expect(n.goBack).toHaveBeenCalled();
  const all = await getAll();
  expect(all.filter((x) => x.category === 'Food').map((x) => x.id)).toEqual(['t1']);
  expect(all.find((x) => x.id === 't1').categorySource).toBe('user');
});

test('no sheet when nothing matches', async () => {
  const n = await open('other');
  pickCategory('Food');
  save();
  await waitFor(() => expect(n.goBack).toHaveBeenCalled());
  expect(screen.queryByText(/Apply to/)).toBeNull();
});

test('no sheet for an amount-only change', async () => {
  const n = await open();
  fireEvent.changeText(screen.getByTestId('amount-input'), '999');
  save();
  await waitFor(() => expect(n.goBack).toHaveBeenCalled());
  expect(screen.queryByText(/Apply to/)).toBeNull();
});
