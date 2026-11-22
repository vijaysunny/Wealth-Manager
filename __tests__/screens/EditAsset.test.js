/** Phase 13 A4: a card's balance is shown as "Amount you owe"; negative means overpaid. */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import Storage from '../../data/Storage';
import EditAssetScreen from '../../screens/EditAssetScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const nav = () => ({ goBack: jest.fn(), navigate: jest.fn() });
const show = (asset) => render(<EditAssetScreen navigation={nav()} route={{ params: { asset } }} />);

test('card owing 1200 shows "1200" under Amount you owe, with the overpaid hint', () => {
  show({ id: 'ac', type: 'Credit Card', name: 'Axis Card', balance: 1200 });
  expect(screen.getByText('AMOUNT YOU OWE (₹)')).toBeTruthy();
  expect(screen.getByDisplayValue('1200')).toBeTruthy();
  expect(screen.getByText('Negative = the bank owes you (overpaid)')).toBeTruthy();
  expect(screen.getByText('Edit card')).toBeTruthy();
});

test('an overpaid card shows −50 and can be saved negative; balanceSetAt is stamped', async () => {
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([{ id: 'ac', type: 'Credit Card', name: 'Axis Card', balance: -50 }])
  );
  const n = nav();
  render(
    <EditAssetScreen
      navigation={n}
      route={{ params: { asset: { id: 'ac', type: 'Credit Card', name: 'Axis Card', balance: -50 } } }}
    />
  );
  expect(screen.getByDisplayValue('-50')).toBeTruthy();
  fireEvent.changeText(screen.getByDisplayValue('-50'), '−75');
  fireEvent.press(screen.getByText('Update Asset'));
  await waitFor(() => expect(n.goBack).toHaveBeenCalled());
  const [card] = JSON.parse(await Storage.getItem('user_wealth_accounts'));
  expect(card.balance).toBe(-75);
  expect(card.balanceSetAt).toBeTruthy();
});

test('a loan says Amount you owe; a bank still refuses a negative balance', async () => {
  show({ id: 'l', type: 'Loan', name: 'Bajaj Finance', balance: 4304 });
  expect(screen.getByText('AMOUNT YOU OWE (₹)')).toBeTruthy();
  expect(screen.queryByText('Negative = the bank owes you (overpaid)')).toBeNull();
  screen.unmount();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  show({ id: 'b', type: 'Bank Account', name: 'Axis', balance: 10 });
  expect(screen.getByText('CURRENT BALANCE (₹)')).toBeTruthy();
  fireEvent.changeText(screen.getByDisplayValue('10'), '-5');
  fireEvent.press(screen.getByText('Update Asset'));
  expect(alert).toHaveBeenCalledWith('Error', 'Enter a valid non-negative value');
});
