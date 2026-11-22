/**
 * CardStatementSms.js (Phase 13 B7) - pure. Credit-card statement SMS → the card's bill.
 * Verified wordings (owner's real SMS, 22 Nov 2026):
 *  - Axis: "Your statement for Axis Bank Credit Card no. XX9070 is generated. Due on: 21-08-26
 *    Total amt: INR  Dr. 14480.89 Min amt due: INR  Dr. 336.00 …" (no statement date: the SMS date)
 *  - SBI: "E-statement of SBI Credit Card ending XX87 dated 06/10/2026 has been mailed. … Total Amt
 *    Due Rs 16229; Min Amt Due Rs 9363; Payable by 26/10/2026. …" (only the last 2 digits)
 * Also: lender receipts ("EMI Received! EMI Rs 359.00 … towards loan no. …") confirm an EMI the
 * bank debit SMS already recorded, so they are not transactions.
 */

const money = (s) => {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const dmy = (d, m, y) => {
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const date = new Date(year, Number(m) - 1, Number(d));
  return date.getDate() === Number(d) && date.getMonth() === Number(m) - 1 ? date : null;
};

const AXIS_RE = /statement for Axis Bank Credit Card no\.?\s*X*(\d{4}) is generated/i;
const AXIS_DUE_RE = /Due on:\s*(\d{1,2})-(\d{1,2})-(\d{2,4})/i;
const AXIS_TOTAL_RE = /Total amt:\s*INR\s*(Dr|Cr)?\.?\s*([\d,]+(?:\.\d+)?)/i;
const AXIS_MIN_RE = /Min amt due:\s*INR\s*(?:Dr|Cr)?\.?\s*([\d,]+(?:\.\d+)?)/i;

const SBI_RE = /statement of SBI Credit Card ending\s*X*(\d{2,4}) dated (\d{1,2})\/(\d{1,2})\/(\d{4})/i;
const SBI_TOTAL_RE = /Total Amt Due Rs\.?\s*([\d,]+(?:\.\d+)?)/i;
const SBI_MIN_RE = /Min Amt Due Rs\.?\s*([\d,]+(?:\.\d+)?)/i;
const SBI_DUE_RE = /Payable by (\d{1,2})\/(\d{1,2})\/(\d{4})/i;

/**
 * → { bankName, lastDigits, totalDue, minDue, dueDate, statementDate|null } or null.
 * A "Cr." total (bank owes you) is a bill of ₹0. // UNVERIFIED-SAMPLE: the Cr. form (no real SMS yet)
 */
export const parseCardStatement = (body = '') => {
  const s = String(body || '');
  const axis = s.match(AXIS_RE);
  if (axis) {
    const due = s.match(AXIS_DUE_RE);
    const total = s.match(AXIS_TOTAL_RE);
    if (!due || !total) return null;
    const credit = /^cr$/i.test(total[1] || '');
    const min = s.match(AXIS_MIN_RE);
    return {
      bankName: 'Axis Bank',
      lastDigits: axis[1],
      totalDue: credit ? 0 : money(total[2]),
      minDue: credit ? 0 : min ? money(min[1]) : 0,
      dueDate: dmy(due[1], due[2], due[3]),
      statementDate: null,
    };
  }
  const sbi = s.match(SBI_RE);
  if (sbi) {
    const total = s.match(SBI_TOTAL_RE);
    const due = s.match(SBI_DUE_RE);
    if (!total || !due) return null;
    const min = s.match(SBI_MIN_RE);
    return {
      bankName: 'SBI',
      lastDigits: sbi[1],
      totalDue: money(total[1]),
      minDue: min ? money(min[1]) : 0,
      dueDate: dmy(due[1], due[2], due[3]),
      statementDate: dmy(sbi[2], sbi[3], sbi[4]),
    };
  }
  return null;
};

/** Lender receipt for an EMI (e.g. Bajaj Finance "EMI Received!"): not a money movement. */
export const isLenderEmiReceipt = (body = '') =>
  /\bEMI Received\b/i.test(body) || /\bEMI\b[^.]*\breceived\b[^.]*\btowards loan\b/i.test(body);

/** Not a transaction: a card statement or a lender's EMI receipt. */
export const isNonTransactionNotice = (body = '') =>
  !!parseCardStatement(body) ||
  /statement .*credit card|e-statement of/i.test(body) ||
  isLenderEmiReceipt(body);

/**
 * The card a statement belongs to: same bank, last digits match (SBI gives 2). Exactly one,
 * else null (the owner adds the bill by hand).
 */
export const cardForStatement = (st, accounts = []) => {
  if (!st) return null;
  const bank = st.bankName === 'SBI' ? /\bSBI\b|state bank/i : /axis/i;
  const hits = accounts.filter(
    (a) =>
      a &&
      a.type === 'Credit Card' &&
      bank.test(`${a.bankName || ''} ${a.name || ''}`) &&
      String(a.last4 || '').endsWith(st.lastDigits)
  );
  return hits.length === 1 ? hits[0] : null;
};
