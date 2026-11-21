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
export const shortAccountName = (name = '', last4 = null) => {
  const base = String(name || '')
    .replace(/\s+Credit Card\b/i, ' Card')
    .replace(/\s+Bank\b/i, '')
    .trim();
  return last4 ? `${base} ••${last4}` : base;
};
