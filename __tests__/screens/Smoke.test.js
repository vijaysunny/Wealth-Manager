/**
 * C6 screen smoke tests (RNTL): the screens touched in Phase 11 render with real storage
 * (in-memory SQLite from jest.setup.js), and the wallet reconcile flow works end to end.
 * Native-only pieces (icons, WebView, date picker, notifications, SMS reader) are stubbed.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialIcons: () => null }));
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return { useFocusEffect: (cb) => R.useEffect(cb, []), useNavigation: () => ({ navigate: jest.fn() }) };
});
jest.mock('react-native-webview', () => () => null);
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  AndroidNotificationPriority: { HIGH: 'high' },
  SchedulableTriggerInputTypes: { DAILY: 'daily', WEEKLY: 'weekly' },
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
jest.mock('../../components/RealSmsReader', () => ({
  scanBankSms: jest.fn(async () => []),
  requestSmsPermission: jest.fn(async () => false),
}));

const Storage = require('../../data/Storage').default;
const nav = () => ({
  navigate: jest.fn(),
  goBack: jest.fn(),
  setOptions: jest.fn(),
  addListener: () => () => {},
});
const ACCOUNTS = [
  { id: 'axis', name: 'Axis Bank', type: 'Bank Account', balance: 10000 },
  {
    id: 'lite',
    name: 'UPI Lite',
    type: 'Wallet',
    subType: 'UPI Lite',
    provider: 'PhonePe',
    linkedBankId: 'axis',
    balance: 500,
  },
];
const accounts = async () => JSON.parse((await Storage.getItem('user_wealth_accounts')) || '[]');

beforeEach(async () => {
  await Storage.setItem('user_wealth_accounts', JSON.stringify(ACCOUNTS));
  await Storage.setItem('user_transactions', '[]');
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('WealthScreen (A6)', () => {
  const WealthScreen = require('../../screens/WealthScreen').default;

  test('wallets are grouped under "Cash & wallets" with their funding bank', async () => {
    render(<WealthScreen navigation={nav()} />);
    expect(await screen.findByText('Cash & wallets')).toBeTruthy();
    expect(screen.getByText(/from Axis Bank/)).toBeTruthy();
    expect(screen.getByText('Reconcile')).toBeTruthy();
  });

  test('Reconcile: app shows ₹300 → confirm → ₹200 unrecorded spend, wallet = 300', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    render(<WealthScreen navigation={nav()} />);
    fireEvent.press(await screen.findByText('Reconcile'));
    fireEvent.changeText(screen.getByPlaceholderText('Balance in the app'), '300');
    fireEvent.press(screen.getByText('Continue'));
    expect(alert).toHaveBeenCalledWith(
      'Record unrecorded spends?',
      expect.stringMatching(/200/),
      expect.any(Array)
    );
    const confirm = alert.mock.calls[0][2].find((b) => b.style !== 'cancel');
    await confirm.onPress();
    await waitFor(async () => expect((await accounts()).find((a) => a.id === 'lite').balance).toBe(300));
    const txs = await require('../../data/TransactionRepo').getAll();
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ type: 'expense', amount: 200, source: 'wallet_reconcile' });
    expect((await accounts()).find((a) => a.id === 'axis').balance).toBe(10000);
  });

  test('Reconcile rejects a non-number without saving', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    render(<WealthScreen navigation={nav()} />);
    fireEvent.press(await screen.findByText('Reconcile'));
    fireEvent.changeText(screen.getByPlaceholderText('Balance in the app'), 'abc');
    fireEvent.press(screen.getByText('Continue'));
    expect(alert.mock.calls[0][0]).toBe('Check the amount');
    expect((await accounts()).find((a) => a.id === 'lite').balance).toBe(500);
  });
});

describe('A7.9 / History transfers', () => {
  test('a wallet below zero is flagged for reconcile', async () => {
    await Storage.setItem(
      'user_wealth_accounts',
      JSON.stringify([ACCOUNTS[0], { ...ACCOUNTS[1], balance: -40 }])
    );
    const WealthScreen = require('../../screens/WealthScreen').default;
    render(<WealthScreen navigation={nav()} />);
    expect(await screen.findByText('Below zero - reconcile')).toBeTruthy();
  });

  test('History shows a transfer with its route and keeps it out of spending', async () => {
    const { addMany } = require('../../data/TransactionRepo');
    const now = new Date().toISOString();
    await addMany(
      [
        {
          id: 'tr1',
          type: 'transfer',
          amount: 500,
          title: 'UPI Lite top-up',
          accountId: 'axis',
          account: 'Axis Bank',
          toAccountId: 'lite',
          toAccount: 'UPI Lite',
          fullDate: now,
          category: 'Wallet Top-up',
        },
        {
          id: 'ex1',
          type: 'expense',
          amount: 120,
          title: 'Chai',
          accountId: 'lite',
          account: 'UPI Lite',
          fullDate: now,
          category: 'Food',
        },
      ],
      { dedup: false }
    );
    const AllTransactionsScreen = require('../../screens/AllTransactionsScreen').default;
    render(<AllTransactionsScreen navigation={nav()} route={{ params: {} }} />);
    expect(await screen.findByText('Axis Bank → UPI Lite · not counted in spending')).toBeTruthy();
    expect(screen.getByText('Chai')).toBeTruthy();
    expect(screen.queryByText(/620/)).toBeNull(); // spending total is 120, never 620
  });
});

describe('AddAssetScreen (A6)', () => {
  const AddAssetScreen = require('../../screens/AddAssetScreen').default;
  test('choosing Wallet shows wallet type, provider and funding-bank choices', async () => {
    render(<AddAssetScreen navigation={nav()} route={{ params: {} }} />);
    fireEvent.press(await screen.findByText('Wallet'));
    expect(screen.getByText('WALLET TYPE')).toBeTruthy();
    expect(screen.getByText('FASTag')).toBeTruthy();
    expect(screen.getByText('PhonePe')).toBeTruthy();
    expect(await screen.findByText('Axis Bank')).toBeTruthy();
  });
});

describe('ToolsScreen (A6 shortcuts)', () => {
  const ToolsScreen = require('../../screens/ToolsScreen').default;
  test('renders and offers a top-up shortcut for the wallet', async () => {
    render(<ToolsScreen navigation={nav()} route={{ params: { tab: 'Transfers' } }} />);
    expect(await screen.findByText('Top-up UPI Lite')).toBeTruthy();
  });
});

describe('HomeScreen (B2)', () => {
  const HomeScreen = require('../../screens/HomeScreen').default;
  test('renders and warns when there is no backup', async () => {
    render(<HomeScreen navigation={nav()} />);
    expect(await screen.findByText(/No backup yet/)).toBeTruthy();
  });
  test('no warning right after a backup', async () => {
    await Storage.setItem('last_backup_at', new Date().toISOString());
    render(<HomeScreen navigation={nav()} />);
    await screen.findByText(/Hello/);
    await waitFor(() => expect(screen.queryByText(/No backup yet|Last backup/)).toBeNull());
  });
});

describe('HomeScreen review card (A2)', () => {
  const HomeScreen = require('../../screens/HomeScreen').default;
  const { addMany } = require('../../data/TransactionRepo');
  const card = (i, o = {}) => ({
    id: `c${i}`,
    smsId: `sms:H:${i}`,
    type: 'expense',
    amount: 10,
    fullDate: new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString(),
    accountType: 'Credit Card',
    bankName: 'SBI',
    last4: '1987',
    ...o,
  });
  test('shows "N new accounts found in SMS" with the waiting count and opens Review', async () => {
    await addMany([card(1), card(2), card(3, { bankName: 'HDFC Bank', last4: '5555' })], {
      balanceMode: 'captured',
    });
    const n = nav();
    render(<HomeScreen navigation={n} />);
    expect(await screen.findByText('2 new accounts found in SMS')).toBeTruthy();
    expect(screen.getByText(/3 transactions waiting/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('review-card'));
    expect(n.navigate).toHaveBeenCalledWith('ReviewAccounts');
  });
  test('hidden when nothing is waiting', async () => {
    render(<HomeScreen navigation={nav()} />);
    await screen.findByText(/Hello/);
    expect(screen.queryByTestId('review-card')).toBeNull();
  });
});

describe('ImportScreen', () => {
  const ImportScreen = require('../../screens/ImportScreen').default;
  test('renders the idle state', async () => {
    render(<ImportScreen navigation={nav()} />);
    expect(await screen.findByText('Import Transactions')).toBeTruthy();
  });
});
