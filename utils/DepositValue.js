/**
 * DepositValue.js (Phase 12 B3) - pure. What an FD or RD is worth today.
 * Indian banks compound quarterly by default: whole periods compound, the days after the
 * last full period earn simple interest. Values stop growing at maturity.
 */
const DAY = 86400000;
const PERIOD_MONTHS = { quarterly: 3, monthly: 1 };

const toDate = (d) => (d instanceof Date ? new Date(d.getTime()) : new Date(d));
const valid = (d) => d instanceof Date && Number.isFinite(d.getTime());
const round2 = (n) => Math.round(n * 100) / 100;
// Interest accrues per whole day, so a value read twice on the same day is the same.
const wholeDays = (ms) => Math.floor(ms / DAY);

/** Same day of month `n` months later (31 Jan + 1 → 28/29 Feb). */
export const addMonths = (date, n) => {
  const d = toDate(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d;
};

/**
 * fdValue({ principal, ratePct, startDate, compounding = 'quarterly', maturityDate }, asOf)
 * compounding: 'quarterly' | 'monthly' | 'simple'. Before the start → principal.
 */
export const fdValue = (
  { principal, ratePct, startDate, compounding = 'quarterly', maturityDate } = {},
  asOf = new Date()
) => {
  const p = Number(principal);
  const r = Number(ratePct) / 100;
  if (!Number.isFinite(p) || p <= 0) return 0;
  const start = toDate(startDate);
  if (!valid(start) || !Number.isFinite(r) || r <= 0) return round2(p);
  let end = toDate(asOf);
  const maturity = maturityDate ? toDate(maturityDate) : null;
  if (valid(maturity) && maturity < end) end = maturity;
  if (end <= start) return round2(p);

  if (compounding === 'simple') return round2(p * (1 + (r * wholeDays(end - start)) / 365));
  const months = PERIOD_MONTHS[compounding] || 3;
  const perYear = 12 / months;
  let periods = 0;
  while (addMonths(start, (periods + 1) * months) <= end) periods += 1;
  const compounded = p * Math.pow(1 + r / perYear, periods);
  const restDays = wholeDays(end - addMonths(start, periods * months));
  return round2(compounded * (1 + (r * restDays) / 365));
};

/**
 * rdValue({ monthly, ratePct, startDate, months }, asOf): each instalment (the first on the
 * start date, then monthly) grows like a small quarterly FD until the RD matures.
 */
export const rdValue = ({ monthly, ratePct, startDate, months } = {}, asOf = new Date()) => {
  const m = Number(monthly);
  const n = Math.floor(Number(months));
  const start = toDate(startDate);
  if (!Number.isFinite(m) || m <= 0 || !Number.isFinite(n) || n <= 0 || !valid(start)) return 0;
  const maturity = addMonths(start, n);
  const now = toDate(asOf);
  let total = 0;
  for (let k = 0; k < n; k += 1) {
    const paidOn = addMonths(start, k);
    if (paidOn > now) break;
    total += fdValue({ principal: m, ratePct, startDate: paidOn, maturityDate: maturity }, now);
  }
  return round2(total);
};

/** Maturity date of an RD / FD account, or null. */
export const maturityOf = (acc) => {
  if (!acc) return null;
  if (acc.maturityDate) {
    const d = toDate(acc.maturityDate);
    return valid(d) ? d : null;
  }
  if (acc.subType === 'Recurring Deposit' && acc.startDate && acc.tenure)
    return addMonths(acc.startDate, acc.tenure);
  return null;
};

/** Today's value for a deposit account, or null when it is not one we can value. */
export const depositValue = (acc, asOf = new Date()) => {
  if (!acc || !acc.startDate || !(Number(acc.interestRate) > 0)) return null;
  if (acc.subType === 'Fixed Deposit' && Number(acc.principal) > 0)
    return fdValue(
      {
        principal: acc.principal,
        ratePct: acc.interestRate,
        startDate: acc.startDate,
        compounding: acc.compounding || 'quarterly',
        maturityDate: acc.maturityDate,
      },
      asOf
    );
  if (acc.subType === 'Recurring Deposit' && Number(acc.monthly) > 0 && Number(acc.tenure) > 0)
    return rdValue(
      { monthly: acc.monthly, ratePct: acc.interestRate, startDate: acc.startDate, months: acc.tenure },
      asOf
    );
  return null;
};
