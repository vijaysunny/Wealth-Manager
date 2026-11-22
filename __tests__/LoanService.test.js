/** Review fixes: closing keeps what was owed; unlinking a foreclosure reopens the loan. */
import Storage from '../data/Storage';
import { addMany, getAll } from '../data/TransactionRepo';
import { closeLoan, reopenLoan, saveLink, unlinkPayment, loadLoan } from '../utils/LoanService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));

beforeEach(async () => {
  await Storage.clear();
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([
      { id: 'bank', name: 'Axis Bank ••0973', type: 'Bank Account', balance: 100000 },
      { id: 'gold', name: 'Gold loan', type: 'Loan', balance: 50000 },
    ])
  );
});

test('close → reopen puts back a hand-entered balance', async () => {
  await closeLoan('gold');
  expect((await loadLoan('gold')).loan).toMatchObject({ status: 'closed', balance: 0 });
  await closeLoan('gold'); // closing twice keeps the first figure
  await reopenLoan('gold');
  const { loan } = await loadLoan('gold');
  expect(loan).toMatchObject({ status: 'active', balance: 50000, closedAt: null, balanceBeforeClose: null });
  await expect(closeLoan('nope')).rejects.toThrow('no longer exists');
  await expect(reopenLoan('nope')).rejects.toThrow('no longer exists');
});

test('unlinking a foreclosure reopens the loan; unlinking an EMI does not touch it', async () => {
  await addMany([
    {
      id: 't1',
      amount: 50000,
      type: 'expense',
      category: 'General',
      accountId: 'bank',
      fullDate: new Date(2026, 10, 1).toISOString(),
    },
    {
      id: 't2',
      amount: 5000,
      type: 'expense',
      category: 'General',
      accountId: 'bank',
      fullDate: new Date(2026, 10, 2).toISOString(),
    },
  ]);
  await saveLink('t1', { loanId: 'gold', kind: 'foreclosure', principal: 50000, interest: 0 });
  expect((await loadLoan('gold')).loan.status).toBe('closed');
  await unlinkPayment('t1');
  expect((await loadLoan('gold')).loan).toMatchObject({ status: 'active', balance: 50000 });
  expect((await getAll()).find((t) => t.id === 't1').loanLink).toBeUndefined();

  await saveLink('t2', { loanId: 'gold', kind: 'prepayment', principal: 5000, interest: 0 });
  await closeLoan('gold');
  await unlinkPayment('t2');
  expect((await loadLoan('gold')).loan.status).toBe('closed');
});
