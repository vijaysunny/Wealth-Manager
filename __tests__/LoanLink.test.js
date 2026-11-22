/** Phase 13 C6: linking a transaction to a loan; C4 detection is added to this file later. */
import {
  LINK_KINDS,
  splitGap,
  linkError,
  applyLink,
  removeLink,
  canLink,
  candidatesFor,
  spendAmount,
} from '../utils/LoanLink';
import { applyToAccounts, reverseOnAccounts } from '../utils/BalanceService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const iso = (m, d) => new Date(2026, m - 1, d, 12).toISOString();
const loan = {
  id: 'pl',
  type: 'Loan',
  name: 'Personal loan',
  originalAmount: 200000,
  interestRate: 12,
  tenure: 24,
  emiAmount: 9414.69,
  firstEmiDate: new Date(2026, 5, 7).toISOString(),
};
const debit = {
  id: 'd6',
  type: 'expense',
  amount: 9414.69,
  title: 'NACH Personal loan',
  merchant: 'NACH Personal loan',
  category: 'Bills',
  accountId: 'axis',
  account: 'Axis Bank',
  fullDate: iso(11, 7),
};
const accounts = { axis: { id: 'axis', type: 'Bank Account' }, ac: { id: 'ac', type: 'Credit Card' } };

test('kinds in design order', () => {
  expect(LINK_KINDS.map((k) => k.label)).toEqual([
    'EMI',
    'Prepayment',
    'Fee / penalty',
    'Foreclosure',
    'Loan received',
  ]);
});

test('the split must add up to the amount', () => {
  expect(splitGap(9414.69, 7792.91, 1621.78)).toBe(0);
  expect(splitGap(9414.69, 7792.91, 1600)).toBe(21.78);
  const base = { amount: 9414.69, principal: 7792.91, interest: 1621.78, kind: 'emi', txType: 'expense' };
  expect(linkError(base)).toBeNull();
  expect(linkError({ ...base, interest: 1600 })).toBe(
    'Principal and interest must add up to ₹9,414.69 (short by ₹21.78).'
  );
  expect(linkError({ ...base, interest: 1700 })).toBe(
    'Principal and interest must add up to ₹9,414.69 (over by ₹78.22).'
  );
  expect(linkError({ ...base, principal: -1, interest: 9415.69 })).toMatch(/negative/);
  expect(linkError({ ...base, kind: 'disbursal' })).toMatch(/money coming in/);
  expect(linkError({ ...base, kind: 'disbursal', txType: 'income', principal: 0, interest: 0 })).toBeNull();
  expect(linkError({ ...base, txType: 'income' })).toMatch(/Loan received/);
  expect(linkError({ ...base, loanId: null })).toBeNull();
});

test('linking keeps the amount, sets Loan/EMI and remembers what to restore; unlink restores it', () => {
  const linked = applyLink(
    debit,
    { loanId: 'pl', kind: 'emi', emiNo: 6, principal: 7792.91, interest: 1621.78 },
    loan
  );
  expect(linked).toMatchObject({
    amount: 9414.69,
    type: 'expense',
    category: 'Loan/EMI',
    loanLink: {
      loanId: 'pl',
      kind: 'emi',
      emiNo: 6,
      principal: 7792.91,
      interest: 1621.78,
      source: 'manual',
      interestOnly: false,
    },
    loanLinkPrev: { type: 'expense', category: 'Bills' },
  });
  // relinking keeps the first "previous" values
  const again = applyLink(
    linked,
    { loanId: 'pl', kind: 'prepayment', principal: 9414.69, interest: 0, mode: 'reduceEmi' },
    { ...loan, budgetMode: 'interestOnly' }
  );
  expect(again.loanLinkPrev).toEqual({ type: 'expense', category: 'Bills' });
  expect(again.loanLink).toMatchObject({ kind: 'prepayment', mode: 'reduceEmi', interestOnly: true });
  expect(again.loanLink.emiNo).toBeUndefined();
  const back = removeLink(again);
  expect(back).toMatchObject({ type: 'expense', category: 'Bills' });
  expect(back.loanLink).toBeUndefined();
  expect(back.loanLinkPrev).toBeUndefined();
  expect(removeLink(debit)).toBe(debit);
});

test('Loan received becomes a one-sided transfer in (never income); balances end the same', () => {
  const credit = {
    id: 'c',
    type: 'income',
    amount: 200000,
    category: 'Salary',
    accountId: 'axis',
    fullDate: iso(5, 20),
  };
  const linked = applyLink(credit, { loanId: 'pl', kind: 'disbursal', principal: 0, interest: 0 }, loan);
  expect(linked).toMatchObject({
    type: 'transfer',
    flow: 'in',
    transferKind: 'loan_disbursal',
    category: 'Salary',
  });
  const start = [{ id: 'axis', type: 'Bank Account', balance: 1000 }];
  const before = applyToAccounts(start, credit);
  const after = applyToAccounts(reverseOnAccounts(before, credit), linked);
  expect(after[0].balance).toBe(before[0].balance);
  const back = removeLink(linked);
  expect(back).toMatchObject({ type: 'income', category: 'Salary' });
  expect(back.flow).toBeUndefined();
  expect(back.transferKind).toBeUndefined();
});

test('which transactions can be linked', () => {
  expect(canLink(debit, accounts)).toBe(true);
  expect(canLink({ ...debit, type: 'income' }, accounts)).toBe(true);
  expect(canLink({ ...debit, accountId: 'ac' }, accounts)).toBe(false); // card spends: Track as EMI instead
  expect(canLink({ ...debit, type: 'transfer' }, accounts)).toBe(false);
  expect(canLink({ ...debit, type: 'transfer', loanLink: { loanId: 'pl' } }, accounts)).toBe(true);
  expect(canLink(null, accounts)).toBe(false);
});

test('candidates: same payee as earlier links, or ≈ EMI (±1 %) within ±5 days of an EMI date; newest first', () => {
  const prev = {
    ...applyLink(debit, { loanId: 'pl', kind: 'emi', emiNo: 6, principal: 1, interest: 9413.69 }, loan),
  };
  const txs = [
    prev,
    { ...debit, id: 'same-payee', amount: 160, fullDate: iso(11, 20) },
    { ...debit, id: 'near', merchant: 'ACH-DR', title: 'ACH-DR', amount: 9400, fullDate: iso(12, 9) },
    { ...debit, id: 'far-date', merchant: 'X', title: 'X', amount: 9414.69, fullDate: iso(11, 20) },
    { ...debit, id: 'far-amount', merchant: 'Y', title: 'Y', amount: 9000, fullDate: iso(12, 7) },
    { ...debit, id: 'card', merchant: 'Z', title: 'Z', accountId: 'ac', fullDate: iso(12, 7) },
    { ...debit, id: 'other-loan', loanLink: { loanId: 'other' }, fullDate: iso(10, 7) },
  ];
  expect(candidatesFor(loan, txs, accounts, new Date(2026, 11, 10)).map((x) => x.id)).toEqual([
    'near',
    'same-payee',
  ]);
  expect(candidatesFor(loan, txs, accounts, new Date(2026, 10, 22)).map((x) => x.id)).toEqual(['same-payee']);
  expect(candidatesFor(loan)).toEqual([]);
});

test('Interest only: principal leaves spending; full payment counts all', () => {
  const l = applyLink(
    debit,
    { loanId: 'pl', kind: 'emi', emiNo: 6, principal: 7792.91, interest: 1621.78 },
    { ...loan, budgetMode: 'interestOnly' }
  );
  expect(spendAmount(l)).toBe(1621.78);
  expect(spendAmount({ ...l, loanLink: { ...l.loanLink, interestOnly: false } })).toBe(9414.69);
  expect(spendAmount(debit)).toBe(9414.69);
  expect(spendAmount({ amount: '12.5' })).toBe(12.5);
  expect(spendAmount(null)).toBe(0);
});

test('edges: a one-sided transfer out keeps its flow; EMI without a number; no loan given; loan without EMI', () => {
  const out = { ...debit, type: 'transfer', flow: 'out', transferKind: 'cc_payment' };
  const l = applyLink(out, { loanId: 'pl', kind: 'emi', principal: 9414.69, interest: 0 });
  expect(l).toMatchObject({ type: 'expense', flow: 'out', transferKind: 'cc_payment', category: 'Loan/EMI' });
  expect(l.loanLink.emiNo).toBeUndefined();
  expect(l.loanLink.interestOnly).toBe(false);
  expect(removeLink(l)).toMatchObject({ type: 'transfer', flow: 'out', transferKind: 'cc_payment' });
  const noEmi = { ...loan, emiAmount: 0 };
  expect(candidatesFor(noEmi, [{ ...debit, id: 'x' }], accounts, new Date(2026, 10, 22))).toEqual([]);
  expect(canLink({ ...debit, accountId: undefined })).toBe(true);
});
