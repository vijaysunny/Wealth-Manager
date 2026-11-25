/**
 * HomeSummary.js (C5.1) - pure. The month figures on Home.
 * spent / income count only reportable rows (transfers and excluded rows never count),
 * transfers = money moved between own accounts (card bills, wallet top-ups, self transfers).
 * savedPct only exists when there is income, capped to -100…100 (the old tile showed -201%).
 */
import { monthSpend, monthIncome } from './Report';

const round2 = (n) => Math.round(n * 100) / 100;

export const inMonth = (tx, date) => {
  const d = new Date(tx.fullDate || tx.date);
  return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth();
};

export const monthSummary = (txs = [], date = new Date()) => {
  // spending and income follow the shared report rules (utils/Report: splits, refunds, settlements)
  const spent = monthSpend(txs, date).total;
  const income = monthIncome(txs, date);
  let transfers = 0;
  for (const tx of txs)
    if (tx && tx.type === 'transfer' && inMonth(tx, date)) transfers += Number(tx.amount) || 0;
  const savedPct =
    income > 0 ? Math.max(-100, Math.min(100, Math.round(((income - spent) / income) * 100))) : null;
  return { spent: round2(spent), income: round2(income), transfers: round2(transfers), savedPct };
};

/** "Saturday, 21 Nov" */
export const headerDate = (d = new Date()) =>
  d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });

/** "November 2026" */
export const monthLabel = (d = new Date()) =>
  d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
