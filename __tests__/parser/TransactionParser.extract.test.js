/**
 * Unit tests for the Phase 2 extractors, using shapes from the owner's real Axis /
 * SBI Card / Equitas messages plus edge cases the fixtures do not cover.
 */
import {
  parseTransactionText,
  extractRefNo,
  extractLast4,
  extractAvailableLimit,
  extractChannel,
  extractMerchant,
  extractBalance,
  detectBank,
  guessCategory,
} from '../../utils/TransactionParser';

describe('extractRefNo', () => {
  test('ignores helpline / "SMS BLOCK ... to" phone numbers', () => {
    expect(extractRefNo('Not you? SMS BLOCK 9070 to +919951860002.')).toBeNull();
    expect(extractRefNo('SMS BLOCKALL CustID to 919951860002')).toBeNull();
    expect(extractRefNo('Call 919951860002 now')).toBeNull();
  });
  test('a real bare 12-digit ref still wins over a later phone number', () => {
    expect(extractRefNo('Rs 10 debited 401234567890 . SMS BLOCK to 919951860002')).toBe('401234567890');
  });
  test('slash narration ref', () => {
    expect(extractRefNo('IMPS/P2A/632013023016/baja\nWhatsApp BAL to 917036165000')).toBe('632013023016');
  });
  test('long UPI Lite reference (35 digits)', () => {
    expect(extractRefNo('Ref no. 01007102616409005179402498474608827 - Axis Bank')).toBe(
      '01007102616409005179402498474608827'
    );
  });
});

describe('extractLast4', () => {
  test.each([
    ['A/c no. XX0973 with', '0973'],
    ['Axis Bank A/c XX0973\n', '0973'],
    ['from Equitas A/c 1246-Ref:061704889746', '1246'],
    ['Credit Card ending 1987 at', '1987'],
    ['Credit Card no. XX9070 on', '9070'],
    ['From HDFC Bank A/C *1234 To', '1234'],
    ['account 50100234567890 credited', '7890'],
    ['Acct XX123 debited', '123'],
  ])('%s → %s', (text, want) => expect(extractLast4(text)).toBe(want));
  test('no digits → null', () => {
    expect(extractLast4('Your A/c has been debited towards Google for INR 1998.19')).toBeNull();
    expect(extractLast4('credited to your SBI Credit Card.')).toBeNull();
  });
});

describe('available limit is not a balance', () => {
  test('limit extracted; balance stays null', () => {
    const t = 'Avl limit: INR 275541.19. Not you?';
    expect(extractAvailableLimit(t)).toBeCloseTo(275541.19, 2);
    expect(extractBalance(t)).toBeNull();
    expect(extractAvailableLimit('Your available limit is Rs.178,307.37.')).toBeCloseTo(178307.37, 2);
  });
  test('"WhatsApp BAL to 91..." is not a balance', () => {
    expect(extractBalance('WhatsApp BAL to 917036165000')).toBeNull();
  });
});

describe('extractChannel', () => {
  test("C4: auto-debit mandates (ACH-DR from the owner's Axis SMS; ECS/SI synthetic)", () => {
    expect(extractChannel('Debit INR 538.00\nAxis Bank A/c XX0973\nACH-DR-BAJAJ FINANCE LTD-V').channel).toBe(
      'ACH'
    );
    expect(extractChannel('synthetic-ecs: ECS debit of Rs 900 to LENDER').channel).toBe('ECS');
    expect(extractChannel('synthetic-si: SI-LENDER debited Rs 900').channel).toBe('SI');
    expect(extractChannel('Rs 900 sent to Sinha').channel).toBeNull();
  });

  test('slash narration', () => {
    expect(extractChannel('UPI/P2M/630969451444/GROWW INVEST TECH P\nNot you?')).toEqual({
      channel: 'UPI',
      mode: 'P2M',
      counterparty: 'GROWW INVEST TECH P',
    });
  });
  test('"via BBPS"', () => expect(extractChannel('payment via BBPS & the same').channel).toBe('BBPS'));
  test('none', () => expect(extractChannel('Rs 10 spent at SHOP').channel).toBeNull());
});

describe('extractMerchant', () => {
  test('mandate debit uses the payee, not the mandate VPA', () => {
    const r = extractMerchant('debited towards Google for INR 1998.19 on 18-11-26. s2bv@apl - Axis Bank');
    expect(r.merchant).toBe('Google');
    expect(r.vpa).toBe('s2bv@apl');
  });
  test('"credited to your ... Card" is not a merchant', () => {
    expect(extractMerchant('has been credited to your SBI Credit Card.').merchant).toBeNull();
  });
});

describe('banks and categories', () => {
  test('Equitas is a known bank (owner account)', () => {
    expect(detectBank('', 'debited via UPI from Equitas A/c 1246')).toBe('Equitas Small Finance Bank');
  });
  test('category hints for run-together card-network merchant names', () => {
    expect(guessCategory('spent at ADYARANANDABHAVANSW on')).toBe('Food');
    expect(guessCategory('spent at PRADHANMANTRIBHARTIYAJ on')).toBe('Health');
    expect(guessCategory('A/c has been debited towards Google for')).toBe('Subscriptions');
  });
});

describe('credit-card payment vs refund vs spend', () => {
  test('payment received on card = one-sided transfer into the card', () => {
    const r = parseTransactionText(
      'We have received payment of Rs.5,770.00 via BBPS & the same has been credited to your SBI Credit Card. Your available limit is Rs.178,307.37.'
    );
    expect(r).toMatchObject({ type: 'transfer', kind: 'cc_payment', flow: 'in', accountType: 'Credit Card' });
    expect(r.merchant).toBeNull();
  });
  test('refund on a card stays income (it is a real reduction of spend)', () => {
    const r = parseTransactionText(
      'Refund of Rs 300 credited to your SBI Credit Card ending 1987 from AMAZON'
    );
    expect(r.type).toBe('income');
    expect(r.kind).toBeNull();
  });
  test('card spend stays expense', () => {
    const r = parseTransactionText('Rs.86.00 spent on your SBI Credit Card ending 1987 at X on 31/10/26.');
    expect(r).toMatchObject({ type: 'expense', kind: null, last4: '1987' });
  });
});

describe('review hints', () => {
  test('UPI to a person is not a transfer candidate; IMPS P2A is; P2M never', () => {
    expect(
      parseTransactionText(
        'INR 96.00 debited via UPI from Equitas A/c 1246 -Ref:061704889746 on 08-08-25 to HARISH.'
      ).transferCandidate
    ).toBe(false);
    expect(
      parseTransactionText('Debit INR 178.00\nAxis Bank A/c XX0973\nIMPS/P2A/632013023016/baja')
        .transferCandidate
    ).toBe(true);
    expect(
      parseTransactionText('INR 5050.00 debited\nA/c no. XX0973\nUPI/P2M/630969451444/GROWW')
        .transferCandidate
    ).toBe(false);
  });
  test('card messages never need account review just for missing digits', () => {
    expect(
      parseTransactionText(
        'We have received payment of Rs.10 via BBPS & the same has been credited to your SBI Credit Card.'
      ).needsAccountReview
    ).toBe(false);
  });
});

test('Bajaj Finance / Finserv is a loan payment (generic)', () => {
  expect(guessCategory('IMPS/P2A/632012808676/BAJAJ FINANCE LTD')).toBe('Loan/EMI');
  expect(guessCategory('NACH debit BAJAJ FINSERV')).toBe('Loan/EMI');
});

describe('bank and account type come from the account side, not the payee', () => {
  const { ownAccountText } = require('../../utils/TransactionParser');
  test('Axis debit paying "SBI CARD" is an Axis bank debit', () => {
    const r = parseTransactionText(
      'INR 5770.00 debited\nA/c no. XX0973\n10-11-26, 10:00:15\nUPI/P2M/631234567890/SBI CARD\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank'
    );
    expect(r).toMatchObject({
      bankName: 'Axis Bank',
      accountType: 'Bank Account',
      merchant: 'SBI CARD',
      last4: '0973',
    });
  });
  test('UPI payment "to HDFC CREDIT CARD" from Equitas stays Equitas savings', () => {
    const r = parseTransactionText(
      'INR 96.00 debited via UPI from Equitas A/c 1246 -Ref:061704889746 on 08-08-25 to HDFC CREDIT CARD.'
    );
    expect(r).toMatchObject({ bankName: 'Equitas Small Finance Bank', accountType: 'Bank Account' });
  });
  test('"credited to your SBI Credit Card" is kept (it is the account, not a payee)', () => {
    expect(ownAccountText('the same has been credited to your SBI Credit Card.')).toMatch(/SBI Credit Card/);
  });
});

describe('A6: cleanSlashPayee', () => {
  const { cleanSlashPayee } = require('../../utils/TransactionParser');
  test.each([
    ['C DA.View bal: https:', 'C DA'],
    ['BAJA. Chk Bal https:', 'BAJA'],
    ['Kavya', 'Kavya'],
    ['GROWW INVEST TECH P', 'GROWW INVEST TECH P'],
    ['Amazon Pay Credit C', 'Amazon Pay Credit C'],
    ['Paym - Axis Bank', 'Paym'],
    ['SHOP Not you? SMS', 'SHOP'],
    ['  NAME. ', 'NAME'],
    ['.View bal', null],
  ])('%j → %j', (raw, want) => expect(cleanSlashPayee(raw)).toBe(want));
});

describe('A7: extractAchPayee', () => {
  const { extractAchPayee } = require('../../utils/TransactionParser');
  test.each([
    [
      'Debit INR 538.00\nAxis Bank A/c XX0973\n07-11-26 14:25:34\nACH-DR-BAJAJ FINANCE LTD-V\nWhatsApp BAL',
      'Bajaj Finance',
    ],
    ['NACH DR HDFC LIFE INSURANCE CO LTD', 'Hdfc Life Insurance'],
    ['ACH-DR-TATA CAPITAL PRIVATE LIMITED-X', 'Tata Capital'],
    ['ACH-DR-12345', null],
    ['no ach here', null],
  ])('%j → %j', (text, want) => expect(extractAchPayee(text)).toBe(want));
});
