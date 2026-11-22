/** Phase 13 C6: Link to a loan. */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import Storage from '../../data/Storage';
import { addMany, getAll } from '../../data/TransactionRepo';
import LoanLinkScreen from '../../screens/LoanLinkScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return { useFocusEffect: (cb) => R.useEffect(cb, []) };
});
jest.setTimeout(30000);

const iso = (m, d) => new Date(2026, m - 1, d, 12).toISOString();
const loan = {
  id: 'pl',
  type: 'Loan',
  loanKind: 'personal',
  name: 'Personal loan',
  originalAmount: 200000,
  interestRate: 12,
  tenure: 24,
  emiAmount: 9414.69,
  loanType: 'Reducing',
  firstEmiDate: new Date(2026, 5, 7).toISOString(),
};
const nach = {
  id: 'd6',
  type: 'expense',
  amount: 9414.69,
  title: 'NACH Personal loan',
  merchant: 'NACH Personal loan',
  category: 'Bills',
  accountId: 'axis',
  account: 'Axis Bank',
  smsId: 'sms:1',
  fullDate: iso(11, 7),
};
const credit = {
  id: 'in',
  type: 'income',
  amount: 200000,
  title: 'Loan credit',
  category: 'Other',
  accountId: 'axis',
  account: 'Axis Bank',
  fullDate: iso(5, 20),
};
const balanceOf = async (id) =>
  JSON.parse(await Storage.getItem('user_wealth_accounts')).find((a) => a.id === id);

beforeEach(async () => {
  await Storage.setItem('user_transactions', '[]');
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([
      { id: 'axis', type: 'Bank Account', name: 'Axis Bank ••0973', last4: '0973', balance: 50000 },
      loan,
    ])
  );
  await addMany([nach, credit], { dedup: false });
});
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), pop: jest.fn() });
const show = (params, n = nav()) => {
  render(<LoanLinkScreen navigation={n} route={{ params }} />);
  return n;
};

test('design: EMI 6 of 24 split from the schedule; each kind chip sets its default; save links it', async () => {
  const n = show({ txId: 'd6', loanId: 'pl' });
  expect(await screen.findByText('NACH Personal loan')).toBeTruthy();
  expect(screen.getByText('Axis ••0973 · 7 Nov · from SMS')).toBeTruthy();
  expect(screen.getByText('Personal loan · ₹9,414.69/mo')).toBeTruthy();
  expect(screen.getByLabelText('Principal').props.value).toBe('7792.91');
  expect(screen.getByLabelText('Interest & charges').props.value).toBe('1621.78');
  expect(screen.getByTestId('split-note').props.children).toBe(
    'EMI 6 of 24 · from the schedule, edit to match your lender'
  );
  fireEvent.press(screen.getByTestId('link-kind-prepayment'));
  expect(screen.getByLabelText('Principal').props.value).toBe('9414.69');
  expect(screen.getByLabelText('Interest & charges').props.value).toBe('0');
  expect(screen.getByRole('tab', { name: 'End sooner' })).toBeTruthy();
  fireEvent.press(screen.getByTestId('link-kind-charges'));
  expect(screen.getByLabelText('Principal').props.value).toBe('0');
  expect(screen.getByLabelText('Interest & charges').props.value).toBe('9414.69');
  fireEvent.press(screen.getByTestId('link-kind-emi'));
  fireEvent.press(screen.getByRole('tab', { name: 'Interest only' }));
  fireEvent.press(screen.getByRole('button', { name: 'Link payment' }));
  await waitFor(() => expect(n.goBack).toHaveBeenCalled());
  const tx = (await getAll()).find((t) => t.id === 'd6');
  expect(tx).toMatchObject({
    amount: 9414.69,
    category: 'Loan/EMI',
    loanLink: {
      loanId: 'pl',
      kind: 'emi',
      emiNo: 6,
      principal: 7792.91,
      interest: 1621.78,
      source: 'sms',
      interestOnly: true,
    },
    loanLinkPrev: { type: 'expense', category: 'Bills' },
  });
  expect((await balanceOf('pl')).budgetMode).toBe('interestOnly');
  expect((await balanceOf('axis')).balance).toBe(50000); // linking moves no money
});

test('a split that does not add up blocks Save and shows the gap', async () => {
  show({ txId: 'd6', loanId: 'pl' });
  fireEvent.changeText(await screen.findByLabelText('Interest & charges'), '1600');
  expect(screen.getByTestId('split-gap').props.children).toBe('₹21.78 still to split');
  expect(screen.getByRole('button', { name: 'Link payment' }).props.accessibilityState.disabled).toBe(true);
  fireEvent.changeText(screen.getByLabelText('Interest & charges'), '1700');
  expect(screen.getByTestId('split-gap').props.children).toBe('₹78.22 more than the payment');
});

test('Loan received turns the credit into a transfer (not income); the bank does not move; unlink restores it', async () => {
  const n = show({ txId: 'in', loanId: 'pl', fromTx: true });
  await screen.findByText('Loan credit');
  expect(screen.getByTestId('link-kind-disbursal').props.children).toBeTruthy();
  expect(screen.getByText('Money in from the lender is a transfer, not income.')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Link payment' }));
  await waitFor(() => expect(n.pop).toHaveBeenCalledWith(2));
  let tx = (await getAll()).find((t) => t.id === 'in');
  expect(tx).toMatchObject({
    type: 'transfer',
    flow: 'in',
    transferKind: 'loan_disbursal',
    category: 'Other',
  });
  expect((await balanceOf('axis')).balance).toBe(50000);
  screen.unmount();
  const n2 = show({ txId: 'in', fromTx: true });
  fireEvent.press(await screen.findByRole('button', { name: 'Unlink' }));
  await waitFor(() => expect(n2.pop).toHaveBeenCalledWith(2));
  tx = (await getAll()).find((t) => t.id === 'in');
  expect(tx).toMatchObject({ type: 'income', category: 'Other' });
  expect(tx.loanLink).toBeUndefined();
  expect(tx.flow).toBeUndefined();
  expect((await balanceOf('axis')).balance).toBe(50000);
});

test('from Loan detail: pick a candidate debit first; a foreclosure closes the loan', async () => {
  show({ loanId: 'pl' });
  fireEvent.press(await screen.findByRole('button', { name: /^NACH Personal loan, ₹9,414.69/ }));
  expect(await screen.findByText('Link to a loan')).toBeTruthy();
  fireEvent.press(screen.getByTestId('link-kind-foreclosure'));
  expect(screen.getByLabelText('Principal').props.value).toBe('9414.69');
  fireEvent.press(screen.getByRole('button', { name: 'Link payment' }));
  await waitFor(async () => expect((await balanceOf('pl')).status).toBe('closed'));
});

test('no loan chosen: the picker asks; no candidates: says how else to link', async () => {
  show({ txId: 'd6' });
  expect(await screen.findByText('Pick a loan')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Link payment' }).props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByTestId('loan-picker'));
  fireEvent.press(screen.getByRole('button', { name: 'Personal loan' }));
  expect(screen.getByLabelText('Principal').props.value).toBe('7792.91');
  screen.unmount();
  await Storage.setItem('user_transactions', '[]');
  show({ loanId: 'pl' });
  expect(await screen.findByText(/No matching debit found/)).toBeTruthy();
});
