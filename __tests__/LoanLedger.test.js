/**
 * Phase 13 C6: the loan ledger. Design numbers (16-loan-detail.png): ₹2,00,000 at 12 % for 24
 * months, first EMI 7 Jun 2026 → EMI ₹9,414.69; EMI 6 = ₹7,792.91 + ₹1,621.78; after 6 EMIs
 * ₹1,54,384.71 owed; ₹10,000 prepaid on 15 Nov → ₹1,44,384.71.
 */
import {
  ledger,
  loanOwed,
  groupAssumed,
  fyOf,
  defaultSplit,
  monthsToClear,
  hasLedgerData,
} from '../utils/LoanLedger';
import { emiFor } from '../utils/LoanCalculator';

const d = (y, m, day, h = 12) => new Date(y, m - 1, day, h);
const iso = (y, m, day) => d(y, m, day).toISOString();
const loan = {
  id: 'pl',
  type: 'Loan',
  name: 'Personal loan',
  originalAmount: 200000,
  interestRate: 12,
  tenure: 24,
  emiAmount: 9414.69,
  loanType: 'Reducing',
  firstEmiDate: d(2026, 6, 7, 0).toISOString(),
};
const pay = (id, date, amount, link) => ({
  id,
  type: 'expense',
  amount,
  accountId: 'axis',
  fullDate: date,
  loanLink: { loanId: 'pl', source: 'manual', ...link },
});
const emi5 = pay('e5', iso(2026, 10, 7), 9414.69, {
  kind: 'emi',
  emiNo: 5,
  principal: 7715.76,
  interest: 1698.93,
});
const emi6 = pay('e6', iso(2026, 11, 7), 9414.69, {
  kind: 'emi',
  emiNo: 6,
  principal: 7792.91,
  interest: 1621.78,
});
const prepay = (mode = 'endSooner') =>
  pay('pp', iso(2026, 11, 15), 10000, { kind: 'prepayment', principal: 10000, interest: 0, mode });
const NOW = d(2026, 11, 22);

test('EMI formula and the schedule-only ledger: 6 assumed EMIs, ₹1,54,384.71 owed', () => {
  expect(emiFor(200000, 12, 24)).toBe(9414.69);
  const l = ledger(loan, [], d(2026, 11, 14));
  expect(l.paidCount).toBe(6);
  expect(l.principalOwed).toBe(154384.71);
  expect(l.rows).toHaveLength(6);
  expect(l.rows.every((r) => r.assumed)).toBe(true);
  expect(l.rows[5]).toMatchObject({
    kind: 'emi',
    emiNo: 6,
    principal: 7792.91,
    interest: 1621.78,
    amount: 9414.69,
  });
  expect(l.rows[4]).toMatchObject({ emiNo: 5, principal: 7715.76, interest: 1698.93 });
  expect(l.monthsLeft).toBe(18);
  expect(l.endDate).toEqual(d(2028, 5, 7, 0));
  expect(l.fromLinks).toBe(false);
});

test('design: EMIs 5–6 from SMS + ₹10,000 prepaid (end sooner) → ₹1,44,384.71; FY; next EMI; 17 left, ends Apr 2028', () => {
  const l = ledger(loan, [emi5, emi6, prepay()], NOW);
  expect(l.principalOwed).toBe(144384.71);
  expect(l.paidCount).toBe(6);
  expect(l.fy).toEqual({
    start: d(2026, 4, 1, 0),
    end: d(2027, 3, 31, 0),
    principal: 55615.29,
    interest: 10872.85,
  });
  expect(l.nextEmi).toMatchObject({
    no: 7,
    date: d(2026, 12, 7, 0),
    amount: 9414.69,
    principal: 7970.84,
    interest: 1443.85,
  });
  expect(l.monthsLeft).toBe(17);
  expect(l.tenureNow).toBe(23);
  expect(l.endDate.getFullYear()).toBe(2028);
  expect(l.endDate.getMonth()).toBe(3); // April
  expect(l.fromLinks).toBe(true);
  const pp = l.rows.find((r) => r.kind === 'prepayment');
  expect(pp).toMatchObject({
    amount: 10000,
    principal: 10000,
    interest: 0,
    txId: 'pp',
    note: 'tenure cut by 1 EMI',
  });
  expect(l.rows.filter((r) => r.assumed).map((r) => r.emiNo)).toEqual([1, 2, 3, 4]);
  expect(l.rows.find((r) => r.emiNo === 6)).toMatchObject({ assumed: false, txId: 'e6' });
});

test('Reduce EMI: a new EMI over the same 18 months', () => {
  const l = ledger(loan, [emi5, emi6, prepay('reduceEmi')], NOW);
  expect(l.principalOwed).toBe(144384.71);
  expect(l.emi).toBe(emiFor(144384.71, 12, 18));
  expect(l.monthsLeft).toBe(18);
  expect(l.rows.find((r) => r.kind === 'prepayment').note).toBe('EMI now ₹8,804.88');
  expect(l.nextEmi.amount).toBe(l.emi);
});

test('a manual prepayment stored on the loan works like a linked one', () => {
  const withManual = {
    ...loan,
    prepayments: [{ id: 'm1', date: iso(2026, 11, 15), amount: 10000, mode: 'endSooner' }],
  };
  const l = ledger(withManual, [], NOW);
  expect(l.principalOwed).toBe(144384.71);
  expect(l.rows.find((r) => r.kind === 'prepayment')).toMatchObject({ source: 'manual', prepaymentId: 'm1' });
  expect(hasLedgerData(withManual, [])).toBe(true);
  expect(hasLedgerData(loan, [])).toBe(false);
  expect(hasLedgerData(loan, [emi5])).toBe(true);
});

test('an assumed EMI replaced by a later link is counted once, with the lender split', () => {
  const owner = pay('x6', iso(2026, 11, 8), 9414.69, {
    kind: 'emi',
    emiNo: 6,
    principal: 7800,
    interest: 1614.69,
  });
  const l = ledger(loan, [owner], d(2026, 11, 14));
  expect(l.rows.filter((r) => r.emiNo === 6)).toHaveLength(1);
  expect(l.principalOwed).toBe(154384.71 - (7800 - 7792.91));
  // a link to a loan that isn't this one, or after asOf, is ignored
  const other = { ...owner, id: 'o', loanLink: { ...owner.loanLink, loanId: 'other' } };
  const later = pay('late', iso(2026, 12, 7), 9414.69, { kind: 'emi', emiNo: 7, principal: 1, interest: 1 });
  expect(ledger(loan, [other, later, null, { id: 'n' }], d(2026, 11, 14)).principalOwed).toBe(154384.71);
});

test('an EMI paid early (linked before its date) counts at once', () => {
  const early = pay('e7', iso(2026, 12, 1), 9414.69, {
    kind: 'emi',
    emiNo: 7,
    principal: 7956.53,
    interest: 1458.16,
  });
  const l = ledger(loan, [emi6, early], d(2026, 12, 2));
  expect(l.paidCount).toBe(7);
  expect(l.nextEmi.no).toBe(8);
});

test('fees leave what you owe unchanged but count as interest & charges this FY', () => {
  const fee = pay('f', iso(2026, 11, 10), 590, { kind: 'charges', principal: 0, interest: 590 });
  const base = ledger(loan, [emi5, emi6], NOW);
  const l = ledger(loan, [emi5, emi6, fee], NOW);
  expect(l.principalOwed).toBe(base.principalOwed);
  expect(l.fy.interest).toBe(Math.round((base.fy.interest + 590) * 100) / 100);
  expect(l.rows.find((r) => r.kind === 'charges')).toMatchObject({ principal: 0, interest: 590 });
});

test('foreclosure clears the loan; disbursal is only a row; FY skips last year', () => {
  const close = pay('fc', iso(2026, 11, 20), 155000, {
    kind: 'foreclosure',
    principal: 154384.71,
    interest: 615.29,
  });
  const l = ledger(loan, [close], NOW);
  expect(l).toMatchObject({ principalOwed: 0, closed: true, nextEmi: null, monthsLeft: 0 });
  const got = {
    ...pay('d', iso(2026, 5, 20), 200000, { kind: 'disbursal', principal: 0, interest: 0 }),
    type: 'transfer',
  };
  const old = pay('old', iso(2026, 3, 20), 500, { kind: 'charges', principal: 0, interest: 500 });
  const l2 = ledger(loan, [got, old], NOW);
  expect(l2.principalOwed).toBe(ledger(loan, [], NOW).principalOwed);
  expect(l2.rows.find((r) => r.kind === 'disbursal')).toMatchObject({ amount: 200000, principal: 0 });
  expect(l2.fy.interest).toBe(ledger(loan, [], NOW).fy.interest);
});

test('no-cost EMI: no interest; flat rate: equal interest each month', () => {
  const nc = {
    id: 'nc',
    originalAmount: 6456,
    emiAmount: 538,
    tenure: 12,
    interestRate: 0,
    loanType: 'No Cost EMI',
    firstEmiDate: iso(2026, 8, 7),
  };
  const l = ledger(nc, [], NOW);
  expect(l).toMatchObject({ principalOwed: 4304, paidCount: 4, monthsLeft: 8 });
  expect(l.rows[0]).toMatchObject({ principal: 538, interest: 0 });
  expect(l.nextEmi).toMatchObject({ principal: 538, interest: 0 });
  const flat = {
    id: 'f',
    originalAmount: 12000,
    emiAmount: 1100,
    tenure: 12,
    interestRate: 10,
    loanType: 'Flat Rate',
    firstEmiDate: iso(2026, 8, 7),
  };
  expect(ledger(flat, [], NOW).rows[0]).toMatchObject({ principal: 1000, interest: 100 });
  expect(ledger(flat, [], NOW).principalOwed).toBe(8000);
});

test('the last EMI clears the balance; a finished loan has no next EMI', () => {
  const l = ledger(loan, [], d(2028, 6, 1));
  expect(l).toMatchObject({ principalOwed: 0, paidCount: 24, nextEmi: null, monthsLeft: 0 });
  expect(l.rows[23].principal).toBeGreaterThan(9000);
  expect(ledger({ ...loan, status: 'closed' }, [], NOW).principalOwed).toBe(0);
  // without enough data: the stored balance, no rows
  expect(ledger({ id: 'z', type: 'Loan', balance: 700 }, [], NOW)).toMatchObject({
    principalOwed: 700,
    rows: [],
    nextEmi: null,
  });
});

test('loanOwed: old rule without links, the ledger with them', () => {
  expect(loanOwed(loan, [], d(2026, 11, 14))).toBe(154384.71);
  expect(loanOwed(loan, [emi5, emi6, prepay()], NOW)).toBe(144384.71);
  expect(loanOwed({ ...loan, status: 'closed' }, [emi5], NOW)).toBe(0);
});

test('assumed EMIs are grouped for the payments list', () => {
  const l = ledger(loan, [emi5, emi6, prepay()], NOW);
  const g = groupAssumed([...l.rows].reverse());
  expect(g.map((x) => x.type)).toEqual(['row', 'row', 'row', 'assumed']);
  expect(g[3]).toMatchObject({
    firstNo: 1,
    lastNo: 4,
    from: d(2026, 6, 7, 0),
    to: d(2026, 9, 7, 0),
    amount: 37658.76,
  });
  expect(groupAssumed([])).toEqual([]);
});

test('default split per kind', () => {
  const txs = [emi5, emi6, prepay()];
  expect(defaultSplit(loan, txs, 'emi', 9414.69, d(2026, 12, 7))).toEqual({
    emiNo: 7,
    principal: 7970.84,
    interest: 1443.85,
    note: 'EMI 7 of 23 · from the schedule, edit to match your lender',
  });
  // EMI + bounce charge: the extra goes to interest & charges
  expect(defaultSplit(loan, txs, 'emi', 10004.69, d(2026, 12, 7))).toMatchObject({
    principal: 7970.84,
    interest: 2033.85,
  });
  expect(defaultSplit(loan, txs, 'prepayment', 5000, NOW)).toMatchObject({ principal: 5000, interest: 0 });
  expect(defaultSplit(loan, txs, 'charges', 590, NOW)).toMatchObject({ principal: 0, interest: 590 });
  expect(defaultSplit(loan, txs, 'foreclosure', 150000, NOW)).toMatchObject({
    principal: 144384.71,
    interest: 5615.29,
  });
  expect(defaultSplit(loan, txs, 'disbursal', 200000, NOW)).toMatchObject({ principal: 0, interest: 0 });
  // editing an existing EMI link keeps its number, not the next one
  expect(defaultSplit(loan, txs, 'emi', 9414.69, NOW, emi6).emiNo).toBe(6);
  // a finished loan: everything is principal (nothing scheduled)
  expect(defaultSplit({ ...loan, status: 'closed' }, [], 'emi', 100, NOW)).toMatchObject({
    principal: 100,
    interest: 0,
  });
});

test('fyOf and monthsToClear', () => {
  expect(fyOf(d(2027, 3, 31))).toEqual({ start: d(2026, 4, 1, 0), end: d(2027, 3, 31, 0) });
  expect(fyOf(d(2027, 4, 1))).toEqual({ start: d(2027, 4, 1, 0), end: d(2028, 3, 31, 0) });
  expect(monthsToClear(144384.71, 12, 9414.69)).toBe(17);
  expect(monthsToClear(1000, 0, 300)).toBe(4);
  expect(monthsToClear(0, 12, 100)).toBe(0);
  expect(monthsToClear(100000, 12, 500)).toBe(Infinity); // EMI below the interest
});

test('edges: source from SMS, prepayment that clears the loan, no-cost and flat prepayments, defaults', () => {
  const sms = { ...emi6, smsId: 'sms:1' };
  const tagged = { ...emi5, tags: ['auto-sms'] };
  const rows = ledger(loan, [sms, tagged], NOW).rows;
  expect(rows.find((r) => r.emiNo === 6).source).toBe('sms');
  expect(rows.find((r) => r.emiNo === 5).source).toBe('sms');
  expect(rows.find((r) => r.emiNo === 1).source).toBe('schedule');
  // a prepayment larger than what is owed closes the loan
  const all = pay('all', iso(2026, 11, 15), 200000, { kind: 'prepayment', principal: 200000, interest: 0 });
  expect(ledger(loan, [all], NOW)).toMatchObject({ principalOwed: 0, closed: true, nextEmi: null });
  // no-cost: end sooner cuts months; reduce EMI spreads the rest
  const nc = {
    id: 'pl',
    originalAmount: 6456,
    emiAmount: 538,
    tenure: 12,
    interestRate: 0,
    loanType: 'No Cost EMI',
    firstEmiDate: iso(2026, 8, 7),
  };
  const ncPre = (mode) =>
    pay('n', iso(2026, 11, 20), 1076, { kind: 'prepayment', principal: 1076, interest: 0, mode });
  expect(ledger(nc, [ncPre()], NOW)).toMatchObject({ principalOwed: 3228, monthsLeft: 6 });
  expect(ledger(nc, [ncPre('reduceEmi')], NOW)).toMatchObject({
    principalOwed: 3228,
    monthsLeft: 8,
    emi: 403.5,
  });
  const flat = {
    id: 'pl',
    originalAmount: 12000,
    emiAmount: 1100,
    tenure: 12,
    interestRate: 10,
    loanType: 'Flat Rate',
    firstEmiDate: iso(2026, 8, 7),
  };
  const fPre = pay('f', iso(2026, 11, 20), 2000, {
    kind: 'prepayment',
    principal: 2000,
    interest: 0,
    mode: 'reduceEmi',
  });
  expect(ledger(flat, [fPre], NOW)).toMatchObject({ principalOwed: 6000, monthsLeft: 8, emi: 850 });
  // no tenure: runs until cleared; a closed loan without data owes 0
  const open = ledger({ ...loan, tenure: undefined }, [], NOW);
  expect(open.paidCount).toBe(6);
  expect(ledger({ id: 'z', status: 'closed', balance: 5 }, [], NOW).principalOwed).toBe(0);
  expect(monthsToClear(100, 0, 0)).toBe(Infinity);
  // defaults
  expect(ledger(loan).paidCount).toBeGreaterThan(0);
  expect(fyOf().start.getMonth()).toBe(3);
  expect(hasLedgerData(loan)).toBe(false);
  expect(loanOwed(loan)).toBeGreaterThanOrEqual(0);
});
