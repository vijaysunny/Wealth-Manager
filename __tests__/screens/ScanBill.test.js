// B1 Scan bill: Home → Expense with scanBill → camera → the photo is attached on Save.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import Storage from '../../data/Storage';
import { getAll } from '../../data/TransactionRepo';
import ExpenseScreen from '../../screens/ExpenseScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (cb) => require('react').useEffect(cb, [cb]),
}));
jest.mock('../../utils/AttachmentPickers', () => ({
  pickFromCamera: jest.fn(async () => ({
    uri: 'file:///cache/photo.jpg',
    name: 'photo.jpg',
    mime: 'image/jpeg',
    size: 900,
  })),
}));
const mockFiles = {};
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  makeDirectoryAsync: jest.fn(async () => {}),
  copyAsync: jest.fn(async ({ from, to }) => {
    mockFiles[to] = from;
  }),
  deleteAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 1 })),
}));
jest.setTimeout(30000);

test('scanBill opens the camera; Save stores the expense with the photo', async () => {
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([{ id: 'a', name: 'Axis Bank', type: 'Bank Account', balance: 1000 }])
  );
  const navigation = { goBack: jest.fn(), setParams: jest.fn(), navigate: jest.fn() };
  render(<ExpenseScreen navigation={navigation} route={{ params: { scanBill: true } }} />);
  expect(await screen.findByTestId('bill-attached')).toBeTruthy();
  expect(require('../../utils/AttachmentPickers').pickFromCamera).toHaveBeenCalledTimes(1);
  fireEvent.changeText(screen.getByPlaceholderText('0'), '250');
  fireEvent.press(await screen.findByText('Food'));
  fireEvent.press(screen.getByText(/save/i));
  await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  const [tx] = await getAll();
  expect(tx.amount).toBe(250);
  expect(tx.attachments).toHaveLength(1);
  expect(tx.attachments[0].uri).toMatch(/^file:\/\/\/doc\/attachments\/.+-photo\.jpg$/);
  expect(Object.values(mockFiles)).toContain('file:///cache/photo.jpg');
});
