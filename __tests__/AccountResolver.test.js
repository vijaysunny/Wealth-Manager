import {
  bankTokens,
  last4Of,
  resolveAccount,
  resolveCaptures,
  suggestedAccountFor,
  captureSignature,
} from '../utils/AccountResolver';

const ids = () => {
  let n = 0;
  return () => `new${++n}`;
};

test('bank tokens', () => {
  expect(bankTokens('SBI')).toEqual(['sbi', 'state bank']);
  expect(bankTokens('Equitas Small Finance Bank')).toEqual(['equitas']);
  expect(bankTokens('Bank of Maharashtra')).toEqual(['maharashtra']);
  expect(bankTokens('Unknown Bank')).toEqual([]);
});

test('last4Of reads the field or a masked name', () => {
  expect(last4Of({ last4: '0973' })).toBe('0973');
  expect(last4Of({ name: 'Axis ••0973' })).toBe('0973');
  expect(last4Of({ name: 'HDFC XX4321' })).toBe('4321');
  expect(last4Of({ name: 'SBI 2024 goals' })).toBeNull();
});

test('"State Bank" account name matches an SBI message; word boundaries respected', () => {
  const accts = [
    { id: 1, name: 'State Bank savings', type: 'Bank Account' },
    { id: 2, name: 'Taxis fund', type: 'Bank Account' },
  ];
  expect(resolveAccount(accts, { bankName: 'SBI', accountType: 'Bank Account' }).account.id).toBe(1);
  expect(resolveAccount(accts, { bankName: 'Axis Bank', accountType: 'Bank Account' }).status).toBe('none');
});

test('3-digit masks match 4-digit stored digits', () => {
  const accts = [{ id: 1, name: 'ICICI', type: 'Bank Account', last4: '0123' }];
  expect(resolveAccount(accts, { bankName: 'ICICI Bank', last4: '123' }).status).toBe('matched');
});

test('wallet-perspective spend creates the wallet once and reuses it', () => {
  const spend = (n) => ({
    id: n,
    smsId: `s${n}`,
    type: 'expense',
    amount: 10,
    accountType: 'Wallet',
    walletProvider: 'PhonePe',
    walletSubType: 'UPI Lite',
    fullDate: `2026-11-0${n}T10:00:00Z`,
  });
  const r = resolveCaptures([], [spend(2), spend(1)], { newId: ids() });
  expect(r.accounts).toHaveLength(1);
  expect(r.accounts[0]).toMatchObject({ name: 'PhonePe UPI Lite', provider: 'PhonePe', type: 'Wallet' });
  expect(r.txs.map((t) => t.accountId)).toEqual(['new1', 'new1']);
});

test('a PhonePe top-up never invents "PhonePe UPI Lite" next to a generic "UPI Lite" wallet', () => {
  const accts = [
    { id: 'b', name: 'Axis Bank', type: 'Bank Account' },
    { id: 'w', name: 'UPI Lite', type: 'Wallet', subType: 'UPI Lite' },
  ];
  const tx = {
    id: 1,
    smsId: 's',
    type: 'transfer',
    transferKind: 'wallet_topup',
    flow: 'out',
    amount: 5,
    bankName: 'Axis Bank',
    accountType: 'Bank Account',
    walletProvider: 'PhonePe',
    walletSubType: 'UPI Lite',
    fullDate: '2026-11-01T00:00:00Z',
  };
  const r = resolveCaptures(accts, [tx], { newId: ids() });
  expect(r.accounts).toHaveLength(2);
  expect(r.txs[0]).toMatchObject({ accountId: 'b', toAccountId: 'w' });
});

test('withdraw to bank: wallet → bank; balance belongs to the bank', () => {
  const accts = [
    { id: 'b', name: 'Axis Bank', type: 'Bank Account' },
    { id: 'w', name: 'UPI Lite', type: 'Wallet', subType: 'UPI Lite' },
  ];
  const tx = {
    id: 1,
    smsId: 's',
    type: 'transfer',
    transferKind: 'wallet_withdraw',
    flow: 'in',
    amount: 120,
    bankName: 'Axis Bank',
    accountType: 'Bank Account',
    walletSubType: 'UPI Lite',
    balanceBelongsTo: 'bank',
    extractedBalance: 999,
    fullDate: '2026-11-01T00:00:00Z',
  };
  const out = resolveCaptures(accts, [tx], { newId: ids() }).txs[0];
  expect(out).toMatchObject({ accountId: 'w', toAccountId: 'b', balanceAccountId: 'b' });
});

test('several matching wallets and no provider → bank leg only, pick_wallet review', () => {
  const accts = [
    { id: 'b', name: 'Axis Bank', type: 'Bank Account' },
    { id: 'w1', name: 'PhonePe UPI Lite', type: 'Wallet', subType: 'UPI Lite', provider: 'PhonePe' },
    { id: 'w2', name: 'Paytm UPI Lite', type: 'Wallet', subType: 'UPI Lite', provider: 'Paytm' },
  ];
  const tx = {
    id: 1,
    smsId: 's',
    type: 'transfer',
    transferKind: 'wallet_topup',
    flow: 'out',
    amount: 5,
    bankName: 'Axis Bank',
    accountType: 'Bank Account',
    walletSubType: 'UPI Lite',
    fullDate: '2026-11-01T00:00:00Z',
  };
  const out = resolveCaptures(accts, [tx], { newId: ids() }).txs[0];
  expect(out).toMatchObject({ accountId: 'b', reviewReason: 'pick_wallet' });
  expect(out.toAccountId).toBeUndefined();
});

test('non-captures and already-assigned rows are left alone', () => {
  const manual = { id: 1, type: 'expense', amount: 1, account: 'Axis Bank' };
  const assigned = { id: 2, smsId: 's', accountId: 'x', type: 'expense', amount: 1 };
  expect(resolveCaptures([], [manual, assigned]).txs).toEqual([manual, assigned]);
});

test('suggestion and signature', () => {
  expect(suggestedAccountFor({ bankName: 'SBI', accountType: 'Credit Card', last4: '1987' }).name).toBe(
    'SBI Credit Card ••1987'
  );
  expect(captureSignature({ bankName: 'Axis Bank', last4: '0973' })).toBe('Bank Account|axis bank|0973||');
});

describe('A11: debit cards', () => {
  const R = require('../utils/AccountResolver');
  const savings = { id: 'axis', name: 'Axis Bank ••0973', type: 'Bank Account', last4: '0973', balance: 0 };
  const card = { id: 'axiscc', name: 'Axis Card', type: 'Credit Card', last4: '4821', balance: 0 };
  const dc = (o = {}) => ({
    smsId: 's1',
    type: 'expense',
    amount: 450,
    accountType: 'Bank Account',
    bankName: 'Axis Bank',
    last4: null,
    cardLast4: '4821',
    fullDate: '2026-11-17T00:00:00Z',
    ...o,
  });

  test('a card in debitCards matches the savings account', () => {
    const r = R.resolveAccount([{ ...savings, debitCards: ['4821'] }, card], dc());
    expect(r).toMatchObject({ status: 'matched', account: { id: 'axis' } });
  });

  test('an unknown card with one account of that bank → link_debit_card with the candidate', () => {
    const r = R.resolveAccount([savings], dc());
    expect(r.status).toBe('link_debit_card');
    expect(r.candidates.map((a) => a.id)).toEqual(['axis']);
    const { tx } = R.resolveCapture([savings], dc(), { newId: () => 'n' });
    expect(tx).toMatchObject({
      accountUnresolved: true,
      reviewReason: 'link_debit_card',
      accountCandidates: ['axis'],
    });
  });

  test('several accounts of that bank → still asks, with all of them', () => {
    const other = { id: 'axis2', name: 'Axis Joint', type: 'Bank Account', balance: 0 };
    const r = R.resolveAccount([savings, other], dc());
    expect(r.status).toBe('link_debit_card');
    expect(r.candidates).toHaveLength(2);
  });

  test('no account of that bank → new_account suggesting a bank account that knows the card', () => {
    const { tx } = R.resolveCapture([], dc(), { newId: () => 'n' });
    expect(tx.reviewReason).toBe('new_account');
    expect(tx.suggestedAccount).toMatchObject({ type: 'Bank Account', last4: null, debitCards: ['4821'] });
  });

  test('a credit card with the same digits never matches a bank account, and vice versa', () => {
    expect(R.resolveAccount([savings, card], dc()).status).toBe('link_debit_card');
    const cc = { ...dc(), accountType: 'Credit Card', last4: '4821', cardLast4: '4821' };
    expect(R.resolveAccount([{ ...savings, debitCards: ['4821'] }, card], cc)).toMatchObject({
      status: 'matched',
      account: { id: 'axiscc' },
    });
  });

  test('"A/c XX5678 … Debit Card XX9911" matches by account digits and learns the card', () => {
    const sbi = { id: 'sbi', name: 'SBI ••5678', type: 'Bank Account', last4: '5678', balance: 0 };
    const tx = dc({ bankName: 'SBI', last4: '5678', cardLast4: '9911' });
    const { accounts, tx: out } = R.resolveCapture([sbi], tx, { newId: () => 'n' });
    expect(out.accountId).toBe('sbi');
    expect(accounts[0].debitCards).toEqual(['9911']);
  });

  test('captureSignature separates debit cards of one bank, but not account-digit captures', () => {
    expect(R.captureSignature(dc())).not.toBe(R.captureSignature(dc({ cardLast4: '1111' })));
    expect(R.captureSignature(dc({ last4: '0973', cardLast4: '1' }))).toBe(
      R.captureSignature(dc({ last4: '0973', cardLast4: '2' }))
    );
  });
});
