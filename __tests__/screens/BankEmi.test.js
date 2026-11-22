/** Phase 13 C4: bank EMIs found in SMS → loans; later debits link by themselves; missed EMI reminder. */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import Storage from '../../data/Storage';
import { addMany, getAll } from '../../data/TransactionRepo';
import BankEmiScreen from '../../screens/BankEmiScreen';
import ReviewAccountsScreen from '../../screens/ReviewAccountsScreen';
import { syncLoans } from '../../utils/LoanService';
import { accountsOverview } from '../../utils/AccountsOverview';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return { useFocusEffect: (cb) => R.useEffect(cb, []) };
});
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidNotificationPriority: { HIGH: 'high' },
}));
jest.setTimeout(30000);

const NOW = new Date(2026, 10, 22, 12);
beforeAll(() =>
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask'],
  })
);
afterAll(() => jest.useRealTimers());

const ach = (id, y, m, d, amount) => ({
  id,
  type: 'expense',
  amount,
  merchant: 'Bajaj Finance',
  title: 'Bajaj Finance',
  category: 'Loan/EMI',
  channel: 'ACH',
  accountId: 'axis',
  account: 'Axis Bank',
  smsId: `sms:${id}`,
  fullDate: new Date(y, m - 1, d, 14).toISOString(),
});
const accountsNow = async () => JSON.parse(await Storage.getItem('user_wealth_accounts'));

beforeEach(async () => {
  await Storage.setItem('user_transactions', '[]');
  await Storage.removeItem('loan_emi_dismissed');
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([
      { id: 'axis', type: 'Bank Account', name: 'Axis Bank ••0973', last4: '0973', balance: 33330 },
    ])
  );
  await addMany([ach('nov', 2026, 11, 7, 538), ach('jul', 2026, 7, 7, 160)], { dedup: false });
  Notifications.scheduleNotificationAsync.mockClear();
});
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });

test('Review → Check shows the Bajaj suggestion and opens it', async () => {
  const n = nav();
  render(<ReviewAccountsScreen navigation={n} route={{ params: { tab: 'check' } }} />);
  expect(await screen.findByText('Bajaj Finance · 2 auto-debits')).toBeTruthy();
  expect(screen.getByText('₹538 on day 7 · ₹160 on day 7')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Link to a loan' }));
  expect(n.navigate).toHaveBeenCalledWith('BankEmi', { payee: 'bajaj finance' });
});

test('design flow: new no-cost loan for ₹538 (8 left → ₹4,304 owed), then the ₹160 one to an existing loan', async () => {
  const n = nav();
  render(<BankEmiScreen navigation={n} route={{ params: { payee: 'bajaj finance' } }} />);
  expect(await screen.findByText('Bajaj Finance EMI')).toBeTruthy();
  expect(screen.getByText('7 Nov · ACH · Axis ••0973')).toBeTruthy();
  expect(screen.getByText('7 Jul · ACH · Axis ••0973')).toBeTruthy();
  expect(screen.getByTestId('mixed-note')).toBeTruthy();
  expect(screen.getByText('Loan for the ₹538 EMI')).toBeTruthy();
  expect(screen.getByLabelText('EMI').props.value).toBe('538');
  expect(screen.getByLabelText('Debit day').props.value).toBe('7');
  fireEvent.changeText(screen.getByLabelText('EMIs left'), '8');
  fireEvent.press(screen.getByRole('button', { name: 'Link to loan' }));
  expect(await screen.findByText('Loan for the ₹160 EMI')).toBeTruthy();

  const loan = (await accountsNow()).find((a) => a.type === 'Loan');
  expect(loan).toMatchObject({
    name: 'Bajaj Finance',
    loanType: 'No Cost EMI',
    emiAmount: 538,
    debitDay: 7,
    match: { payee: 'bajaj finance', amount: 538 },
  });
  const txs = await getAll();
  expect(txs.find((t) => t.id === 'nov').loanLink).toMatchObject({
    loanId: loan.id,
    kind: 'emi',
    emiNo: 1,
    principal: 538,
    interest: 0,
    source: 'sms',
  });
  const ov = accountsOverview(await accountsNow(), { txs, asOf: NOW });
  expect(ov.liabilities).toBe(4304);
  expect(ov.netWorth).toBe(33330 - 4304); // the bank already paid ₹538: nothing counted twice

  fireEvent.press(screen.getByRole('tab', { name: 'Existing loan' }));
  fireEvent.press(screen.getByRole('radio', { name: 'Bajaj Finance' }));
  fireEvent.press(screen.getByRole('button', { name: 'Link to loan' }));
  await waitFor(() => expect(n.goBack).toHaveBeenCalled());
  expect((await getAll()).find((t) => t.id === 'jul').loanLink.loanId).toBe(loan.id);
});

test('"Not a loan" dismisses one amount; the other stays suggested', async () => {
  render(<BankEmiScreen navigation={nav()} route={{ params: { payee: 'bajaj finance' } }} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Not a loan' }));
  expect(await screen.findByText('Loan for the ₹160 EMI')).toBeTruthy();
  expect(JSON.parse(await Storage.getItem('loan_emi_dismissed'))).toEqual(['bajaj finance|538']);
});

test("catch-up: next month's debit links itself as the next EMI; a missing one is reminded once", async () => {
  render(<BankEmiScreen navigation={nav()} route={{ params: { payee: 'bajaj finance' } }} />);
  fireEvent.changeText(await screen.findByLabelText('EMIs left'), '8');
  fireEvent.press(screen.getByRole('button', { name: 'Link to loan' }));
  await screen.findByText('Loan for the ₹160 EMI');
  await addMany([ach('dec', 2026, 12, 7, 538)], { dedup: false });
  expect(await syncLoans(new Date(2026, 11, 8, 12))).toEqual({ linked: 1, reminded: 0 });
  expect((await getAll()).find((t) => t.id === 'dec').loanLink).toMatchObject({
    kind: 'emi',
    emiNo: 2,
    principal: 538,
  });
  // January: nothing by the 9th → one reminder, not two
  expect(await syncLoans(new Date(2027, 0, 10, 12))).toEqual({ linked: 0, reminded: 1 });
  expect(await syncLoans(new Date(2027, 0, 11, 12))).toEqual({ linked: 0, reminded: 0 });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(Notifications.scheduleNotificationAsync.mock.calls[0][0])).toMatch(
    /Bajaj Finance EMI not seen this month/
  );
});

test('no SMS-tracked loans: catch-up does nothing', async () => {
  expect(await syncLoans(NOW)).toEqual({ linked: 0, reminded: 0 });
});
