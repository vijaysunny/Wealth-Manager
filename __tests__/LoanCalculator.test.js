/** Phase 13 C2: EMI schedule by date, the EMI formula and what is still owed. */
import {
  addMonths,
  emiFor,
  emiDate,
  paidCount,
  firstEmiDateOf,
  calculateOutstandingBalance,
} from '../utils/LoanCalculator';

const d = (y, m, day) => new Date(y, m - 1, day, 12);

test('EMI formula: ₹25,000 at 15% for 12 months → ₹2,256.46; 0% → amount / months', () => {
  expect(emiFor(25000, 15, 12)).toBe(2256.46);
  expect(emiFor(200000, 12, 24)).toBe(9414.69);
  expect(emiFor(6456, 0, 12)).toBe(538);
  expect(emiFor(0, 12, 12)).toBe(0);
  expect(emiFor(1000, 12, 0)).toBe(0);
});

test('reducing: outstanding after 3 EMIs = ₹19,094.92', () => {
  const loan = {
    originalAmount: 25000,
    interestRate: 15,
    tenure: 12,
    emiAmount: 2256.46,
    firstEmiDate: d(2026, 9, 15),
  };
  expect(paidCount(loan, d(2026, 11, 22))).toBe(3);
  expect(calculateOutstandingBalance(loan, d(2026, 11, 22))).toBe(19094.92);
  expect(calculateOutstandingBalance(loan, d(2026, 9, 1))).toBe(25000);
  expect(calculateOutstandingBalance(loan, d(2028, 1, 1))).toBe(0);
});

test('no-cost ₹538 × 12, first EMI 7 Aug 2026: 4 paid on 22 Nov (₹4,304 left), 4 on 6 Dec, 5 on 7 Dec', () => {
  const loan = {
    originalAmount: 6456,
    emiAmount: 538,
    tenure: 12,
    loanType: 'No Cost EMI',
    firstEmiDate: d(2026, 8, 7),
  };
  expect(paidCount(loan, d(2026, 11, 22))).toBe(4);
  expect(calculateOutstandingBalance(loan, d(2026, 11, 22))).toBe(4304);
  expect(paidCount(loan, d(2026, 12, 6))).toBe(4);
  expect(paidCount(loan, new Date(2026, 11, 7, 0, 0, 1))).toBe(5);
  expect(paidCount(loan, d(2030, 1, 1))).toBe(12);
  expect(calculateOutstandingBalance(loan, d(2030, 1, 1))).toBe(0);
});

test('first EMI on 31 Jan: the 28/29 Feb EMI counts; the 31st returns in March', () => {
  const loan = { firstEmiDate: d(2027, 1, 31), tenure: 6 };
  expect(emiDate(loan, 2).getDate()).toBe(28);
  expect(paidCount(loan, d(2027, 2, 28))).toBe(2);
  expect(paidCount(loan, d(2027, 2, 27))).toBe(1);
  expect(emiDate(loan, 3).getDate()).toBe(31);
  expect(emiDate({ firstEmiDate: d(2028, 1, 31) }, 2).getDate()).toBe(29); // leap year
  expect(addMonths(d(2026, 12, 15), 1).getFullYear()).toBe(2027);
});

test('old loans with only startDate: first EMI = start + 1 month', () => {
  const loan = {
    startDate: d(2026, 7, 7),
    originalAmount: 6456,
    emiAmount: 538,
    tenure: 12,
    loanType: 'No Cost EMI',
  };
  expect(firstEmiDateOf(loan).getMonth()).toBe(7); // August
  expect(calculateOutstandingBalance(loan, d(2026, 11, 22))).toBe(4304);
  expect(firstEmiDateOf({})).toBeNull();
  expect(firstEmiDateOf({ firstEmiDate: 'nope', startDate: 'bad' })).toBeNull();
  expect(emiDate({}, 1)).toBeNull();
  expect(paidCount({}, d(2026, 1, 1))).toBe(0);
});

test('missing data → stored balance; closed → 0', () => {
  expect(calculateOutstandingBalance({ balance: '1234.5' })).toBe(1234.5);
  expect(calculateOutstandingBalance({ status: 'closed', balance: 999 })).toBe(0);
});

test('prepayment reduces outstanding (reducing, no-cost, flat)', () => {
  const base = {
    originalAmount: 25000,
    interestRate: 15,
    tenure: 12,
    emiAmount: 2256.46,
    firstEmiDate: d(2026, 9, 15),
  };
  const pre = {
    ...base,
    prepayments: [
      { date: d(2026, 10, 20), amount: 5000 },
      { date: d(2027, 6, 1), amount: 1 },
    ],
  };
  const before = calculateOutstandingBalance(base, d(2026, 11, 22));
  const after = calculateOutstandingBalance(pre, d(2026, 11, 22));
  expect(after).toBeLessThan(before - 5000); // less interest after the prepayment too
  const noCost = {
    originalAmount: 6456,
    emiAmount: 538,
    tenure: 12,
    loanType: 'No Cost EMI',
    firstEmiDate: d(2026, 8, 7),
    prepayments: [{ date: d(2026, 11, 1), amount: 1000 }],
  };
  expect(calculateOutstandingBalance(noCost, d(2026, 11, 22))).toBe(3304);
  const flat = {
    originalAmount: 12000,
    interestRate: 10,
    tenure: 12,
    emiAmount: 1100,
    loanType: 'Flat Rate',
    firstEmiDate: d(2026, 1, 1),
  };
  expect(calculateOutstandingBalance(flat, d(2026, 3, 1))).toBe(13200 - 3300);
  expect(calculateOutstandingBalance({ ...flat, tenure: undefined }, d(2026, 3, 1))).toBe(13200 - 3300);
  // a prepayment that clears the loan
  expect(
    calculateOutstandingBalance(
      { ...base, prepayments: [{ date: d(2026, 9, 1), amount: 30000 }] },
      d(2026, 11, 22)
    )
  ).toBe(0);
});
