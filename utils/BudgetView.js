/**
 * BudgetView.js (C5.6) - pure helpers for the Budget screen.
 */
import { monthSpend } from './Report';

/** Spending for the month: { total, byCategory } (shared report rules, utils/Report). */
export const monthSpending = (txs = [], date = new Date()) => monthSpend(txs, date);

/** ok below 90 %, warn above 90 %, over above 100 %; none without a limit. */
export const budgetStatus = (spent, limit) => {
  if (!(limit > 0)) return 'none';
  const r = spent / limit;
  if (r > 1) return 'over';
  if (r > 0.9) return 'warn';
  return 'ok';
};

/**
 * Rows for "By category": every category with spending or a limit, biggest spend first.
 * ratio is the bar fill 0…1: against the limit when there is one, else against the largest
 * spend so the bars still compare categories.
 */
export const categoryRows = (byCategory = {}, limits = {}) => {
  const names = [
    ...new Set([...Object.keys(byCategory), ...Object.keys(limits).filter((k) => limits[k] > 0)]),
  ];
  const maxSpent = Math.max(0, ...Object.values(byCategory));
  return names
    .map((name) => {
      const spent = byCategory[name] || 0;
      const limit = limits[name] > 0 ? limits[name] : null;
      const ratio = limit ? Math.min(1, spent / limit) : maxSpent > 0 ? spent / maxSpent : 0;
      return { name, spent, limit, ratio, status: budgetStatus(spent, limit) };
    })
    .sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name));
};

/** "Leftover from October: ₹0" needs the previous month's name. */
export const previousMonthName = (date = new Date()) =>
  new Date(date.getFullYear(), date.getMonth() - 1, 1).toLocaleDateString('en-IN', { month: 'long' });
