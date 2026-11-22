/** Phase 13 B4/B5: Card detail and Card setup screens. */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import Storage from '../../data/Storage';
import { addMany } from '../../data/TransactionRepo';
import CardDetailScreen from '../../screens/CardDetailScreen';
import CardSetupScreen from '../../screens/CardSetupScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return { useFocusEffect: (cb) => R.useEffect(cb, []) };
});
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => 'rid'),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
jest.setTimeout(30000);

const day = (offset) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });
const baseCard = {
  id: 'ac',
  type: 'Credit Card',
  name: 'Axis Bank Credit Card ••9070',
  last4: '9070',
  balance: -4857.94,
};
const setUp = (extra = {}) => ({
  ...baseCard,
  creditLimit: 300000,
  statementDay: day(-3).getDate(),
  due: { mode: 'afterStatement', days: 20 },
  statements: [{ date: day(-3).toISOString(), totalDue: 3914, minDue: 200 }],
  ...extra,
});
const seed = async (card, more = []) => {
  await Storage.setItem('user_transactions', '[]');
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([
      card,
      { id: 'axis', type: 'Bank Account', name: 'Axis Bank ••0973', last4: '0973', balance: 0 },
      ...more,
    ])
  );
  await addMany(
    [
      {
        id: 's1',
        type: 'expense',
        amount: 30,
        title: 'ODS Protect parking',
        merchant: 'ODS Protect parking',
        category: 'Transport',
        accountId: 'ac',
        account: 'Axis Card',
        availableLimit: 274919.19,
        fullDate: day(-1).toISOString(),
      },
    ],
    { dedup: false }
  );
};
const showDetail = (n = nav()) => {
  render(<CardDetailScreen navigation={n} route={{ params: { cardId: 'ac' } }} />);
  return n;
};

describe('Card detail', () => {
  test('owed from limit with parts; Record payment pre-fills what is left', async () => {
    await seed(setUp());
    const n = showDetail();
    expect(await screen.findByText('₹25,080.81')).toBeTruthy();
    expect(screen.getByText(/^Limit ₹3,00,000 − available ₹2,74,919.19 \(SMS, /)).toBeTruthy();
    expect(screen.getByTestId('owed-parts')).toBeTruthy();
    expect(screen.getByText('Billed ₹3,914')).toBeTruthy();
    expect(screen.getByText(/^Due in 17 days$/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Record payment' }));
    expect(n.navigate).toHaveBeenCalledWith('MoneyTool', {
      tab: 'Transfers',
      prefill: { fromId: 'axis', toId: 'ac', amount: 3914 },
    });
    expect(screen.getByText('Axis Card ••9070')).toBeTruthy();
    expect(screen.getByText('ODS Protect parking')).toBeTruthy();
    expect(screen.getByText(/this cycle$/)).toBeTruthy();
    fireEvent.press(screen.getByText('See all'));
    expect(n.navigate).toHaveBeenCalledWith('Transactions', { accountId: 'ac' });
  });

  test('Overdue badge after the due date; no EMI row without tracked EMIs', async () => {
    await seed(
      setUp({ statements: [{ date: day(-30).toISOString(), totalDue: 500, dueDate: day(-2).toISOString() }] })
    );
    showDetail();
    expect(await screen.findByText('Overdue')).toBeTruthy();
    expect(screen.queryByTestId('card-emis')).toBeNull();
  });

  test('a tracked card EMI shows in the cycle and the "EMIs on this card" row', async () => {
    const emi = {
      id: 'emi1',
      type: 'Loan',
      loanKind: 'cardEmi',
      onCardId: 'ac',
      includedInCard: true,
      name: 'Phone EMI',
      emiAmount: 2256.46,
      tenure: 12,
      firstEmiDate: day(-60).toISOString(),
      status: 'active',
    };
    await seed(setUp({ statementDay: day(5).getDate() }), [emi]);
    const n = showDetail();
    expect(await screen.findByTestId('card-emis')).toBeTruthy();
    expect(screen.getByText(/Phone EMI · 1[01] left · managed in Liabilities/)).toBeTruthy();
    expect(screen.getByTestId('emi-line-emi1')).toBeTruthy();
    fireEvent.press(screen.getByTestId('card-emis'));
    expect(n.navigate).toHaveBeenCalledWith('Main', { screen: 'AccountsTab' });
  });

  test('not set up: history estimate with the overpaid link; add this month’s bill', async () => {
    await seed({ ...baseCard, statementDay: day(-3).getDate() });
    const n = showDetail();
    expect(await screen.findByText('Looks overpaid by ₹4,857.94. Set up the card to fix')).toBeTruthy();
    expect(screen.getByText('Estimate from SMS history')).toBeTruthy();
    fireEvent.press(screen.getByText('Looks overpaid by ₹4,857.94. Set up the card to fix'));
    expect(n.navigate).toHaveBeenCalledWith('CardSetup', { cardId: 'ac' });
    fireEvent.press(screen.getByRole('button', { name: "Add this month's bill" }));
    fireEvent.changeText(screen.getByLabelText('Total due (₹)'), '3,914');
    fireEvent.changeText(screen.getByLabelText('Minimum due (₹)'), '200');
    fireEvent.press(screen.getByRole('button', { name: 'Save bill' }));
    expect(await screen.findByText(/^Bill of /)).toBeTruthy();
    const saved = JSON.parse(await Storage.getItem('user_wealth_accounts')).find((a) => a.id === 'ac');
    expect(saved.statements[0]).toMatchObject({ totalDue: 3914, minDue: 200, source: 'manual' });
  });

  test('a deleted card says so and goes back', async () => {
    await seed({ ...baseCard, id: 'other' });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const n = showDetail();
    await waitFor(() => expect(n.goBack).toHaveBeenCalled());
    expect(alert).toHaveBeenCalledWith('Card', 'This item no longer exists.');
  });
});

describe('Card setup', () => {
  const showSetup = (n = nav()) => {
    render(<CardSetupScreen navigation={n} route={{ params: { cardId: 'ac' } }} />);
    return n;
  };
  test('owed box explains the overpaid history balance; Save fixes it', async () => {
    await seed(baseCard);
    const n = showSetup();
    fireEvent.changeText(await screen.findByTestId('card-limit'), '3,00,000');
    fireEvent.press(screen.getByRole('button', { name: 'Statement day 15' }));
    expect(screen.getByText('₹25,080.81')).toBeTruthy();
    expect(screen.getByTestId('owed-note')).toBeTruthy();
    expect(screen.getByText(/shows this card as ₹4,857.94 in credit/)).toBeTruthy();
    expect(screen.getByText(/^Next due: /)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(n.goBack).toHaveBeenCalled());
    const saved = JSON.parse(await Storage.getItem('user_wealth_accounts')).find((a) => a.id === 'ac');
    expect(saved).toMatchObject({ creditLimit: 300000, statementDay: 15, balance: 25080.81 });
  });

  test('validation: a limit below the available limit, then a missing statement day', async () => {
    await seed(baseCard);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const n = showSetup();
    fireEvent.changeText(await screen.findByTestId('card-limit'), '1000');
    fireEvent.press(screen.getByRole('button', { name: 'Statement day 15' }));
    expect(screen.getByTestId('setup-error').props.children).toMatch(/can't be less than the available/);
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(alert).toHaveBeenCalledWith('Card setup', expect.stringMatching(/available/));
    fireEvent.changeText(screen.getByTestId('card-limit'), '300000');
    fireEvent.press(screen.getByRole('tab', { name: 'Fixed day' }));
    fireEvent.changeText(screen.getByLabelText('Due day of the month'), '45');
    expect(screen.getByTestId('setup-error').props.children).toMatch(/due day/);
    expect(n.goBack).not.toHaveBeenCalled();
  });
});
