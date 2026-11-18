import { capturedFields } from '../utils/CaptureMapper';
import { parseTransactionText } from '../utils/TransactionParser';

test('copies parser fields; transfer kind/flow only for transfers', () => {
  const pay = parseTransactionText(
    'We have received payment of Rs.5,770.00 via BBPS & the same has been credited to your SBI Credit Card.'
  );
  expect(capturedFields(pay)).toMatchObject({
    accountType: 'Credit Card',
    transferKind: 'cc_payment',
    flow: 'in',
    channel: 'BBPS',
  });
  const spend = parseTransactionText('Rs.86.00 spent on your SBI Credit Card ending 1987 at X on 31/10/26.');
  const f = capturedFields(spend);
  expect(f.last4).toBe('1987');
  expect(f.transferKind).toBeUndefined();
  expect(f.needsAccountReview).toBeUndefined();
});

test('safe on empty input', () => {
  expect(capturedFields()).toEqual({
    accountType: null,
    last4: null,
    channel: null,
    counterparty: null,
    availableLimit: null,
    bankName: null,
  });
});

test('wallet events carry provider, subtype and balance owner', () => {
  const top = parseTransactionText(
    'UPI LITE enabled on UPI App for A/c no. XX0973 with successful top-up of INR 500.00 on 07-11-26. Ref no. 0100710261640900 - Axis Bank'
  );
  expect(capturedFields(top)).toMatchObject({
    bankName: 'Axis Bank',
    transferKind: 'wallet_topup',
    flow: 'out',
    walletSubType: 'UPI Lite',
    walletProvider: null,
    balanceBelongsTo: 'bank',
  });
});
