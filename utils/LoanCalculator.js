/**
 * LoanCalculator.js - pure. EMI schedule and what is still owed on a loan.
 *
 * Phase 13 C2: EMIs are counted by their dates (first EMI date + k months, same day; short
 * months use their last day), not by calendar months since the start. A loan whose first EMI
 * was on 7 Aug has 4 EMIs paid on 22 Nov, and still 4 on 6 Dec.
 * Old loans that only have `startDate` keep working: first EMI = startDate + 1 month.
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const toDate = (d) => (d instanceof Date ? new Date(d.getTime()) : new Date(d));
const valid = (d) => d instanceof Date && Number.isFinite(d.getTime());
const lastDayOf = (y, m) => new Date(y, m + 1, 0).getDate();

/** Same day `n` months later; short months use their last day (31 Jan + 1 → 28/29 Feb). */
export const addMonths = (date, n) => {
  const d = toDate(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, lastDayOf(d.getFullYear(), d.getMonth())));
  return d;
};

/** Reducing-balance EMI. rate 0 → amount / months. */
export const emiFor = (amount, ratePct, months) => {
  const p = num(amount);
  const n = Math.round(num(months));
  if (p <= 0 || n <= 0) return 0;
  const r = num(ratePct) / 12 / 100;
  const f = Math.pow(1 + r, n);
  if (r <= 0 || !(f - 1 > 1e-12)) return round2(p / n);
  return round2((p * r * f) / (f - 1));
};

/** The first EMI date: firstEmiDate, else startDate + 1 month (old loans), else null. */
export const firstEmiDateOf = (loan = {}) => {
  if (loan.firstEmiDate) {
    const d = toDate(loan.firstEmiDate);
    if (valid(d)) return d;
  }
  if (loan.startDate) {
    const s = toDate(loan.startDate);
    if (valid(s)) return addMonths(s, 1);
  }
  return null;
};

/** Date of EMI number k (1-based). Computed from the first date so the 31st stays the 31st. */
export const emiDate = (loan, k) => {
  const first = firstEmiDateOf(loan);
  return first ? addMonths(first, k - 1) : null;
};

const tenureOf = (loan) => {
  const n = Math.round(num(loan.tenure));
  return n > 0 ? n : Infinity;
};

const endOfDay = (d) => {
  const x = toDate(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

/** Number of EMI dates on or before asOf (the whole day counts), capped at the tenure. */
export const paidCount = (loan, asOf = new Date()) => {
  const first = firstEmiDateOf(loan);
  if (!first) return 0;
  const limit = endOfDay(asOf).getTime();
  const cap = tenureOf(loan);
  let k = 0;
  while (k < cap && k < 1200 && addMonths(first, k).getTime() <= limit) k += 1;
  return k;
};

/**
 * What is still owed on `asOf`. Closed loans owe 0. Prepayments ({ date, amount }) on or before
 * asOf come off the principal at their date. Without enough data the stored balance is returned.
 */
export const calculateOutstandingBalance = (loan, asOf = new Date()) => {
  if (loan.status === 'closed') return 0;
  const first = firstEmiDateOf(loan);
  if (!first || !loan.emiAmount || !loan.originalAmount) return parseFloat(loan.balance);

  const principal = num(loan.originalAmount);
  const emi = num(loan.emiAmount);
  const rate = num(loan.interestRate);
  const paid = paidCount(loan, asOf);
  const limit = endOfDay(asOf).getTime();
  const prepayments = (Array.isArray(loan.prepayments) ? loan.prepayments : [])
    .map((p) => ({ at: toDate(p.date).getTime(), amount: num(p.amount) }))
    .filter((p) => Number.isFinite(p.at) && p.at <= limit && p.amount > 0)
    .sort((a, b) => a.at - b.at);
  const prepaid = prepayments.reduce((s, p) => s + p.amount, 0);

  let outstanding;
  if (loan.loanType === 'No Cost EMI') {
    outstanding = principal - emi * paid - prepaid;
  } else if (loan.loanType === 'Flat Rate') {
    const tenureMonths = num(loan.tenure) || 12;
    const totalPayable = principal + principal * (rate / 100) * (tenureMonths / 12);
    outstanding = totalPayable - emi * paid - prepaid;
  } else {
    // Reducing balance: month by month, prepayments applied on their dates.
    const monthlyRate = rate / 12 / 100;
    let bal = principal;
    let next = 0;
    for (let k = 1; k <= paid && bal > 0; k += 1) {
      const at = emiDate(loan, k).getTime();
      while (next < prepayments.length && prepayments[next].at < at) bal -= prepayments[next++].amount;
      if (bal <= 0) break;
      bal = round2(bal - (emi - round2(bal * monthlyRate)));
    }
    while (next < prepayments.length) bal -= prepayments[next++].amount;
    // The last EMI is adjusted by the lender to clear the paise left by rounding.
    outstanding = paid >= tenureOf(loan) ? 0 : bal;
  }
  return Math.max(0, round2(outstanding));
};
