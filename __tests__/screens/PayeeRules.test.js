/** Phase 14 A6/C3: Settings → Categories → Payee rules: list, add, edit, delete, apply to past. */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import Storage from '../../data/Storage';
import { addMany, getAll } from '../../data/TransactionRepo';
import PayeeRulesScreen, { formToRule } from '../../screens/PayeeRulesScreen';
import SnackbarHost from '../../components/ui/SnackbarHost';
import { clearUndo } from '../../utils/UndoStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (cb) => require('react').useEffect(cb, [cb]),
}));
jest.setTimeout(30000);

const row = (id, day, extra = {}) => ({
  id,
  type: 'expense',
  amount: 100,
  merchant: 'SWIGGY INST',
  title: 'SWIGGY INST',
  category: 'General',
  account: 'Cash',
  fullDate: new Date(2026, 10, day, 10).toISOString(),
  date: `${day} Nov 2026`,
  tags: [],
  ...extra,
});
const rules = async () => JSON.parse((await Storage.getItem('category_rules')) || '[]');

beforeEach(async () => {
  await Storage.clear();
  clearUndo();
  await Storage.setItem('user_categories', JSON.stringify(['General', 'Food', 'Transport']));
  await addMany([row('a', 1), row('b', 2), row('u', 3, { merchant: 'Uber', title: 'Uber' })], {
    dedup: false,
  });
});

const open = async () => {
  render(
    <>
      <PayeeRulesScreen navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />
      <SnackbarHost />
    </>
  );
  await screen.findByText('No payee rules yet');
};

test('add a payee rule from a recent payee', async () => {
  await open();
  fireEvent.press(screen.getAllByRole('button', { name: 'Add rule' })[0]);
  fireEvent.press(await screen.findByRole('button', { name: 'SWIGGY INST' }));
  fireEvent.changeText(screen.getByTestId('rule-rename'), 'Swiggy Instamart');
  fireEvent.press(screen.getByRole('button', { name: 'Food' }));
  fireEvent.changeText(screen.getByTestId('rule-tags'), '#Groceries');
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Save rule' })));
  expect(
    await screen.findByText('SWIGGY INST → Swiggy Instamart · Food · #groceries · used 0 times')
  ).toBeTruthy();
  expect(await rules()).toEqual([
    expect.objectContaining({
      kind: 'payee',
      payeeKey: 'swiggy inst',
      rename: 'Swiggy Instamart',
      category: 'Food',
      tagsAdd: ['groceries'],
    }),
  ]);
});

test('add a contains rule; a rule with nothing to do is refused', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await open();
  fireEvent.press(screen.getAllByRole('button', { name: 'Add rule' })[0]);
  fireEvent.press(screen.getByRole('tab', { name: 'Contains text' }));
  fireEvent.changeText(screen.getByTestId('rule-pattern'), 'uber');
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Save rule' })));
  expect(alert).toHaveBeenCalledWith('Rule', 'Choose a new name, a category or a tag.');
  fireEvent.press(screen.getByRole('button', { name: 'Transport' }));
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Save rule' })));
  expect(await screen.findByText('Contains "uber" → Transport · used 0 times')).toBeTruthy();
  alert.mockRestore();
});

test('edit and delete from the ⋯ menu', async () => {
  await Storage.setItem(
    'category_rules',
    JSON.stringify([
      { id: 'r1', kind: 'payee', payeeKey: 'swiggy inst', label: 'SWIGGY INST', category: 'Food', hits: 3 },
    ])
  );
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<PayeeRulesScreen navigation={{ goBack: jest.fn() }} />);
  await screen.findByText('SWIGGY INST → Food · used 3 times');
  fireEvent.press(screen.getByRole('button', { name: 'Rule actions for SWIGGY INST' }));
  fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.press(screen.getByRole('button', { name: 'Transport' }));
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Save rule' })));
  expect(await screen.findByText('SWIGGY INST → Transport · used 3 times')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Rule actions for SWIGGY INST' }));
  fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
  const buttons = alert.mock.calls[0][2];
  await act(async () => buttons.find((b) => b.text === 'Delete').onPress());
  expect(await screen.findByText('No payee rules yet')).toBeTruthy();
  expect(await rules()).toEqual([]);
  alert.mockRestore();
});

test('Apply to past transactions now updates the matching rows, with Undo', async () => {
  await Storage.setItem(
    'category_rules',
    JSON.stringify([
      { id: 'r1', kind: 'payee', payeeKey: 'swiggy inst', label: 'SWIGGY INST', category: 'Food' },
    ])
  );
  render(
    <>
      <PayeeRulesScreen navigation={{ goBack: jest.fn() }} />
      <SnackbarHost />
    </>
  );
  await screen.findByText('SWIGGY INST → Food · used 0 times');
  fireEvent.press(screen.getByRole('button', { name: 'Rule actions for SWIGGY INST' }));
  fireEvent.press(screen.getByRole('button', { name: 'Apply to past transactions now' }));
  expect(await screen.findByText('Apply to 2 past transactions?')).toBeTruthy();
  expect(screen.queryByText('Also for future SMS')).toBeNull();
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Update 2' })));
  expect(await screen.findByText('Updated 2 transactions')).toBeTruthy();
  expect(
    (await getAll())
      .filter((x) => x.category === 'Food')
      .map((x) => x.id)
      .sort()
  ).toEqual(['a', 'b']);
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Undo' })));
  await waitFor(async () => expect((await getAll()).filter((x) => x.category === 'Food')).toHaveLength(0));
});

test('formToRule validation', () => {
  expect(formToRule({ mode: 'payee', payeeKey: null })).toEqual({ error: 'Pick a payee.' });
  expect(formToRule({ mode: 'contains', pattern: ' ' })).toEqual({ error: 'Enter the text to look for.' });
  expect(formToRule({ mode: 'contains', pattern: 'x', rename: 'Y', tags: '' })).toEqual({
    error: 'Choose a new name, a category or a tag.',
  });
  expect(formToRule({ mode: 'payee', payeeKey: 'k', tags: 'a, #B a' }).rule).toEqual({
    kind: 'payee',
    payeeKey: 'k',
    label: 'k',
    tagsAdd: ['a', 'b'],
  });
});
