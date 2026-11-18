import { findTransferPair, looksLikeCardPaymentDebit, isOpenCardPayment } from '../utils/TransferPairing';

const card = {
  id: 'c',
  type: 'transfer',
  transferKind: 'cc_payment',
  flow: 'in',
  accountId: 'sbicc',
  amount: 5770,
  fullDate: '2026-11-10T10:00:00Z',
};
const debit = (o = {}) => ({
  id: 'd',
  type: 'expense',
  accountType: 'Bank Account',
  accountId: 'axis',
  amount: 5770,
  merchant: 'SBI CARD',
  fullDate: '2026-11-09T10:00:00Z',
  ...o,
});

test('pairs either way round; closest in time wins', () => {
  expect(findTransferPair(card, [debit()])?.id).toBe('d');
  expect(findTransferPair(debit(), [card])?.id).toBe('c');
  const near = debit({ id: 'near', fullDate: '2026-11-10T09:00:00Z' });
  expect(findTransferPair(card, [debit(), near]).id).toBe('near');
});

test('refuses: different amount, unresolved account, already linked, no hint, card-side expense', () => {
  expect(findTransferPair(card, [debit({ amount: 5770.5 })])).toBeNull();
  expect(findTransferPair(card, [debit({ accountUnresolved: true })])).toBeNull();
  expect(isOpenCardPayment({ ...card, toAccountId: 'axis' })).toBe(false);
  expect(looksLikeCardPaymentDebit(debit({ merchant: 'GROCERY' }))).toBe(false);
  expect(looksLikeCardPaymentDebit(debit({ accountType: 'Credit Card' }))).toBe(false);
  expect(looksLikeCardPaymentDebit(debit({ merchant: null, channel: 'BBPS' }))).toBe(true);
  expect(findTransferPair({ type: 'expense', amount: 1 }, [card])).toBeNull();
});
