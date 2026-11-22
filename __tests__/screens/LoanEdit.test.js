/** Phase 13 C2: Add or edit a loan or EMI. */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import Storage from '../../data/Storage';
import LoanEditScreen from '../../screens/LoanEditScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.setTimeout(30000);

const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });
const show = (params = {}, n = nav()) => {
  render(<LoanEditScreen navigation={n} route={{ params }} />);
  return n;
};
const stored = async () => JSON.parse(await Storage.getItem('user_wealth_accounts'));
const type = (label, text) => fireEvent.changeText(screen.getByLabelText(label), text);

beforeEach(async () => {
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([
      { id: 'axis', name: 'Axis Bank ••0973', type: 'Bank Account', last4: '0973', balance: 0 },
      { id: 'ac', name: 'Axis Bank Credit Card ••9070', type: 'Credit Card', last4: '9070', balance: 0 },
    ])
  );
});

test('design values: card EMI works out ₹2,256.46, warns it is already in the card, saves on the card', async () => {
  const n = show();
  fireEvent.press(await screen.findByTestId('kind-cardEmi'));
  type('Name', 'Phone EMI');
  type('Amount', '25,000');
  type('Months', '12');
  type('Interest % a year', '15');
  type('First EMI', '15/09/2026');
  expect(screen.getByTestId('loan-emi').props.value).toBe('2256.46');
  expect(screen.getByText('15 Sep 2026')).toBeTruthy();
  expect(screen.getByText('Already in your card balance')).toBeTruthy();
  expect(screen.getByText(/billed the full ₹25,000 on the card/)).toBeTruthy();
  fireEvent.press(screen.getByTestId('pay-from'));
  fireEvent.press(screen.getByRole('button', { name: 'Axis Card ••9070' }));
  expect(screen.getByRole('button', { name: 'Paid from, Axis Card ••9070' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(n.goBack).toHaveBeenCalled());
  const emi = (await stored()).find((a) => a.type === 'Loan');
  expect(emi).toMatchObject({
    loanKind: 'cardEmi',
    name: 'Phone EMI',
    originalAmount: 25000,
    emiAmount: 2256.46,
    onCardId: 'ac',
    includedInCard: true,
    loanType: 'Reducing',
  });
});

test('a bank loan at 0 %: info note, typed EMI kept, warning when EMIs fall short, bank picker lists only banks', async () => {
  const n = show();
  await screen.findByTestId('kind-personal');
  expect(screen.getByText('How the EMI is counted')).toBeTruthy();
  type('Name', 'Bajaj Finance');
  type('Amount', '6456');
  type('Months', '12');
  type('First EMI', '07/08/2026');
  expect(screen.getByTestId('loan-emi').props.value).toBe('538');
  fireEvent.changeText(screen.getByTestId('loan-emi'), '500');
  expect(screen.getByTestId('loan-warn').props.children).toBe(
    '12 EMIs of ₹500 add up to ₹6,000, less than ₹6,456.'
  );
  fireEvent.press(screen.getByText('Use worked-out ₹538'));
  expect(screen.getByTestId('loan-emi').props.value).toBe('538');
  fireEvent.press(screen.getByTestId('pay-from'));
  expect(screen.queryByRole('button', { name: 'Axis Card ••9070' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Axis ••0973' }));
  fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(n.goBack).toHaveBeenCalled());
  expect((await stored()).find((a) => a.type === 'Loan')).toMatchObject({
    loanType: 'No Cost EMI',
    payFromAccountId: 'axis',
    debitDay: 7,
  });
});

test('validation blocks Save with a message', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const n = show();
  await screen.findByTestId('kind-personal');
  type('Name', 'Home');
  type('Amount', '100000');
  type('Months', '400');
  expect(screen.getByTestId('loan-error').props.children).toMatch(/1 and 360/);
  fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(alert).toHaveBeenCalledWith('Loan', expect.stringMatching(/1 and 360/));
  expect(n.goBack).not.toHaveBeenCalled();
  alert.mockRestore();
});

test('prefill from "Track as EMI" and editing an existing loan, then Delete', async () => {
  show({
    prefill: {
      kind: 'cardEmi',
      name: 'Croma EMI',
      amount: '25000',
      payFromId: 'ac',
      firstEmi: '15/09/2026',
      sourceTxId: 'p1',
    },
  });
  expect((await screen.findByLabelText('Name')).props.value).toBe('Croma EMI');
  expect(screen.getByRole('button', { name: 'Paid from, Axis Card ••9070' })).toBeTruthy();
  screen.unmount();

  const list = await stored();
  list.push({
    id: 'L1',
    type: 'Loan',
    loanKind: 'home',
    name: 'Home loan',
    originalAmount: 100000,
    tenure: 24,
    interestRate: 9,
    emiAmount: 4568.47,
    firstEmiDate: new Date(2026, 0, 5).toISOString(),
    status: 'active',
  });
  await Storage.setItem('user_wealth_accounts', JSON.stringify(list));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const n = show({ loanId: 'L1' });
  expect(await screen.findByText('Edit loan')).toBeTruthy();
  expect(screen.getByLabelText('First EMI').props.value).toBe('05/01/2026');
  expect(screen.getByTestId('loan-emi').props.value).toBe('4568.47');
  fireEvent.press(screen.getByRole('button', { name: 'Delete loan' }));
  const buttons = alert.mock.calls[0][2];
  await buttons.find((b) => b.text === 'Delete').onPress();
  expect((await stored()).find((a) => a.id === 'L1')).toBeUndefined();
  expect(n.navigate).toHaveBeenCalledWith('Main', { screen: 'AccountsTab' });
  alert.mockRestore();
});

test('a deleted loan says so and goes back', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const n = show({ loanId: 'gone' });
  await waitFor(() => expect(n.goBack).toHaveBeenCalled());
  expect(alert).toHaveBeenCalledWith('Loan', 'This item no longer exists.');
  alert.mockRestore();
});
