import { describeCapture, reviewHint } from '../utils/ReviewText';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

test('linked and one-sided transfers', () => {
  expect(
    describeCapture({
      type: 'transfer',
      transferKind: 'wallet_topup',
      account: 'Axis Bank',
      toAccount: 'UPI Lite',
      amount: 500,
    })
  ).toMatch(/^Top-up: Axis Bank → UPI Lite ₹\s?500/);
  expect(
    describeCapture({
      type: 'transfer',
      transferKind: 'cc_payment',
      account: 'SBI Card',
      flow: 'in',
      amount: 5770,
    })
  ).toMatch(/^Card payment: → SBI Card .*not linked yet/);
});

test('hints', () => {
  expect(reviewHint({ reviewReason: 'new_account', suggestedAccount: { name: 'HDFC Bank ••4321' } })).toMatch(
    /Create "HDFC Bank ••4321"/
  );
  expect(reviewHint({ transferCandidate: true })).toMatch(/own account/);
  expect(reviewHint({})).toBeNull();
});

describe('transferRoute (History subtitle)', () => {
  const { transferRoute } = require('../utils/ReviewText');
  test('linked, one-sided out, one-sided in, non-transfer', () => {
    expect(transferRoute({ type: 'transfer', account: 'Axis Bank', toAccount: 'UPI Lite' })).toBe(
      'Axis Bank → UPI Lite'
    );
    expect(transferRoute({ type: 'transfer', flow: 'out', account: 'Axis Bank' })).toBe(
      'Axis Bank → other account'
    );
    expect(transferRoute({ type: 'transfer', flow: 'in', account: 'SBI Card' })).toBe(
      'other account → SBI Card'
    );
    expect(transferRoute({ type: 'expense', account: 'Axis Bank' })).toBeNull();
  });
});
