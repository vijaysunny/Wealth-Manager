/**
 * Wallet / UPI Lite classification (plan A2, edge cases A7).
 * Only the Axis top-up wording is a real owner sample; tests marked
 * UNVERIFIED-SAMPLE pin the guessed patterns so changes to them are deliberate.
 */
import {
  classifyWalletEvent,
  parseTransactionText,
  detectAccountType,
  detectBank,
  detectWalletProvider,
  extractMerchant,
  WALLET_SUBTYPES,
} from '../../utils/TransactionParser';

const AXIS_TOPUP =
  'UPI LITE enabled on UPI App for A/c no. XX0973 with successful top-up of INR 500.00 on 07-11-26 09:46:28 IST. Ref no. 01007102616409005179402498474608827 - Axis Bank';

describe('real Axis UPI Lite top-up (VERIFIED)', () => {
  test('classified as a bank-side top-up', () => {
    expect(classifyWalletEvent(AXIS_TOPUP)).toEqual({
      kind: 'wallet_topup',
      provider: null,
      subType: 'UPI Lite',
      perspective: 'bank',
      balanceBelongsTo: 'bank',
    });
  });
  test('parsed as a one-sided transfer out of the bank, never an expense', () => {
    const r = parseTransactionText(AXIS_TOPUP);
    expect(r).toMatchObject({
      type: 'transfer',
      kind: 'wallet_topup',
      flow: 'out',
      amount: 500,
      bankName: 'Axis Bank',
      accountType: 'Bank Account',
      last4: '0973',
      subType: 'UPI Lite',
      balanceBelongsTo: 'bank',
      category: 'Wallet Top-up',
      merchant: null,
    });
    expect(r.walletEvent).toEqual({ kind: 'wallet_topup', provider: null, subType: 'UPI Lite' });
  });
  test('words like "offer" do not drop a real top-up (rule 5)', () => {
    expect(parseTransactionText(`${AXIS_TOPUP} Check exciting offer on UPI Lite`)).not.toBeNull();
  });
  test('spacing / hyphen variants', () => {
    for (const w of ['UPI-Lite', 'UPILite', 'upi lite'])
      expect(classifyWalletEvent(AXIS_TOPUP.replace('UPI LITE', w))?.kind).toBe('wallet_topup');
  });
});

describe('not done yet → never applied (A7.7)', () => {
  test.each([
    'UPI Lite top-up of INR 500.00 from A/c XX0973 failed. - Axis Bank',
    'UPI Lite top-up of INR 500.00 from A/c XX0973 is pending. - Axis Bank',
    'Amount INR 500.00 will be credited to your UPI Lite shortly',
    'Your UPI Lite top-up request received for INR 500',
  ])('%s', (body) => {
    expect(classifyWalletEvent(body)).toEqual({ ignore: true });
    expect(parseTransactionText(body)).toBeNull();
  });
  test('"UPI Lite enabled" with no money movement is not a transaction', () => {
    expect(parseTransactionText('UPI LITE enabled on UPI App for A/c no. XX0973. - Axis Bank')).toBeNull();
  });
});

describe('UNVERIFIED-SAMPLE wallet shapes', () => {
  test('withdraw / disable back to bank = transfer into the bank', () => {
    const r = parseTransactionText(
      'UPI Lite disabled. INR 120.00 credited to A/c no. XX0973 on 09-11-26. Ref no. 0100710261640900 - Axis Bank'
    );
    expect(r).toMatchObject({ type: 'transfer', kind: 'wallet_withdraw', flow: 'in', bankName: 'Axis Bank' });
  });
  test('reversed top-up = money back to bank (nets to zero with the top-up, A7.8)', () => {
    const r = parseTransactionText(
      'UPI Lite top-up of INR 500.00 reversed and credited to A/c XX0973. Ref no. 01007102616409005179 - Axis Bank'
    );
    expect(r).toMatchObject({ type: 'transfer', kind: 'wallet_withdraw', flow: 'in' });
  });
  test('payment from Lite (wallet app SMS) = expense on the wallet, merchant kept', () => {
    const body = 'Paid Rs 45 to CHAI POINT using UPI Lite on PhonePe. Lite balance Rs 455';
    const r = parseTransactionText(body, { sender: 'VM-PHONEPE' });
    expect(r).toMatchObject({
      type: 'expense',
      accountType: 'Wallet',
      bankName: 'PhonePe',
      provider: 'PhonePe',
      subType: 'UPI Lite',
      balanceBelongsTo: 'wallet',
      merchant: 'CHAI POINT',
    });
    expect(r.walletEvent.kind).toBe('wallet_spend');
  });
  test('merchant refund into Lite = income on the wallet (A7.6)', () => {
    const r = parseTransactionText('Refund of Rs 45 from CHAI POINT credited to your PhonePe UPI Lite', {
      sender: 'VM-PHONEPE',
    });
    expect(r).toMatchObject({ type: 'income', accountType: 'Wallet', kind: null });
    expect(r.walletEvent.kind).toBe('wallet_credit');
  });
  test('other wallets take the same path (A7.15)', () => {
    expect(parseTransactionText('Paid Rs 99 to ZOMATO from Paytm Wallet')).toMatchObject({
      type: 'expense',
      accountType: 'Wallet',
      subType: 'Paytm Wallet',
      provider: 'Paytm',
    });
    expect(parseTransactionText('Rs 125 deducted from your FASTag wallet for toll at NH44')).toMatchObject({
      type: 'expense',
      accountType: 'Wallet',
      subType: 'FASTag',
    });
    expect(
      parseTransactionText('Recharge of Rs 1000 to FASTag successful. Debited from HDFC Bank A/c XX1111')
    ).toMatchObject({ type: 'transfer', kind: 'wallet_topup', flow: 'out', bankName: 'HDFC Bank' });
  });
});

describe('must NOT become wallet events', () => {
  test('RuPay credit card on UPI stays a card expense (A7.16)', () => {
    const r = parseTransactionText('Rs 200 spent on your RuPay Credit Card XX4321 via UPI at CAFE');
    expect(r).toMatchObject({ type: 'expense', accountType: 'Credit Card', kind: null, walletEvent: null });
  });
  test('plain UPI debit and mobile recharge are not wallets', () => {
    expect(
      parseTransactionText('INR 96.00 debited via UPI from Equitas A/c 1246 to HARISH.').walletEvent
    ).toBeNull();
    expect(
      parseTransactionText('Rs 299 debited from A/c XX0973 for Jio mobile recharge').walletEvent
    ).toBeNull();
  });
});

describe('banks vs wallet providers (rule 7)', () => {
  test('Paytm Payments Bank is a bank; Paytm alone is a provider', () => {
    expect(detectBank('', 'Rs 10 debited from Paytm Payments Bank a/c XX12')).toBe('Paytm Payments Bank');
    expect(detectWalletProvider('VM-PAYTM', 'Paid Rs 10 from Paytm Wallet')).toBe('Paytm');
  });
  test('a real bank named in the body beats the app named in it', () => {
    expect(detectBank('', 'Rs 10 debited from HDFC Bank A/c XX12 via Google Pay')).toBe('HDFC Bank');
  });
  test('app-only SMS keeps its provider label (backward compatible)', () => {
    expect(detectBank('CRED', 'payment received')).toBe('CRED');
  });
  test('detectAccountType: card wins, wallet-perspective = Wallet, else bank', () => {
    expect(detectAccountType('Paid Rs 99 from Paytm Wallet')).toBe('Wallet');
    expect(detectAccountType(AXIS_TOPUP)).toBe('Bank Account');
    expect(detectAccountType('spent on Credit Card at UPI Lite store')).toBe('Credit Card');
  });
  test('subtypes list', () => expect(WALLET_SUBTYPES).toContain('UPI Lite'));
});

test('merchant "paid to X using UPI Lite" (rule 9)', () => {
  expect(extractMerchant('Paid Rs 20 to TEA STALL using UPI Lite').merchant).toBe('TEA STALL');
});
