/**
 * LoanLink.js (Phase 13 C6 + C4) - pure. Linking a transaction to a loan.
 *
 * - One transaction links to one loan: tx.loanLink = { loanId, kind, emiNo?, principal, interest,
 *   source, mode?, interestOnly }. The amount never changes.
 * - Linked payments get the category Loan/EMI; "Loan received" becomes a one-sided transfer in
 *   (never income), so the bank moves exactly as before. What it was before is kept in
 *   tx.loanLinkPrev and restored on unlink.
 * - interestOnly mirrors the loan's "Count in budget as: Interest only" setting: reports then count
 *   only interest & charges as spending (spendAmount). Net worth is the same either way.
 */
import { formatMoney } from './Format';
import { emiDate, paidCount } from './LoanCalculator';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const DAY = 86400000;

export const LINK_KINDS = [
  { value: 'emi', label: 'EMI' },
  { value: 'prepayment', label: 'Prepayment' },
  { value: 'charges', label: 'Fee / penalty' },
  { value: 'foreclosure', label: 'Foreclosure' },
  { value: 'disbursal', label: 'Loan received' },
];

/** amount − principal − interest (0 when the split adds up). */
export const splitGap = (amount, principal, interest) => round2(num(amount) - num(principal) - num(interest));

/** { amount, principal, interest, kind, txType } → message or null. */
export const linkError = ({ amount, principal, interest, kind, txType }) => {
  const moneyIn = txType === 'income' || txType === 'transfer';
  if (kind === 'disbursal') return moneyIn ? null : 'Loan received is for money coming in from the lender.';
  if (txType === 'income') return 'Money coming in can only be Loan received.';
  if (num(principal) < 0 || num(interest) < 0) return "Amounts can't be negative.";
  const gap = splitGap(amount, principal, interest);
  if (gap !== 0)
    return `Principal and interest must add up to ${formatMoney(num(amount))} (${gap > 0 ? 'short' : 'over'} by ${formatMoney(Math.abs(gap))}).`;
  return null;
};

const PREV_KEYS = ['type', 'category', 'flow', 'transferKind'];
const prevOf = (tx) => {
  const p = {};
  PREV_KEYS.forEach((k) => {
    if (tx[k] !== undefined) p[k] = tx[k];
  });
  return p;
};

/** The transaction after linking (nothing is written here). */
export const applyLink = (tx, link, loan = {}) => {
  const kind = link.kind;
  const loanLink = {
    loanId: link.loanId,
    kind,
    principal: round2(num(link.principal)),
    interest: round2(num(link.interest)),
    source: link.source || 'manual',
    interestOnly: loan.budgetMode === 'interestOnly',
  };
  if (kind === 'emi' && link.emiNo) loanLink.emiNo = Number(link.emiNo);
  if (kind === 'prepayment') loanLink.mode = link.mode === 'reduceEmi' ? 'reduceEmi' : 'endSooner';
  const prev = tx.loanLinkPrev || prevOf(tx);
  const base = { ...tx, loanLink, loanLinkPrev: prev };
  if (kind === 'disbursal')
    return { ...base, category: prev.category, type: 'transfer', flow: 'in', transferKind: 'loan_disbursal' };
  const out = { ...base, type: prev.type === 'transfer' ? 'expense' : prev.type, category: 'Loan/EMI' };
  ['flow', 'transferKind'].forEach((k) => {
    if (prev[k] === undefined) delete out[k];
    else out[k] = prev[k];
  });
  return out;
};

/** The transaction after unlinking: its type and category as they were before. */
export const removeLink = (tx) => {
  if (!tx || !tx.loanLink) return tx;
  const prev = tx.loanLinkPrev || {};
  const out = { ...tx };
  delete out.loanLink;
  delete out.loanLinkPrev;
  PREV_KEYS.forEach((k) => {
    if (prev[k] === undefined) delete out[k];
    else out[k] = prev[k];
  });
  return out;
};

/** Bank (not card) debits and credits; anything already linked. Card spends use "Track as EMI". */
export const canLink = (tx, accountsById = {}) => {
  if (!tx) return false;
  if (tx.loanLink) return true;
  if (tx.type !== 'expense' && tx.type !== 'income') return false;
  const acc = tx.accountId != null ? accountsById[String(tx.accountId)] : null;
  return !acc || acc.type !== 'Credit Card';
};

const payeeKey = (tx) =>
  String(tx.merchant || tx.title || '')
    .trim()
    .toLowerCase();

/**
 * "+ Link a payment" candidates: unlinked bank debits from the same payee as this loan's earlier
 * links, or within ±1 % of the EMI and ±5 days of an EMI date. Newest first.
 */
export const candidatesFor = (loan, txs = [], accountsById = {}, asOf = new Date()) => {
  const mine = txs.filter((t) => t && t.loanLink && String(t.loanLink.loanId) === String(loan.id));
  const payees = new Set(mine.map(payeeKey).filter(Boolean));
  const emi = num(loan.emiAmount);
  const nearEmiDate = (at) => {
    const k = Math.max(1, paidCount(loan, at));
    return [k, k + 1].some((n) => {
      const due = emiDate(loan, n);
      return due && Math.abs(at - due) <= 5 * DAY + DAY / 2;
    });
  };
  return txs
    .filter((t) => t && !t.loanLink && t.type === 'expense' && canLink(t, accountsById))
    .filter((t) => new Date(t.fullDate) <= new Date(asOf.getTime() + 5 * DAY))
    .filter((t) => {
      if (payees.has(payeeKey(t))) return true;
      const at = new Date(t.fullDate);
      return emi > 0 && Math.abs(num(t.amount) - emi) <= emi * 0.01 && nearEmiDate(at);
    })
    .sort((a, b) => new Date(b.fullDate) - new Date(a.fullDate));
};

/** What a transaction counts as spending: without principal when its loan is set to Interest only. */
export const spendAmount = (tx) => {
  if (!tx) return 0;
  const amount = num(tx.amount);
  if (tx.type === 'expense' && tx.loanLink && tx.loanLink.interestOnly)
    return round2(Math.max(0, amount - num(tx.loanLink.principal)));
  return amount;
};
