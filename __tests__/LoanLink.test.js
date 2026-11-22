/** Phase 13 C6: linking a transaction to a loan; C4 detection is added to this file later. */
import {
  resplitForAmount,
  LINK_KINDS,
  splitGap,
  linkError,
  applyLink,
  removeLink,
  canLink,
  candidatesFor,
  spendAmount,
  emiSuggestions,
  loanFromDebits,
  autoLinks,
  missedEmi,
  missedKey,
  isMandateDebit,
} from '../utils/LoanLink';
import { applyToAccounts, reverseOnAccounts } from '../utils/BalanceService';
import { calculateOutstandingBalance } from '../utils/LoanCalculator';

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

// ── C4: bank EMIs ──
const ach = (id, m, d, amount, extra = {}) => ({
  id,
  type: 'expense',
  amount,
  merchant: 'Bajaj Finance',
  title: 'Bajaj Finance',
  category: 'Loan/EMI',
  channel: 'ACH',
  accountId: 'axis',
  smsId: `s-${id}`,
  fullDate: iso(m, d),
  ...extra,
});

test('detect: monthly ACH from one payee; different amounts are separate loans; one-offs ignored', () => {
  const txs = [
    ach('b1', 11, 7, 538),
    ach('b2', 7, 7, 160),
    ach('one', 10, 3, 999, { merchant: 'Lone Lender', title: 'Lone Lender' }),
    ach('upi', 11, 7, 538, { channel: 'UPI', merchant: 'Shop', title: 'Shop' }),
    ach('card', 11, 7, 538, { accountId: 'ac', merchant: 'Card co', title: 'Card co' }),
  ];
  const s = emiSuggestions(txs, accounts);
  expect(s).toHaveLength(1);
  expect(s[0]).toMatchObject({ payee: 'Bajaj Finance', key: 'bajaj finance', mixed: true });
  expect(s[0].debits.map((x) => x.id)).toEqual(['b1', 'b2']);
  expect(s[0].loans.map((l) => [l.amount, l.debitDay, l.accountId, l.debits.length])).toEqual([
    [538, 7, 'axis', 1],
    [160, 7, 'axis', 1],
  ]);
  // "Not a loan" dismisses one amount; the other stays
  const left = emiSuggestions(txs, accounts, ['bajaj finance|538']);
  expect(left[0].loans.map((l) => l.amount)).toEqual([160]);
  expect(emiSuggestions(txs, accounts, ['bajaj finance|538', 'bajaj finance|160'])).toEqual([]);
  // not monthly: two debits 10 days apart, or on different days of the month
  expect(emiSuggestions([ach('x1', 11, 7, 538), ach('x2', 11, 17, 538)], accounts)).toEqual([]);
  expect(emiSuggestions([ach('y1', 9, 7, 538), ach('y2', 11, 20, 538)], accounts)).toEqual([]);
  // month-end days wrap (30 Sep ≈ 1 Nov); "EMI" in the name counts as a mandate
  expect(
    emiSuggestions(
      [
        ach('z1', 9, 30, 500, { channel: null, merchant: 'HDFC EMI', title: 'HDFC EMI' }),
        ach('z2', 11, 1, 500, { channel: null, merchant: 'HDFC EMI', title: 'HDFC EMI' }),
      ],
      accounts
    )
  ).toHaveLength(1);
  expect(emiSuggestions()).toEqual([]);
});

test('a new loan from the debits: no-cost Bajaj ₹538 with 8 left owes ₹4,304', () => {
  const v = loanFromDebits(
    {
      payee: 'Bajaj Finance',
      emi: 538,
      left: 8,
      rate: 0,
      debitDay: 7,
      accountId: 'axis',
      debits: [ach('b1', 11, 7, 538)],
    },
    new Date(2026, 10, 22)
  );
  expect(v).toMatchObject({
    kind: 'personal',
    name: 'Bajaj Finance',
    months: 9,
    rate: 0,
    emi: 538,
    payFromId: 'axis',
    amount: 4842,
  });
  expect(v.firstEmi).toEqual(new Date(2026, 10, 7));
  const r = loanFromDebits(
    {
      payee: 'X',
      emi: 9414.69,
      left: 18,
      rate: 12,
      debitDay: 7,
      accountId: 'axis',
      debits: [ach('p', 10, 7, 9414.69), ach('q', 11, 7, 9414.69)],
    },
    new Date(2026, 10, 22)
  );
  expect(r.months).toBe(20);
  expect(r.firstEmi).toEqual(new Date(2026, 9, 7));
  // what is owed after the 2 debits seen = the present value of the 18 EMIs left (₹1,54,384.71 in 16-loan-detail.png)
  const built = {
    originalAmount: r.amount,
    emiAmount: r.emi,
    interestRate: 12,
    tenure: r.months,
    firstEmiDate: r.firstEmi.toISOString(),
  };
  expect(Math.abs(calculateOutstandingBalance(built, new Date(2026, 10, 22)) - 154384.71)).toBeLessThan(1);
  // no debits seen: the first EMI is the next debit day
  expect(
    loanFromDebits(
      { payee: 'Y', emi: 100, left: 3, rate: 0, debitDay: 30, debits: [] },
      new Date(2026, 1, 10)
    ).firstEmi
  ).toEqual(new Date(2026, 1, 28));
});

test('auto-link rule: later debits from the same payee and amount (±1 %) link as the next EMI', () => {
  const bajaj = {
    id: 'bj',
    type: 'Loan',
    name: 'Bajaj Finance',
    originalAmount: 6456,
    emiAmount: 538,
    tenure: 12,
    interestRate: 0,
    loanType: 'No Cost EMI',
    firstEmiDate: iso(8, 7),
    match: { payee: 'bajaj finance', amount: 538 },
  };
  const linked = applyLink(
    ach('nov', 11, 7, 538),
    { loanId: 'bj', kind: 'emi', emiNo: 4, principal: 538, interest: 0, source: 'sms' },
    bajaj
  );
  const txs = [
    linked,
    ach('dec', 12, 7, 538),
    ach('jan', 1, 7, 539, { fullDate: new Date(2027, 0, 7, 12).toISOString() }),
    ach('other', 12, 7, 160),
    ach('old', 10, 7, 538),
  ];
  const out = autoLinks(
    [bajaj, { ...bajaj, id: 'nomatch', match: undefined }, { ...bajaj, id: 'shut', status: 'closed' }],
    txs
  );
  expect(out.map((o) => [o.txId, o.link.emiNo, o.link.principal])).toEqual([
    ['dec', 5, 538],
    ['jan', 6, 538],
  ]);
  expect(out[0].link).toMatchObject({ loanId: 'bj', kind: 'emi', source: 'sms' });
  expect(autoLinks()).toEqual([]);
});

test('missed EMI: nothing linked by debit day + 2 → once a month; not for card EMIs or finished loans', () => {
  const bajaj = {
    id: 'bj',
    type: 'Loan',
    name: 'Bajaj Finance',
    debitDay: 7,
    emiAmount: 538,
    tenure: 12,
    originalAmount: 6456,
    interestRate: 0,
    firstEmiDate: iso(8, 7),
    match: { payee: 'bajaj finance', amount: 538 },
  };
  const paid = applyLink(
    ach('n', 11, 7, 538),
    { loanId: 'bj', kind: 'emi', emiNo: 4, principal: 538, interest: 0 },
    bajaj
  );
  expect(missedEmi(bajaj, [], new Date(2026, 10, 9, 12))).toBe(false); // still within 2 days
  expect(missedEmi(bajaj, [], new Date(2026, 10, 10, 12))).toBe(true);
  expect(missedEmi(bajaj, [paid], new Date(2026, 10, 10, 12))).toBe(false);
  expect(missedEmi({ ...bajaj, match: undefined }, [], new Date(2026, 10, 10, 12))).toBe(false);
  expect(missedEmi({ ...bajaj, includedInCard: true }, [], new Date(2026, 10, 10, 12))).toBe(false);
  expect(missedEmi({ ...bajaj, status: 'closed' }, [], new Date(2026, 10, 10, 12))).toBe(false);
  expect(missedEmi(bajaj, [], new Date(2026, 6, 10, 12))).toBe(false); // before the first EMI
  expect(missedEmi(bajaj, [], new Date(2027, 8, 10, 12))).toBe(false); // all 12 done
  expect(missedEmi({ ...bajaj, debitDay: undefined }, [], new Date(2026, 10, 10, 12))).toBe(true); // day from the first EMI
  expect(missedKey(bajaj, new Date(2026, 10, 10))).toBe('loan_missed_bj_2026-11');
});

test('C4 edges: mandate check, nameless debits, default arguments, manual source, missing day', () => {
  expect(isMandateDebit(null)).toBe(false);
  expect(
    isMandateDebit(ach('a', 11, 7, 1, { channel: undefined, merchant: undefined, title: 'Car EMI' }))
  ).toBe(true);
  expect(isMandateDebit(ach('b', 11, 7, 1, { loanLink: { loanId: 'x' } }))).toBe(false);
  // linked debits still count towards "monthly", but only unlinked ones are offered
  const linkedOld = applyLink(
    ach('o', 10, 7, 538),
    { loanId: 'bj', kind: 'emi', principal: 538, interest: 0 },
    {}
  );
  const s = emiSuggestions([linkedOld, ach('n', 11, 7, 538, { merchant: undefined })], accounts);
  expect(s[0].debits.map((x) => x.id)).toEqual(['n']);
  expect(s[0].payee).toBe('Bajaj Finance');
  expect(
    emiSuggestions(
      [ach('p', 10, 7, 5, { merchant: '', title: '' }), ach('q', 11, 7, 5, { merchant: '', title: '' })],
      accounts
    )
  ).toEqual([]);
  // manual debits auto-link with source manual
  const bj = {
    id: 'bj',
    originalAmount: 1000,
    emiAmount: 100,
    tenure: 10,
    interestRate: 0,
    firstEmiDate: iso(10, 7),
    match: { payee: 'bajaj finance', amount: 100 },
  };
  expect(autoLinks([bj], [ach('m', 11, 7, 100, { smsId: undefined })])[0].link.source).toBe('manual');
  // a loan with no dates has no debit day → never "missed"
  expect(missedEmi({ id: 'z', match: { payee: 'x', amount: 1 } }, [], new Date(2026, 10, 20))).toBe(false);
  expect(missedEmi(null)).toBe(false);
  expect(missedKey({ id: 'k' })).toMatch(/^loan_missed_k_\d{4}-\d{2}$/);
  expect(
    loanFromDebits({ payee: 'D', emi: 10, left: 1, rate: 0, debitDay: 5 }).months
  ).toBeGreaterThanOrEqual(1);
});

test('review fix: an edited amount keeps the split adding up', () => {
  const emi = { loanId: 'l', kind: 'emi', emiNo: 3, principal: 8000, interest: 2000 };
  expect(resplitForAmount(emi, 9500)).toMatchObject({ principal: 7500, interest: 2000, emiNo: 3 });
  expect(resplitForAmount(emi, 1500)).toMatchObject({ principal: 0, interest: 1500 });
  expect(resplitForAmount({ kind: 'prepayment', principal: 5000, interest: 0 }, 6000)).toMatchObject({
    principal: 6000,
    interest: 0,
  });
  expect(resplitForAmount({ kind: 'charges', principal: 0, interest: 500 }, 590)).toMatchObject({
    principal: 0,
    interest: 590,
  });
  const d = { kind: 'disbursal', principal: 0, interest: 0 };
  expect(resplitForAmount(d, 1)).toBe(d);
  expect(resplitForAmount(undefined, 1)).toBeUndefined();
});
