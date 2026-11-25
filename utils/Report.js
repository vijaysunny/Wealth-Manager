/**
 * Report (Phase 14) - pure. The one place that decides what a row counts as in reports:
 * spending, income or neither. Transfers and rows set "not in reports" count as neither; a loan
 * payment in Interest-only mode counts only its interest (LoanLink.spendAmount).
 * Phase 14 E4/E5 extend this for splits, refunds and settlements.
 */
import { spendAmount } from './LoanLink';

/** Transfers and rows set "not in reports" never count. */
export const isReportable = (tx) => !!tx && tx.type !== 'transfer' && !tx.excludeFromReports;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** What this row adds to spending. */
export const spentOf = (tx) => (isReportable(tx) && tx.type === 'expense' ? spendAmount(tx) : 0);
/** What this row adds to income. */
export const incomeOf = (tx) => (isReportable(tx) && tx.type === 'income' ? num(tx.amount) : 0);

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
