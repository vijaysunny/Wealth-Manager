/**
 * Report (Phase 14) - pure. The one place that decides what a row counts as in reports.
 * Budget, Home, Reports, Month in review, the Transactions totals and exports all use it.
 *
 * - Transfers and rows set "not in reports" count as neither spending nor income.
 * - A loan payment in Interest-only mode counts only its interest (LoanLink.spendAmount).
 * - E4 splits: a split row counts its category parts in their categories; parts paid for a
 *   person (IOUs) are neither spending nor income.
 * - E5 refunds: a refund linked to a purchase (refundOf) is not income; it lowers the purchase's
 *   category in the purchase's month (refundCategory / refundDate are copied when linking).
 * - E4 settlements (kind 'settlement': a person paying you back) are not income.
 */
import { spendAmount } from './LoanLink';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Transfers and rows set "not in reports" never count. */
export const isReportable = (tx) => !!tx && tx.type !== 'transfer' && !tx.excludeFromReports;

export const hasSplits = (tx) => Array.isArray(tx?.splits) && tx.splits.length > 0;
export const isLinkedRefund = (tx) => !!tx?.refundOf && tx.type === 'income';

/**
 * What this row adds to spending, as lines: [{ category, amount, fullDate }].
 * A linked refund gives one negative line dated in the purchase's month.
 */
export const spendLines = (tx) => {
  if (!isReportable(tx)) return [];
  if (isLinkedRefund(tx))
    return [
      {
        category: tx.refundCategory || tx.category || 'Other',
        amount: -num(tx.amount),
        fullDate: tx.refundDate || tx.fullDate,
      },
    ];
  if (tx.type !== 'expense') return [];
  if (hasSplits(tx))
    return tx.splits
      .filter((p) => p && !p.personId)
      .map((p) => ({ category: p.category || 'Other', amount: num(p.amount), fullDate: tx.fullDate }));
  return [{ category: tx.category || 'Other', amount: spendAmount(tx), fullDate: tx.fullDate }];
};

/** What this row adds to spending (a linked refund is negative). */
export const spentOf = (tx) => round2(spendLines(tx).reduce((s, l) => s + l.amount, 0));

/** What this row adds to income: not refunds linked to a purchase, not settlements. */
export const incomeOf = (tx) =>
  isReportable(tx) && tx.type === 'income' && !isLinkedRefund(tx) && tx.kind !== 'settlement'
    ? num(tx.amount)
    : 0;

/** The categories a row counts in (split parts, or its own category). */
export const categoriesOf = (tx) =>
  hasSplits(tx)
    ? tx.splits.filter((p) => p && p.category).map((p) => p.category)
    : tx?.category
      ? [tx.category]
      : [];

const sameMonth = (iso, date) => {
  const d = new Date(iso);
  return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth();
};

/** Spending in a calendar month: { total, byCategory }. */
export const monthSpend = (txs, date) => {
  let total = 0;
  const byCategory = {};
  for (const tx of txs || [])
    for (const l of spendLines(tx)) {
      if (!sameMonth(l.fullDate, date)) continue;
      total += l.amount;
      byCategory[l.category] = (byCategory[l.category] || 0) + l.amount;
    }
  Object.keys(byCategory).forEach((k) => (byCategory[k] = round2(byCategory[k])));
  return { total: round2(total), byCategory };
};

/** Income in a calendar month. */
export const monthIncome = (txs, date) =>
  round2((txs || []).reduce((s, tx) => s + (tx && sameMonth(tx.fullDate, date) ? incomeOf(tx) : 0), 0));

/** { count, spent, income, transfers } for a list of rows. */
export const totalsOf = (rows) => {
  let spent = 0;
  let income = 0;
  let transfers = 0;
  for (const tx of rows || []) {
    spent += spentOf(tx);
    income += incomeOf(tx);
    if (tx?.type === 'transfer') transfers += num(tx.amount);
  }
  return {
    count: (rows || []).length,
    spent: round2(spent),
    income: round2(income),
    transfers: round2(transfers),
  };
};
