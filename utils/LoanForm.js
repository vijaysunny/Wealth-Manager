/**
 * LoanForm.js (Phase 13 C2) - pure. The add/edit loan or EMI form: kinds, date text, the checks,
 * the stored record and the "Track as EMI" prefill from a card purchase.
 */
import { formatMoney } from './Format';
import { addMonths, calculateOutstandingBalance, firstEmiDateOf } from './LoanCalculator';
import { cycleWindow } from './CardMath';
import { shortDate } from './CardView';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

export const LOAN_KINDS = [
  { value: 'personal', label: 'Personal' },
  { value: 'home', label: 'Home' },
  { value: 'vehicle', label: 'Car / bike' },
  { value: 'gold', label: 'Gold' },
  { value: 'education', label: 'Education' },
  { value: 'durable', label: 'Consumer durable' },
  { value: 'cardEmi', label: 'EMI on credit card' },
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "15/09/2026", "15-9-2026" or "15 Sep 2026" → Date (local midnight); anything else → null. */
export const parseDmy = (text) => {
  const s = String(text || '').trim();
  let day;
  let month;
  let year;
  const n = s.match(/^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{4})$/);
  const w = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (n) [day, month, year] = [Number(n[1]), Number(n[2]) - 1, Number(n[3])];
  else if (w) {
    month = MONTHS.indexOf(w[2].slice(0, 3).toLowerCase());
    if (month < 0) return null;
    [day, year] = [Number(w[1]), Number(w[3])];
  } else return null;
  const d = new Date(year, month, day);
  return d.getDate() === day && d.getMonth() === month ? d : null;
};
export const formatDmy = (d) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
/** "15 Sep 2026" */
export const longDate = (d) => `${shortDate(d)} ${d.getFullYear()}`;

/**
 * values: { kind, name, amount, months, rate, firstEmi: Date|null, emi, payFromId }.
 * → { error, warn }. EMI × months below the amount blocks when there is interest and only warns at 0 %.
 */
export const loanFormCheck = (v) => {
  const amount = num(v.amount);
  const months = num(v.months);
  const rate = v.rate === '' || v.rate == null ? 0 : num(v.rate);
  const emi = num(v.emi);
  const out = (error, warn = null) => ({ error, warn });
  if (!String(v.name || '').trim()) return out('Enter a name, e.g. "Phone EMI".');
  if (!(amount > 0)) return out('Enter the loan amount.');
  if (!Number.isInteger(months) || months < 1 || months > 360)
    return out('Months must be between 1 and 360.');
  if (!(rate >= 0 && rate <= 60)) return out('Interest must be between 0 and 60 % a year.');
  if (!(v.firstEmi instanceof Date) || !Number.isFinite(v.firstEmi.getTime()))
    return out('Enter the first EMI date as DD/MM/YYYY.');
  if (!(emi > 0)) return out('Enter the EMI amount.');
  if (v.kind === 'cardEmi' && !v.payFromId) return out('Pick the card this EMI is on.');
  const total = round2(emi * months);
  if (total < amount - 1) {
    const msg = `${months} EMIs of ${formatMoney(emi)} add up to ${formatMoney(total)}, less than ${formatMoney(amount)}.`;
    return rate === 0
      ? out(null, msg)
      : out(`${msg} Check the EMI: it is less than the amount with interest.`);
  }
  return out(null);
};

/**
 * The stored Loan account. Card EMIs live on the card (onCardId, includedInCard: never a liability
 * of their own); bank loans keep payFromAccountId and the debit day. Editing keeps id, status,
 * prepayments, closedAt and a Flat Rate type. balance = outstanding today (old screens read it).
 */
export const buildLoan = (v, existing = {}, asOf = new Date()) => {
  const rate = v.rate === '' || v.rate == null ? 0 : num(v.rate);
  const first = v.firstEmi;
  const loanType = rate === 0 ? 'No Cost EMI' : existing.loanType === 'Flat Rate' ? 'Flat Rate' : 'Reducing';
  const r = {
    ...existing,
    id: existing.id || `loan_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    type: 'Loan',
    loanKind: v.kind,
    name: String(v.name).trim(),
    originalAmount: round2(num(v.amount)),
    interestRate: rate,
    loanType,
    tenure: num(v.months),
    firstEmiDate: first.toISOString(),
    startDate: addMonths(first, -1).toISOString(),
    emiAmount: round2(num(v.emi)),
    status: existing.status || 'active',
    prepayments: Array.isArray(existing.prepayments) ? existing.prepayments : [],
  };
  delete r.onCardId;
  delete r.includedInCard;
  delete r.payFromAccountId;
  delete r.debitDay;
  if (v.kind === 'cardEmi') {
    r.onCardId = v.payFromId;
    r.includedInCard = true;
  } else {
    if (v.payFromId) r.payFromAccountId = v.payFromId;
    r.debitDay = first.getDate();
  }
  r.balance = calculateOutstandingBalance(r, asOf);
  return r;
};

const str = (n) => (n === undefined || n === null || n === '' ? '' : String(n));

/** Form text values for editing a stored loan. */
export const formFromLoan = (loan) => {
  const first = firstEmiDateOf(loan);
  return {
    kind: loan.loanKind || 'personal',
    name: loan.name || '',
    amount: str(loan.originalAmount),
    months: str(loan.tenure),
    rate: str(loan.interestRate),
    firstEmi: first ? formatDmy(first) : '',
    emi: str(loan.emiAmount),
    payFromId: loan.onCardId ?? loan.payFromAccountId ?? null,
  };
};

/**
 * "Track as EMI" on a card expense of ₹1,000 or more. The bank usually bills the first EMI on the
 * next statement: the end of the cycle holding the purchase (a month later if the card has no
 * statement day). The purchase itself is not changed.
 */
export const trackAsEmiPrefill = (tx, card) => {
  if (!tx || !card || card.type !== 'Credit Card' || tx.type !== 'expense' || !(Number(tx.amount) >= 1000))
    return null;
  const at = new Date(tx.fullDate);
  const first = card.statementDay ? cycleWindow(card.statementDay, at).end : addMonths(at, 1);
  const payee = String(tx.merchant || tx.title || '').trim();
  return {
    kind: 'cardEmi',
    name: payee ? `${payee} EMI` : 'Card EMI',
    amount: String(tx.amount),
    payFromId: card.id,
    firstEmi: formatDmy(first),
    sourceTxId: tx.id,
  };
};
