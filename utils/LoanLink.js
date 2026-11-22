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
import { defaultSplit } from './LoanLedger';

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

// ── C4: bank EMIs ──────────────────────────────────────────────────────────────

const MANDATE_CHANNELS = ['ACH', 'NACH', 'ECS', 'SI'];
/** An unlinked bank debit made by a mandate (ACH-DR, NACH, ECS, SI-) or named as an EMI. */
const mandateLike = (tx) =>
  !!tx &&
  (tx.type === 'expense' || (tx.loanLinkPrev && tx.loanLinkPrev.type === 'expense')) &&
  (MANDATE_CHANNELS.includes(String(tx.channel || '').toUpperCase()) ||
    /\bEMI\b/i.test(`${tx.merchant || ''} ${tx.title || ''}`));
export const isMandateDebit = (tx) => mandateLike(tx) && !tx.loanLink;

const dayGap = (a, b) => {
  const d = Math.abs(a - b);
  return Math.min(d, 31 - d);
};
const sameAmount = (a, b) => Math.abs(num(a) - num(b)) <= Math.max(num(a), num(b)) * 0.01;
export const dismissKey = (payee, amount) => `${payee}|${Math.round(num(amount))}`;

/**
 * C4 suggestions for Review → Check. A payee qualifies when it has 2 or more mandate debits from a
 * bank account on about the same day of the month (±3) and at least 25 days apart; we track from
 * today, so missing months are fine. Different amounts are offered as separate loans.
 * → [{ key, payee, debits (newest first), mixed, loans: [{ amount, debitDay, accountId, debits, dismissKey }] }]
 */
export const emiSuggestions = (txs = [], accountsById = {}, dismissed = []) => {
  const groups = new Map();
  // Monthly is judged on all the payee's mandate debits (linked ones too); only unlinked are offered.
  txs
    .filter((t) => mandateLike(t) && canLink(t, accountsById))
    .forEach((t) => {
      const k = payeeKey(t);
      if (!k) return;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    });
  const out = [];
  groups.forEach((list, key) => {
    if (list.length < 2) return;
    const sorted = [...list].sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate));
    const day0 = new Date(sorted[0].fullDate).getDate();
    const monthly = sorted.every((t, i) => {
      const at = new Date(t.fullDate);
      if (dayGap(at.getDate(), day0) > 3) return false;
      return i === 0 || at - new Date(sorted[i - 1].fullDate) >= 25 * DAY;
    });
    if (!monthly) return;
    const clusters = [];
    [...sorted]
      .reverse()
      .filter((t) => !t.loanLink)
      .forEach((t) => {
        const c = clusters.find((x) => sameAmount(x.amount, t.amount));
        if (c) c.debits.push(t);
        else clusters.push({ amount: round2(num(t.amount)), debits: [t] });
      });
    const loans = clusters
      .map((c) => ({
        amount: c.amount,
        debitDay: new Date(c.debits[0].fullDate).getDate(),
        accountId: c.debits[0].accountId,
        debits: c.debits,
        dismissKey: dismissKey(key, c.amount),
      }))
      .filter((l) => !dismissed.includes(l.dismissKey));
    if (!loans.length) return;
    const debits = [...sorted].reverse().filter((t) => !t.loanLink);
    out.push({
      key,
      payee: String(debits[0].merchant || debits[0].title).trim(),
      debits,
      mixed: clusters.length > 1,
      loans,
    });
  });
  return out;
};

/** Present value of n EMIs at ratePct a year. */
const presentValue = (emi, ratePct, n) => {
  const r = num(ratePct) / 1200;
  return r > 0 ? round2((emi * (1 - Math.pow(1 + r, -n))) / r) : round2(emi * n);
};

/**
 * C4 "New loan" from the debits found: the first EMI is the earliest debit seen (or the next debit
 * day), months = EMIs seen so far + EMIs left, amount = what those EMIs repay at the rate. So what
 * is owed today = the value of the EMIs left (₹538 × 8 = ₹4,304 for a no-cost loan).
 */
export const loanFromDebits = (
  { payee, emi, left, rate, debitDay, accountId, debits = [] },
  now = new Date()
) => {
  let first;
  if (debits.length) {
    const earliest = new Date(Math.min(...debits.map((t) => new Date(t.fullDate).getTime())));
    first = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate());
  } else {
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    first = new Date(now.getFullYear(), now.getMonth(), Math.min(debitDay, last));
  }
  const seen = paidCount({ firstEmiDate: first.toISOString() }, now);
  const months = seen + Math.round(num(left));
  return {
    kind: 'personal',
    name: payee,
    amount: presentValue(num(emi), rate, months),
    months,
    rate: num(rate),
    firstEmi: first,
    emi: round2(num(emi)),
    payFromId: accountId || null,
  };
};

/**
 * C4 auto-link rule: a loan linked from its bank debits keeps loan.match = { payee, amount }.
 * Every later unlinked debit (dated after the loan's newest linked payment) from that payee for
 * that amount (±1 %) links as the next EMI with the schedule split. Earlier debits are left alone,
 * so a debit the owner unlinked is not linked again. Closed loans and card EMIs never auto-link.
 * → [{ txId, link }] in date order (nothing is written here).
 */
export const autoLinks = (loans = [], txs = []) => {
  const out = [];
  loans
    .filter((l) => l && l.match && l.status !== 'closed' && !l.includedInCard)
    .forEach((loan) => {
      let pool = [...txs];
      const mine = pool.filter((t) => t && t.loanLink && String(t.loanLink.loanId) === String(loan.id));
      const after = mine.reduce((m, t) => Math.max(m, new Date(t.fullDate).getTime()), -Infinity);
      pool
        .filter(
          (t) =>
            t &&
            !t.loanLink &&
            t.type === 'expense' &&
            payeeKey(t) === loan.match.payee &&
            sameAmount(t.amount, loan.match.amount) &&
            new Date(t.fullDate).getTime() > after
        )
        .sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate))
        .forEach((t) => {
          const s = defaultSplit(loan, pool, 'emi', t.amount, new Date(t.fullDate));
          const link = {
            loanId: loan.id,
            kind: 'emi',
            emiNo: s.emiNo,
            principal: s.principal,
            interest: s.interest,
            source: t.smsId ? 'sms' : 'manual',
          };
          out.push({ txId: t.id, link });
          pool = pool.map((x) => (x.id === t.id ? applyLink(x, link, loan) : x));
        });
    });
  return out;
};

const monthKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const missedKey = (loan, now = new Date()) => `loan_missed_${loan.id}_${monthKeyOf(now)}`;

/**
 * C4: a bank loan tracked from SMS (loan.match) whose debit has not arrived by debit day + 2 this
 * month. Not for card EMIs, closed loans, loans not started or already finished.
 */
export const missedEmi = (loan, txs = [], now = new Date()) => {
  if (!loan || !loan.match || loan.status === 'closed' || loan.includedInCard) return false;
  const first = emiDate(loan, 1);
  const day = Math.round(num(loan.debitDay)) || (first ? first.getDate() : 0);
  if (!day) return false;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const due = new Date(now.getFullYear(), now.getMonth(), Math.min(day, last));
  if (now.getTime() < due.getTime() + 3 * DAY) return false;
  if (first && first > due) return false;
  const tenure = Math.round(num(loan.tenure));
  if (tenure > 0 && paidCount(loan, new Date(due.getTime() - DAY)) >= tenure) return false;
  const from = due.getTime() - 10 * DAY;
  return !txs.some(
    (t) =>
      t &&
      t.loanLink &&
      String(t.loanLink.loanId) === String(loan.id) &&
      new Date(t.fullDate).getTime() >= from &&
      new Date(t.fullDate).getTime() <= now.getTime()
  );
};
