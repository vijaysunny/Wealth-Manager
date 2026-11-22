/**
 * CardMath.js (Phase 13 B3) - pure. What you owe on a credit card, this cycle, and the bill.
 *
 * A card created from SMS starts at 0, so a payment for spends made before the scan window
 * makes it look overpaid. The SMS already carry a better number: the available limit. With the
 * credit limit (entered once in card setup), owed = limit − available.
 *
 * Card data lives in the account JSON (B2):
 *   creditLimit, statementDay (1–31), due: { mode: 'afterStatement', days } | { mode: 'fixedDay', day },
 *   remindDue, latestAvailable: { amount, at, sourceId }, statements: [{ date, totalDue, minDue,
 *   dueDate, source, paid }], balance (stored "owed", positive = you owe).
 */
import { paidCount, emiDate } from './LoanCalculator';

const DAY = 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const toDate = (d) => (d instanceof Date ? new Date(d.getTime()) : new Date(d));
const ms = (d) => toDate(d).getTime();
const txMs = (tx) => new Date(tx && tx.fullDate).getTime();
const lastDayOf = (y, m) => new Date(y, m + 1, 0).getDate();
const startOfDay = (d) => {
  const x = toDate(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const endOfDay = (d) => {
  const x = toDate(d);
  x.setHours(23, 59, 59, 999);
  return x;
};
const same = (a, b) =>
  a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);

export const DEFAULT_DUE = { mode: 'afterStatement', days: 20 };

/** B2 migration (safe twice): old `dueDay` → due: { mode: 'fixedDay', day }. */
export const normalizeCard = (card) => {
  if (!card || card.type !== 'Credit Card') return card;
  if (card.due && (card.due.mode === 'afterStatement' || card.due.mode === 'fixedDay')) return card;
  const day = Math.round(num(card.dueDay));
  if (day >= 1 && day <= 31) return { ...card, due: { mode: 'fixedDay', day } };
  return card;
};

/** A card whose limit is known: owed comes from the available limit in SMS. */
export const isCardSetUp = (card) => num(card && card.creditLimit) > 0;

// ── Money moves on a card (positive = you owe more) ────────────────────────

/** How a transaction changes what you owe on this card. EMI-conversion credits move nothing (C0). */
export const cardDelta = (tx, cardId) => {
  if (!tx || tx.transferKind === 'emi_conversion') return 0;
  const amount = num(tx.amount);
  const onCard = same(tx.accountId, cardId);
  if (tx.type === 'expense') return onCard ? amount : 0;
  if (tx.type === 'income') return onCard ? -amount : 0;
  if (tx.type !== 'transfer') return 0;
  if (same(tx.toAccountId, cardId)) return -amount; // paid into the card
  if (!onCard) return 0;
  if (tx.toAccountId !== undefined && tx.toAccountId !== null) return amount; // card → elsewhere
  return tx.flow === 'in' ? -amount : amount;
};

/** A payment into the card (bank → card transfer, or the card's own "payment received"). */
export const isCardPayment = (tx, cardId) =>
  !!tx &&
  tx.type === 'transfer' &&
  tx.transferKind !== 'emi_conversion' &&
  (same(tx.toAccountId, cardId) ||
    (same(tx.accountId, cardId) &&
      (tx.toAccountId === undefined || tx.toAccountId === null) &&
      tx.flow === 'in'));

const sumDelta = (txs, cardId, fromMs, toMs, skipId) =>
  round2(
    (txs || []).reduce((s, tx) => {
      const t = txMs(tx);
      if (!(t > fromMs && t <= toMs)) return s;
      if (skipId !== undefined && skipId !== null && same(tx.id, skipId)) return s;
      return s + cardDelta(tx, cardId);
    }, 0)
  );

/** Newest available limit: from the card's SMS, or the stored one, whichever is newer. */
export const latestAvailableOf = (card, txs = [], asOf = new Date()) => {
  const limit = ms(asOf);
  let best = null;
  for (const tx of txs) {
    if (!tx || !same(tx.accountId, card.id) || !Number.isFinite(tx.availableLimit)) continue;
    const t = txMs(tx);
    if (!(t <= limit)) continue;
    if (!best || t > best.t) best = { amount: tx.availableLimit, at: tx.fullDate, sourceId: tx.id, t };
  }
  const stored = card.latestAvailable;
  if (stored && Number.isFinite(num(stored.amount)) && stored.at && ms(stored.at) <= limit) {
    const t = ms(stored.at);
    if (!best || t > best.t)
      best = { amount: num(stored.amount), at: stored.at, sourceId: stored.sourceId, t };
  }
  if (!best) return null;
  const { t: _t, ...out } = best;
  return out;
};

/** Statements on or before asOf, newest first. */
const statementsUpTo = (card, asOf) =>
  (Array.isArray(card.statements) ? card.statements : [])
    .filter((s) => s && s.date && Number.isFinite(ms(s.date)) && ms(s.date) <= ms(endOfDay(asOf)))
    .sort((a, b) => ms(b.date) - ms(a.date));

export const latestStatement = (card, asOf = new Date()) => statementsUpTo(card, asOf)[0] || null;

/**
 * cardOwed(card, txs, asOf) → { owed, source: 'limit'|'statement'|'history', asOf, available? }
 * 1. limit: creditLimit − latest available, plus moves after that SMS.
 * 2. statement: latest bill's total + moves after the statement day.
 * 3. history: the stored balance (sum of captured moves) - an estimate.
 */
export const cardOwed = (rawCard, txs = [], asOf = new Date()) => {
  const card = normalizeCard(rawCard);
  const now = ms(asOf);
  const avail = isCardSetUp(card) ? latestAvailableOf(card, txs, asOf) : null;
  if (avail) {
    const owed = round2(
      num(card.creditLimit) - avail.amount + sumDelta(txs, card.id, ms(avail.at), now, avail.sourceId)
    );
    return { owed, source: 'limit', asOf: toDate(asOf).toISOString(), available: avail };
  }
  const st = latestStatement(card, asOf);
  if (st) {
    const owed = round2(num(st.totalDue) + sumDelta(txs, card.id, ms(endOfDay(st.date)), now));
    return { owed, source: 'statement', asOf: toDate(asOf).toISOString(), statement: st };
  }
  return { owed: round2(num(card.balance)), source: 'history', asOf: toDate(asOf).toISOString() };
};

// ── Cycle and bill ──────────────────────────────────────────────────────────

/** The statement date in month (y, m) for a statement day; short months use their last day. */
const statementIn = (y, m, day) => {
  const first = new Date(y, m, 1);
  return new Date(
    first.getFullYear(),
    first.getMonth(),
    Math.min(day, lastDayOf(first.getFullYear(), first.getMonth()))
  );
};

/**
 * cycleWindow(statementDay, asOf) → { start, end }: the cycle that ends on the next statement
 * day (today when today is the statement day). start is the day after the previous one.
 */
export const cycleWindow = (statementDay, asOf = new Date()) => {
  const day = Math.min(31, Math.max(1, Math.round(num(statementDay)) || 1));
  const today = startOfDay(asOf);
  let end = statementIn(today.getFullYear(), today.getMonth(), day);
  if (end < today) end = statementIn(today.getFullYear(), today.getMonth() + 1, day);
  const prev = statementIn(end.getFullYear(), end.getMonth() - 1, day);
  const start = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1);
  return { start, end: endOfDay(end) };
};

/** Statement date that closed the cycle before asOf (from the statement day), or null. */
export const lastStatementDate = (statementDay, asOf = new Date()) => {
  if (!statementDay) return null;
  const { start } = cycleWindow(statementDay, asOf);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
};

/** Due date of a bill from the card's due rule: N days after the statement, or a fixed day after it. */
export const dueDateFor = (rawCard, statementDate) => {
  const card = normalizeCard(rawCard) || {};
  const st = startOfDay(statementDate);
  const due = card.due || DEFAULT_DUE;
  if (due.mode === 'fixedDay') {
    const day = Math.min(31, Math.max(1, Math.round(num(due.day)) || 1));
    let d = statementIn(st.getFullYear(), st.getMonth(), day);
    if (d <= st) d = statementIn(st.getFullYear(), st.getMonth() + 1, day);
    return d;
  }
  const days = Math.max(0, Math.round(num(due.days)) || DEFAULT_DUE.days);
  return new Date(st.getFullYear(), st.getMonth(), st.getDate() + days);
};

/** Tracked EMIs on this card (C2 cardEmi entries) with an instalment inside [start, end]. */
export const cardEmisIn = (card, loans = [], start, end) =>
  (loans || [])
    .filter(
      (l) =>
        l &&
        l.type === 'Loan' &&
        l.loanKind === 'cardEmi' &&
        same(l.onCardId, card.id) &&
        l.status !== 'closed'
    )
    .map((l) => {
      const before = paidCount(l, new Date(ms(start) - 1));
      const by = paidCount(l, end);
      if (by <= before) return null;
      return {
        id: l.id,
        name: l.name,
        amount: round2(num(l.emiAmount) * (by - before)),
        date: emiDate(l, by),
      };
    })
    .filter(Boolean);

/** cycleSpend → { spent, refunds, count, emiDue, emis, start, end } for the current cycle. */
export const cycleSpend = (rawCard, txs = [], asOf = new Date(), loans = []) => {
  const card = normalizeCard(rawCard);
  const { start, end } = cycleWindow(card.statementDay || 1, asOf);
  let spent = 0;
  let refunds = 0;
  let count = 0;
  for (const tx of txs || []) {
    if (!tx || !same(tx.accountId, card.id) || tx.transferKind === 'emi_conversion') continue;
    const t = txMs(tx);
    if (!(t >= ms(start) && t <= ms(end))) continue;
    if (tx.type === 'expense') {
      spent += num(tx.amount);
      count += 1;
    } else if (tx.type === 'income') refunds += num(tx.amount);
  }
  const emis = cardEmisIn(card, loans, start, end);
  const emiDue = round2(emis.reduce((s, e) => s + e.amount, 0));
  return { spent: round2(spent), refunds: round2(refunds), count, emiDue, emis, start, end };
};

/**
 * currentBill → { statement, paid, left, dueDate, daysLeft, status: 'paid'|'overdue'|'due' }
 * or null when no bill is known. paid = payments into the card after the statement day.
 */
export const currentBill = (rawCard, txs = [], asOf = new Date()) => {
  const card = normalizeCard(rawCard);
  const statement = latestStatement(card, asOf);
  if (!statement) return null;
  const from = ms(endOfDay(statement.date));
  const now = ms(asOf);
  const paid = round2(
    num(statement.paid) +
      (txs || [])
        .filter((tx) => isCardPayment(tx, card.id) && txMs(tx) > from && txMs(tx) <= now)
        .reduce((s, tx) => s + num(tx.amount), 0)
  );
  const left = round2(Math.max(0, num(statement.totalDue) - paid));
  const dueDate = statement.dueDate ? startOfDay(statement.dueDate) : dueDateFor(card, statement.date);
  const daysLeft = Math.round((ms(dueDate) - ms(startOfDay(asOf))) / DAY);
  const status = left <= 0 ? 'paid' : daysLeft < 0 ? 'overdue' : 'due';
  return { statement, paid, left, dueDate, daysLeft, status };
};

/**
 * owedParts → { billed, thisCycle, other } (sums to owed) for the bar on Card detail, only when
 * owed comes from the available limit. `other` = "EMIs & older" (EMI amount held back, older).
 */
export const owedParts = (rawCard, txs = [], asOf = new Date(), owed = cardOwed(rawCard, txs, asOf)) => {
  if (!owed || owed.source !== 'limit') return null;
  const bill = currentBill(rawCard, txs, asOf);
  const cycle = cycleSpend(rawCard, txs, asOf);
  const billed = bill ? bill.left : 0;
  const thisCycle = round2(cycle.spent - cycle.refunds);
  return { billed, thisCycle, other: round2(owed.owed - billed - thisCycle) };
};

/** Next due date for setup's "Next due" line: the due date of the last closed statement, else the next one. */
export const nextDueDate = (rawCard, asOf = new Date()) => {
  const card = normalizeCard(rawCard);
  if (!card.statementDay) return null;
  const last = lastStatementDate(card.statementDay, asOf);
  const due = dueDateFor(card, last);
  if (due >= startOfDay(asOf)) return due;
  return dueDateFor(card, toDate(cycleWindow(card.statementDay, asOf).end));
};
