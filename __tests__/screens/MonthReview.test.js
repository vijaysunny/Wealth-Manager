/** Phase 14 E6: Month in review screen, Home card on the 1st–7th, Budget link. */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

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
jest.mock('expo-notifications', () => ({ setNotificationHandler: jest.fn() }));
jest.mock('../../utils/NotificationService', () => ({
  sendTransactionNotification: jest.fn(),
  notificationsAllowed: jest.fn(async () => true),
}));
jest.setTimeout(30000);

const { Share } = require('react-native');
const Storage = require('../../data/Storage').default;
const { addMany } = require('../../data/TransactionRepo');
const MonthReviewScreen = require('../../screens/MonthReviewScreen').default;
const { pastMonths } = require('../../screens/MonthReviewScreen');
const { monthDate } = require('../../utils/TransactionQuery');

const at = (m, d) => new Date(2026, m - 1, d, 12).toISOString();
const ex = (id, m, d, amount, category, over = {}) => ({
  id,
  type: 'expense',
  amount,
  category,
  merchant: category,
  fullDate: at(m, d),
  ...over,
});
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });

beforeEach(async () => {
  await Storage.clear();
  await Storage.setItem('user_category_budgets', JSON.stringify({ Food: 4500, Bills: 5000 }));
  await Storage.setItem('last_backup_at', new Date().toISOString());
  await addMany(
    [
      ex('o1', 10, 5, 2000, 'Food'),
      { id: 'sal', type: 'income', amount: 10000, category: 'Salary', fullDate: at(11, 1) },
      ex('f1', 11, 3, 5120, 'Food'),
      ex('b1', 11, 10, 300, 'Bills'),
      ex('s1', 11, 18, 200, 'Subscriptions'),
      ex('t1', 11, 12, 100, 'Transport'),
      ex('x1', 11, 13, 80, 'Health'),
    ],
    { dedup: false }
  );
});

test('figures, where it went, over budget, notes; Share sends the summary', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({});
  const n = nav();
  render(<MonthReviewScreen navigation={n} route={{ params: { month: '2026-11' } }} />);
  expect(await screen.findByText('November in review')).toBeTruthy();
  expect(screen.getByTestId('review-spent').props.children).toBe('₹5,800');
  expect(screen.getByText('₹3,800 more than October (+190%)')).toBeTruthy();
  expect(screen.getByText('₹10,000')).toBeTruthy();
  expect(screen.getByText('₹4,200 · 42%')).toBeTruthy();
  expect(screen.getByText('Everything else (1 category)')).toBeTruthy();
  expect(screen.getByText('Over budget: Food by ₹620')).toBeTruthy();
  expect(screen.getByText('Budget ₹4,500 · 1 of 1 other budgets stayed under')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Food ₹5,120. Show transactions' }));
  expect(n.navigate).toHaveBeenCalledWith('Transactions', {
    query: {
      date: monthDate(new Date(2026, 10, 1)),
      categories: ['Food'],
      types: ['expense'],
    },
  });
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Share summary' })));
  expect(share.mock.calls[0][0].message.split('\n')[0]).toBe('November 2026 in review');
});

test('switching to October from the month menu; an empty month says so', async () => {
  render(<MonthReviewScreen navigation={nav()} route={{ params: { month: '2026-11' } }} />);
  await screen.findByText('November in review');
  fireEvent.press(screen.getByRole('button', { name: 'Choose month' }));
  fireEvent.press(screen.getByRole('button', { name: 'October 2026' }));
  expect(await screen.findByText('October in review')).toBeTruthy();
  expect(await screen.findByText('All 2 budgets stayed under')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Choose month' }));
  fireEvent.press(screen.getByRole('button', { name: 'September 2026' }));
  expect(await screen.findByText('No spending recorded in September.')).toBeTruthy();
  expect(screen.queryByText(/than August|in August/)).toBeNull();
});

test('pastMonths: the 12 months before this one', () => {
  const m = pastMonths(new Date(2026, 0, 15));
  expect(m).toHaveLength(12);
  expect(m[0]).toEqual(new Date(2025, 11, 1));
  expect(m[11]).toEqual(new Date(2025, 0, 1));
});

describe('Home card', () => {
  const fake = (d) =>
    jest.useFakeTimers({
      now: d,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    });
  afterEach(() => jest.useRealTimers());
  test('on the 3rd: "November in review" opens last month', async () => {
    fake(new Date(2026, 11, 3, 10));
    const HomeScreen = require('../../screens/HomeScreen').default;
    const n = nav();
    render(<HomeScreen navigation={n} />);
    fireEvent.press(await screen.findByText('November in review'));
    expect(n.navigate).toHaveBeenCalledWith('MonthReview', { month: '2026-11' });
  });
  test('on the 8th: no card', async () => {
    fake(new Date(2026, 11, 8, 10));
    const HomeScreen = require('../../screens/HomeScreen').default;
    render(<HomeScreen navigation={nav()} />);
    await screen.findByTestId('greeting');
    expect(screen.queryByTestId('review-month-card')).toBeNull();
  });
});
