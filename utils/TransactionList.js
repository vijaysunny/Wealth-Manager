/**
 * TransactionList.js (C5.2) - pure helpers for the Transactions screen.
 */
import { isReportable } from './BalanceService';

const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "WED, 18 NOV" */
export const dayTitle = (d) =>
  d
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/,/g, '')
    .replace(/^(\w+)\s/, '$1, ')
    .toUpperCase();

/**
 * Newest day first. total = income − spending for the day; transfers and excluded rows do
 * not count (a ₹500 top-up never changes the day total).
 */
export const groupByDay = (txs = []) => {
  const groups = new Map();
  [...txs]
    .filter((tx) => tx && !Number.isNaN(new Date(tx.fullDate).getTime()))
    .sort((a, b) => new Date(b.fullDate) - new Date(a.fullDate))
    .forEach((tx) => {
      const d = new Date(tx.fullDate);
      const key = dayKey(d);
      if (!groups.has(key)) groups.set(key, { key, title: dayTitle(d), total: 0, data: [] });
      const g = groups.get(key);
      g.data.push(tx);
      if (isReportable(tx)) g.total += (tx.type === 'income' ? 1 : -1) * (Number(tx.amount) || 0);
    });
  return [...groups.values()].map((g) => ({ ...g, total: Math.round(g.total * 100) / 100 }));
};

/** Does the row belong to this account (either side of a transfer)? */
export const touchesAccount = (tx, account) => {
  if (!account) return true;
  const ids = [tx.accountId, tx.toAccountId, tx.balanceAccountId].filter((x) => x != null).map(String);
  if (ids.includes(String(account.id))) return true;
  return tx.account === account.name || tx.toAccount === account.name;
};

/** "Axis Bank" + 0973 → "Axis ••0973"; "Axis Bank Credit Card" → "Axis Card". */
// A1: names created from SMS already end in "••0973" (or "XX0973", "*0973", " 0973"), and the
// account also stores last4. Strip any trailing digit marker, shorten, then add ••last4 once.
// A bare " 0973" only counts when it is the account's own last4: "Home Loan 2025" stays as it is.
const TRAILING_DIGITS = /(\s*(?:•+|\.{2,}|x{2,}|\*+)\s*|\s+)(\d{4})\s*$/i;
export const shortAccountName = (name = '', last4 = null) => {
  let base = String(name || '').trim();
  let found = null;
  for (let m = base.match(TRAILING_DIGITS); m; m = base.match(TRAILING_DIGITS)) {
    const marked = m[1].trim() !== '';
    if (!marked && (!last4 || String(last4) !== m[2])) break;
    found = found || m[2];
    base = base.slice(0, m.index).trim();
  }
  base = base
    .replace(/\s+Credit Card\b/i, ' Card')
    .replace(/\s+Bank\b/i, '')
    .trim();
  const digits = last4 ? String(last4) : found;
  return digits ? `${base} ••${digits}`.trim() : base;
};

// A1.3: badge initials. Known banks use their short code; otherwise the first two letters.
const BANK_CODES = [
  [/^axis\b/i, 'AX'],
  [/^sbi\b|^state bank\b/i, 'SBI'],
  [/^hdfc\b/i, 'HD'],
  [/^icici\b/i, 'IC'],
  [/^kotak\b/i, 'KO'],
];
export const accountInitials = (name = '') => {
  const clean = String(name || '').trim();
  const known = BANK_CODES.find(([re]) => re.test(clean));
  if (known) return known[1];
  const first = clean.split(/\s+/)[0] || '';
  return (
    first
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
};
