/**
 * CardView.js (Phase 13 B4–B6) - pure. Text for the card rows, card detail and card setup.
 * The maths is in CardMath; this file only turns it into words.
 */
import { formatMoney } from './Format';
import {
  cardOwed,
  currentBill,
  cycleSpend,
  cycleWindow,
  isCardSetUp,
  latestAvailableOf,
  normalizeCard,
} from './CardMath';

const toDate = (d) => (d instanceof Date ? d : new Date(d));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "15 Nov" (built by hand: ICU writes "Sept" for en-GB) */
export const shortDate = (d) => `${toDate(d).getDate()} ${MONTHS[toDate(d).getMonth()]}`;
/** "Sat, 5 Dec" */
export const weekdayDate = (d) => `${DAYS[toDate(d).getDay()]}, ${shortDate(d)}`;

/** Where "You owe" came from (B5 summary). */
export const owedSourceLine = (card, owed) => {
  if (!owed) return '';
  if (owed.source === 'limit')
    return `Limit ${formatMoney(card.creditLimit)} − available ${formatMoney(owed.available.amount)} (SMS, ${shortDate(owed.available.at)})`;
  if (owed.source === 'statement') return `From bill of ${shortDate(owed.statement.date)}`;
  return 'Estimate from SMS history';
};

/** History balance below zero: the card only saw payments for older spends. */
export const overpaidLine = (owed) =>
  owed && owed.source === 'history' && owed.owed < 0
    ? `Looks overpaid by ${formatMoney(-owed.owed)}. Set up the card to fix`
    : null;

/** Badge on the bill card: { label, tone: 'warn'|'danger'|'income' }. */
export const billBadge = (bill) => {
  if (!bill) return null;
  if (bill.status === 'paid') return { label: 'Paid', tone: 'income' };
  if (bill.status === 'overdue') return { label: 'Overdue', tone: 'danger' };
  if (bill.daysLeft === 0) return { label: 'Due today', tone: 'warn' };
  return { label: `Due in ${bill.daysLeft} day${bill.daysLeft === 1 ? '' : 's'}`, tone: 'warn' };
};

/**
 * Accounts row (B6). Set-up card: { setUp: true, cycle: 'This cycle ₹X', pay: { text, warn } | null,
 * owed }. Not set up: { setUp: false, sub: 'Available ₹Y · add limit to see what you owe' }.
 */
export const cardRowText = (rawCard, txs = [], asOf = new Date(), loans = []) => {
  const card = normalizeCard(rawCard);
  if (!isCardSetUp(card)) {
    const avail = latestAvailableOf(card, txs, asOf);
    return {
      setUp: false,
      sub: avail ? `Available ${formatMoney(avail.amount)} · add limit` : 'Add limit to see what you owe',
    };
  }
  const owed = cardOwed(card, txs, asOf);
  const parts = [];
  if (card.statementDay) {
    const c = cycleSpend(card, txs, asOf, loans);
    parts.push(`This cycle ${formatMoney(c.spent - c.refunds)}`);
  }
  const bill = currentBill(card, txs, asOf);
  const pay =
    bill && bill.left > 0
      ? {
          text:
            bill.status === 'overdue'
              ? `Overdue ${formatMoney(bill.left)}`
              : `Pay ${formatMoney(bill.left)} by ${shortDate(bill.dueDate)}`,
          warn: bill.status === 'overdue' || bill.daysLeft <= 5,
          danger: bill.status === 'overdue',
        }
      : null;
  return { setUp: true, cycle: parts.join(' · '), pay, owed: owed.owed, source: owed.source };
};

/** "this cycle" or "on bill of 15 Nov" for a card transaction (B5 "On this card"). */
export const cycleTag = (card, tx, asOf = new Date()) => {
  if (!card.statementDay || !tx || !tx.fullDate) return null;
  const current = cycleWindow(card.statementDay, asOf);
  const t = new Date(tx.fullDate);
  if (t >= current.start) return 'this cycle';
  return `on bill of ${shortDate(cycleWindow(card.statementDay, t).end)}`;
};

/**
 * Card setup "What you owe now" (B4) for a draft limit: { available, owed, note }.
 * note explains a stored balance that differs from the new figure by more than ₹1.
 */
export const setupOwedBox = (rawCard, draftLimit, txs = [], asOf = new Date()) => {
  const limit = Number(draftLimit);
  const card = { ...normalizeCard(rawCard), creditLimit: Number.isFinite(limit) && limit > 0 ? limit : 0 };
  const avail = latestAvailableOf(card, txs, asOf);
  if (!card.creditLimit || !avail) return { available: avail, owed: null, note: null };
  const owed = cardOwed(card, txs, asOf);
  const stored = Number(rawCard.balance) || 0;
  let note = null;
  if (Math.abs(owed.owed - stored) > 1) {
    note =
      stored < 0
        ? `The app currently shows this card as ${formatMoney(-stored)} in credit, because it only saw your payments, not the older spends they paid for. Saving fixes it.`
        : `The app currently shows ${formatMoney(stored)} owed, added up from SMS it saw. Saving sets it to ${formatMoney(owed.owed)}.`;
  }
  return { available: avail, owed: owed.owed, note };
};
