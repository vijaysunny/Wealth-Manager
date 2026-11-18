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
  expect(captureSignature({ bankName: 'Axis Bank', last4: '0973' })).toBe('Bank Account|axis bank|0973|');
});
