/** Phase 13 C3: Loan detail. Design numbers from 16-loan-detail.png. */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import Storage from '../../data/Storage';
import { addMany } from '../../data/TransactionRepo';
import LoanDetailScreen from '../../screens/LoanDetailScreen';
import { shareCsv } from '../../utils/HistoryExport';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return { useFocusEffect: (cb) => R.useEffect(cb, []) };
});
jest.mock('../../utils/HistoryExport', () => ({ shareCsv: jest.fn(async () => {}) }));
jest.setTimeout(30000);

// Fixed "now" inside the design's month so the numbers match the picture.
const NOW = new Date(2026, 10, 22, 12);
beforeAll(() =>
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask'],
  })
);
afterAll(() => jest.useRealTimers());

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
  payFromAccountId: 'axis',
  status: 'active',
};
const link = (id, m, d, amount, l, extra = {}) => ({
  id,
  type: 'expense',
  amount,
  title: 'Personal loan',
  category: 'Loan/EMI',
  accountId: 'axis',
  account: 'Axis Bank',
  fullDate: iso(m, d),
  loanLink: { loanId: 'pl', source: 'manual', ...l },
  ...extra,
});
const seed = async (acc = [loan], txs) => {
  await Storage.setItem('user_transactions', '[]');
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([
      { id: 'axis', type: 'Bank Account', name: 'Axis Bank ••0973', last4: '0973', balance: 0 },
      ...acc,
    ])
  );
  await addMany(
    txs || [
      link(
        'e5',
        10,
        7,
        9414.69,
        { kind: 'emi', emiNo: 5, principal: 7715.76, interest: 1698.93 },
        { smsId: 's5' }
      ),
      link(
        'e6',
        11,
        7,
        9414.69,
        { kind: 'emi', emiNo: 6, principal: 7792.91, interest: 1621.78 },
        { smsId: 's6' }
      ),
      link('pp', 11, 15, 10000, { kind: 'prepayment', principal: 10000, interest: 0, mode: 'endSooner' }),
    ],
    { dedup: false }
  );
};
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });
const show = (n = nav()) => {
  render(<LoanDetailScreen navigation={n} route={{ params: { loanId: 'pl' } }} />);
  return n;
};

test('the design: owed, tiles, FY tiles, chips, grouped assumed EMIs, next EMI', async () => {
  await seed();
  const n = show();
  expect(await screen.findByText('₹1,44,384.71')).toBeTruthy();
  expect(screen.getByText('₹2,00,000 at 12% · reducing · from linked payments')).toBeTruthy();
  expect(screen.getByTestId('tile-emi').props.children).toBe('₹9,414.69');
  expect(screen.getByTestId('tile-paid').props.children).toBe('6 of 23');
  expect(screen.getByTestId('tile-ends').props.children).toBe('Apr 2028');
  expect(screen.getByTestId('fy-principal').props.children).toBe('₹55,615.29');
  expect(screen.getByTestId('fy-interest').props.children).toBe('₹10,872.85');
  expect(screen.getByText('Apr 2026 – Mar 2027')).toBeTruthy();
  expect(screen.getByText('15 Nov · Prepayment')).toBeTruthy();
  expect(screen.getByText('Axis ••0973 · tenure cut by 1 EMI')).toBeTruthy();
  expect(screen.getByText('7 Nov · EMI 6')).toBeTruthy();
  expect(screen.getByText('Principal ₹7,792.91')).toBeTruthy();
  expect(screen.getByText('Interest ₹1,621.78')).toBeTruthy();
  expect(screen.getAllByText('from SMS')).toHaveLength(2);
  expect(screen.getByText('7 Jun – 7 Sep · EMIs 1–4')).toBeTruthy();
  expect(screen.getByText('₹37,658.76')).toBeTruthy();
  expect(screen.getByText(/No SMS seen: counted from the schedule/)).toBeTruthy();
  expect(screen.getByText('Next: 7 Dec · ₹9,414.69')).toBeTruthy();
  expect(screen.getByText('Principal ₹7,970.84 · Interest ₹1,443.85')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Export for tax filing (CSV)' }));
  await waitFor(() => expect(shareCsv).toHaveBeenCalled());
  const [file, csv] = shareCsv.mock.calls[0];
  expect(file).toBe('Personal_loan_FY2026-27.csv');
  expect(csv.split('\n')[0]).toBe('date,type,amount,principal,interest,charges,source');
  fireEvent.press(screen.getByRole('button', { name: 'Edit loan' }));
  expect(n.navigate).toHaveBeenCalledWith('LoanEdit', { loanId: 'pl' });
});

test('Part-prepay (end sooner) lowers "Principal still owed"; Reduce EMI changes the EMI', async () => {
  await seed([loan], []);
  show();
  expect(await screen.findByText('₹1,54,384.71')).toBeTruthy();
  expect(screen.getByText('₹2,00,000 at 12% · reducing · from the schedule')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Part-prepay' }));
  fireEvent.changeText(screen.getByLabelText('Amount prepaid (₹)'), '10,000');
  fireEvent.changeText(screen.getByLabelText('Date (DD/MM/YYYY)'), '15/11/2026');
  fireEvent.press(screen.getByRole('button', { name: 'Save prepayment' }));
  expect(await screen.findByText('₹1,44,384.71')).toBeTruthy();
  expect(screen.getByTestId('tile-paid').props.children).toBe('6 of 23');
  expect(screen.getByText('manual · tenure cut by 1 EMI')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Part-prepay' }));
  fireEvent.changeText(screen.getByLabelText('Amount prepaid (₹)'), '5000');
  fireEvent.changeText(screen.getByLabelText('Date (DD/MM/YYYY)'), '20/11/2026');
  fireEvent.press(screen.getByRole('tab', { name: 'Reduce EMI' }));
  fireEvent.press(screen.getByRole('button', { name: 'Save prepayment' }));
  expect(await screen.findByText('₹1,39,384.71')).toBeTruthy();
  expect(screen.getByTestId('tile-emi').props.children).not.toBe('₹9,414.69');
  const saved = JSON.parse(await Storage.getItem('user_wealth_accounts')).find((a) => a.id === 'pl');
  expect(saved.prepayments.map((p) => p.mode)).toEqual(['endSooner', 'reduceEmi']);
});

test('Mark as closed asks first, then shows ₹0 and Reopen', async () => {
  await seed([loan], []);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  show();
  fireEvent.press(await screen.findByRole('button', { name: 'Mark as closed' }));
  expect(alert).toHaveBeenCalledWith('Mark as closed?', expect.any(String), expect.any(Array));
  await alert.mock.calls[0][2].find((b) => b.text === 'Mark as closed').onPress();
  expect(await screen.findByText('Closed')).toBeTruthy();
  expect(screen.getByTestId('principal-owed').props.children).toBe('₹0');
  expect(screen.queryByRole('button', { name: 'Part-prepay' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Reopen' }));
  expect(await screen.findByText('Principal still owed')).toBeTruthy();
  alert.mockRestore();
});

test('a card EMI: in card balance, no FY card, no Part-prepay, no "link them" flag', async () => {
  const emi = {
    id: 'pl',
    type: 'Loan',
    loanKind: 'cardEmi',
    includedInCard: true,
    onCardId: 'ac',
    name: 'Phone EMI',
    originalAmount: 25000,
    interestRate: 15,
    tenure: 12,
    emiAmount: 2256.46,
    loanType: 'Reducing',
    firstEmiDate: new Date(2026, 8, 15).toISOString(),
  };
  await seed([emi], []);
  show();
  expect(await screen.findByText('₹25,000 at 15% · reducing · in card balance')).toBeTruthy();
  expect(screen.getByText('₹19,094.92')).toBeTruthy();
  expect(screen.queryByTestId('fy-card')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Part-prepay' })).toBeNull();
  expect(screen.queryByText(/No SMS seen/)).toBeNull();
  expect(screen.getByText('15 Sep – 15 Nov · EMIs 1–3')).toBeTruthy();
});

test('a deleted loan says so and goes back', async () => {
  await seed([], []);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const n = show();
  await waitFor(() => expect(n.goBack).toHaveBeenCalled());
  expect(alert).toHaveBeenCalledWith('Loan', 'This item no longer exists.');
  alert.mockRestore();
});
