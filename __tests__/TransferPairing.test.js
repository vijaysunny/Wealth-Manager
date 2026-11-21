import {
  findTransferPair,
  looksLikeCardPaymentDebit,
  isOpenCardPayment,
  isOpenCardBill,
} from '../utils/TransferPairing';

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

describe('A4: cc_bill (bank side) ↔ cc_payment (card side)', () => {
  const bill = (o = {}) => ({
    id: 'b',
    type: 'transfer',
    transferKind: 'cc_bill',
    flow: 'out',
    accountType: 'Bank Account',
    accountId: 'axis',
    amount: 9145.91,
    fullDate: '2026-07-05T10:00:00Z',
    ...o,
  });
  const pay = (o = {}) => ({
    ...card,
    id: 'p',
    accountId: 'axiscc',
    amount: 9145.91,
    fullDate: '2026-07-06T10:00:00Z',
    ...o,
  });

  test('same amount within 3 days pairs, either way round', () => {
    expect(findTransferPair(pay(), [bill()])?.id).toBe('b');
    expect(findTransferPair(bill(), [pay()])?.id).toBe('p');
    expect(findTransferPair(bill({ fullDate: '2026-07-09T09:00:00Z' }), [pay()])?.id).toBe('p');
  });

  test('4 days apart or a different amount does not pair', () => {
    expect(findTransferPair(pay(), [bill({ fullDate: '2026-07-02T09:00:00Z' })])).toBeNull();
    expect(findTransferPair(pay(), [bill({ amount: 9145.9 })])).toBeNull();
  });

  test('a linked or unresolved cc_bill is not open', () => {
    expect(isOpenCardBill(bill({ toAccountId: 'axiscc' }))).toBe(false);
    expect(isOpenCardBill(bill({ accountUnresolved: true }))).toBe(false);
    expect(isOpenCardBill(bill({ accountType: 'Credit Card' }))).toBe(false);
  });
});
