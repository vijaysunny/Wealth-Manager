/** C5.3 Transaction detail: collapsed sections, tags editor, count in reports, save, delete. */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import Storage from '../../data/Storage';
import { addMany, getAll } from '../../data/TransactionRepo';
import EditTransactionScreen from '../../screens/EditTransactionScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
}));
jest.mock('../../utils/AttachmentPickers', () => ({
  pickFromCamera: jest.fn(async () => null),
  pickFromGallery: jest.fn(async () => null),
  pickAnyFile: jest.fn(async () => ({
    uri: 'file:///cache/bill.pdf',
    name: 'bill.pdf',
    mime: 'application/pdf',
    size: 2048,
  })),
  openAttachment: jest.fn(async () => {}),
}));
const mockFiles = {};
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  makeDirectoryAsync: jest.fn(async () => {}),
  copyAsync: jest.fn(async ({ from, to }) => {
    mockFiles[to] = from;
  }),
  deleteAsync: jest.fn(async (uri) => {
    Object.keys(mockFiles).forEach((k) => k.startsWith(uri) && delete mockFiles[k]);
  }),
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 1 })),
}));
jest.setTimeout(30000);

const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });
const base = {
  id: 'g1',
  type: 'expense',
  amount: 1998.19,
  merchant: 'Google',
  title: 'Google',
  category: 'Subscriptions',
  account: 'Axis Bank',
  accountId: 'axis',
  smsId: 'sms:AX:1:1998.19',
  bankName: 'Axis Bank',
  fullDate: new Date(2026, 10, 18, 10).toISOString(),
  tags: ['auto-sms', 'tax-2026'],
  attachments: [{ id: 'f1', name: 'invoice.pdf', mime: 'application/pdf', size: 120000 }],
};

beforeEach(async () => {
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([{ id: 'axis', name: 'Axis Bank', type: 'Bank Account', last4: '0973', balance: 1000 }])
  );
  await addMany(
    [base, { id: 'o', type: 'expense', amount: 5, fullDate: base.fullDate, tags: ['reimburse'] }],
    {
      dedup: false,
    }
  );
});

const open = async (tx = base) => {
  const n = nav();
  render(<EditTransactionScreen navigation={n} route={{ params: { transaction: tx } }} />);
  await screen.findByText('Axis ••0973');
  return n;
};

test('sections are collapsed by default and show badge/summary', async () => {
  await open();
  const files = screen.getByRole('button', { name: 'Bills & files' });
  const tags = screen.getByRole('button', { name: 'Tags' });
  expect(files.props.accessibilityState.expanded).toBe(false);
  expect(tags.props.accessibilityState.expanded).toBe(false);
  expect(screen.getByText('1')).toBeTruthy(); // file count badge
  expect(screen.getByText('#tax-2026')).toBeTruthy(); // summary, system tag hidden
  expect(screen.queryByText(/auto-sms/)).toBeNull();
  expect(screen.queryByText('invoice.pdf')).toBeNull();
  expect(screen.getByText('From SMS · Axis Bank')).toBeTruthy();
  fireEvent.press(files);
  expect(screen.getByText('invoice.pdf')).toBeTruthy();
  expect(screen.getByText('PDF · 117 KB')).toBeTruthy();
});

test('tag editor: Enter and comma add normalised tags, Used before suggests, save persists', async () => {
  const n = await open();
  fireEvent.press(screen.getByRole('button', { name: 'Tags' }));
  const input = screen.getByTestId('tag-input');
  fireEvent.changeText(input, 'Work Trip,');
  fireEvent.changeText(input, '#Google One');
  fireEvent(input, 'submitEditing');
  fireEvent.press(screen.getByRole('button', { name: '#reimburse' }));
  fireEvent.press(screen.getByRole('button', { name: 'Remove #tax-2026' }));
  fireEvent.changeText(screen.getByTestId('payee-input'), 'Google One');
  fireEvent(screen.getByLabelText('Count in reports'), 'valueChange', false);
  fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(n.goBack).toHaveBeenCalled());
  const saved = (await getAll()).find((x) => x.id === 'g1');
  expect(saved.tags).toEqual(['auto-sms', 'work-trip', 'google-one', 'reimburse']);
  expect(saved.merchant).toBe('Google One');
  expect(saved.excludeFromReports).toBe(true);
  expect(saved.attachments).toHaveLength(1);
});

test('invalid amount is refused; switching to Transfer is explained, not applied', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await open();
  fireEvent.press(screen.getByRole('tab', { name: 'Transfer' }));
  expect(alert).toHaveBeenCalledWith('Transfer', expect.stringMatching(/New transfer/));
  fireEvent.changeText(screen.getByTestId('amount-input'), '0');
  fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
  expect(alert).toHaveBeenCalledWith('Amount', expect.any(String));
  alert.mockRestore();
});

test('delete asks first and mentions attached files', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const n = await open();
  fireEvent.press(screen.getByRole('button', { name: 'Delete transaction' }));
  const [title, body, buttons] = alert.mock.calls[0];
  expect(title).toBe('Delete transaction?');
  expect(body).toMatch(/1 attached file/);
  await buttons.find((b) => b.text === 'Delete').onPress();
  expect(n.goBack).toHaveBeenCalled();
  expect((await getAll()).find((x) => x.id === 'g1')).toBeUndefined();
  alert.mockRestore();
});

test('a transfer shows its route and keeps amount read-only', async () => {
  const tr = {
    ...base,
    id: 'tr',
    type: 'transfer',
    toAccount: 'UPI Lite',
    attachments: [],
    merchant: null,
    title: 'UPI Lite top-up',
  };
  await addMany([tr], { dedup: false });
  render(<EditTransactionScreen navigation={nav()} route={{ params: { transaction: tr } }} />);
  expect(await screen.findByText('Axis → UPI Lite')).toBeTruthy();
  expect(screen.getByTestId('amount-input').props.editable).toBe(false);
});

test('B1: Any file attaches and saves at once; tap opens; remove asks and deletes the file', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const pickers = require('../../utils/AttachmentPickers');
  await open();
  fireEvent.press(screen.getByRole('button', { name: 'Bills & files' }));
  fireEvent.press(screen.getByRole('button', { name: 'Attach from Any file' }));
  expect(await screen.findByText('bill.pdf')).toBeTruthy();
  let saved = (await getAll()).find((x) => x.id === 'g1');
  expect(saved.attachments.map((a) => a.name)).toEqual(['invoice.pdf', 'bill.pdf']);
  const uri = saved.attachments[1].uri;
  expect(uri).toMatch(/^file:\/\/\/doc\/attachments\/g1\/.+-bill\.pdf$/);
  expect(mockFiles[uri]).toBe('file:///cache/bill.pdf');
  fireEvent.press(screen.getByRole('button', { name: 'Open bill.pdf' }));
  expect(pickers.openAttachment).toHaveBeenCalledWith(expect.objectContaining({ name: 'bill.pdf' }));
  fireEvent.press(screen.getByRole('button', { name: 'Remove bill.pdf' }));
  await alert.mock.calls
    .find((c) => c[0] === 'Remove file?')[2]
    .find((b) => b.text === 'Remove')
    .onPress();
  await waitFor(() => expect(screen.queryByText('bill.pdf')).toBeNull());
  saved = (await getAll()).find((x) => x.id === 'g1');
  expect(saved.attachments.map((a) => a.name)).toEqual(['invoice.pdf']);
  expect(mockFiles[uri]).toBeUndefined();
  alert.mockRestore();
});

test('B1: a file over 25 MB shows the limit message', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  require('../../utils/AttachmentPickers').pickAnyFile.mockResolvedValueOnce({
    uri: 'file:///c/big',
    name: 'big.pdf',
    size: 30 * 1048576,
  });
  await open();
  fireEvent.press(screen.getByRole('button', { name: 'Bills & files' }));
  fireEvent.press(screen.getByRole('button', { name: 'Attach from Any file' }));
  await waitFor(() =>
    expect(alert).toHaveBeenCalledWith(
      'Could not attach',
      'This file is 30.0 MB. The limit is 25 MB per file.'
    )
  );
  alert.mockRestore();
});

test('B1: deleting a transaction deletes its folder', async () => {
  const fsm = require('expo-file-system/legacy');
  const { remove } = require('../../data/TransactionRepo');
  await remove('g1');
  expect(fsm.deleteAsync).toHaveBeenCalledWith('file:///doc/attachments/g1/', { idempotent: true });
});
