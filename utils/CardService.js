/**
 * CardService.js (Phase 13 B4/B5): loads and saves card data for Card setup and Card detail.
 * A stored balance changes only on Save in Card setup, after the "What you owe now" box has
 * shown the owner the new figure (never silently).
 */
import Storage, { updateAccount } from '../data/Storage';
import { getAll } from '../data/TransactionRepo';
import { cardOwed, currentBill, latestAvailableOf, normalizeCard } from './CardMath';
import { scheduleBillReminder } from './CardReminders';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const loadAccounts = async () => JSON.parse((await Storage.getItem('user_wealth_accounts')) || '[]');

/** { card, accounts, txs, loans } or { card: null } when the card no longer exists. */
export const loadCard = async (cardId) => {
  const accounts = await loadAccounts();
  const raw = accounts.find((a) => String(a.id) === String(cardId) && a.type === 'Credit Card');
  const txs = await getAll();
  return {
    card: raw ? normalizeCard(raw) : null,
    accounts,
    txs,
    loans: accounts.filter((a) => a.type === 'Loan'),
  };
};

/** Pure: the validation message for the setup form, or null. */
export const setupError = ({ creditLimit, statementDay, due }, available) => {
  const limit = Number(creditLimit);
  if (!Number.isFinite(limit) || limit <= 0) return 'Enter the credit limit from your statement.';
  if (available && limit < available.amount)
    return `The limit can't be less than the available limit in SMS (${available.amount}).`;
  const day = Number(statementDay);
  if (!Number.isInteger(day) || day < 1 || day > 31) return 'Pick the statement date (1–31).';
  if (due && due.mode === 'fixedDay' && !(Number.isInteger(due.day) && due.day >= 1 && due.day <= 31))
    return 'The due day must be from 1 to 31.';
  if (
    due &&
    due.mode === 'afterStatement' &&
    !(Number.isInteger(due.days) && due.days >= 1 && due.days <= 60)
  )
    return 'Days after the statement must be from 1 to 60.';
  return null;
};

/**
 * Save card setup. Returns { card, owed, balanceChanged }. The balance is rewritten (with a
 * balanceSetAt stamp) only when the new "owed" differs from it by more than ₹1.
 */
export const saveCardSetup = async (cardId, values, { now = new Date() } = {}) => {
  const { card, txs } = await loadCard(cardId);
  if (!card) throw new Error('This card no longer exists.');
  const available = latestAvailableOf(card, txs, now);
  const error = setupError(values, available);
  if (error) throw new Error(error);
  const next = {
    ...card,
    creditLimit: round2(values.creditLimit),
    statementDay: Number(values.statementDay),
    due: values.due,
    remindDue: !!values.remindDue,
    ...(available ? { latestAvailable: available } : {}),
  };
  const owed = cardOwed(next, txs, now);
  const changes = {
    creditLimit: next.creditLimit,
    statementDay: next.statementDay,
    due: next.due,
    remindDue: next.remindDue,
    ...(available ? { latestAvailable: available } : {}),
  };
  const balanceChanged = owed.source !== 'history' && Math.abs(owed.owed - (Number(card.balance) || 0)) > 1;
  if (balanceChanged) {
    changes.balance = owed.owed;
    changes.balanceSetAt = now.toISOString();
  }
  await updateAccount(card.id, changes);
  const saved = { ...next, ...changes };
  if (saved.remindDue)
    await scheduleBillReminder(saved, currentBill(saved, txs, now), { ask: true }).catch(() => null);
  else await scheduleBillReminder(saved, null).catch(() => null);
  return { card: saved, owed, balanceChanged };
};

/** Add or replace (same statement date) a bill. statement: { date, totalDue, minDue, dueDate, source }. */
export const saveCardStatement = async (cardId, statement) => {
  const total = Number(statement.totalDue);
  const min = Number(statement.minDue || 0);
  if (!Number.isFinite(total) || total < 0) throw new Error('Enter the total due.');
  if (!Number.isFinite(min) || min < 0 || min > total)
    throw new Error('The minimum must be between 0 and the total.');
  const { card, txs } = await loadCard(cardId);
  if (!card) throw new Error('This card no longer exists.');
  const day = new Date(statement.date).toDateString();
  const entry = {
    date: new Date(statement.date).toISOString(),
    totalDue: round2(total),
    minDue: round2(min),
    ...(statement.dueDate ? { dueDate: new Date(statement.dueDate).toISOString() } : {}),
    source: statement.source || 'manual',
    paid: 0,
  };
  const statements = [
    ...(card.statements || []).filter((s) => new Date(s.date).toDateString() !== day),
    entry,
  ].sort((a, b) => new Date(a.date) - new Date(b.date));
  await updateAccount(card.id, { statements });
  const saved = { ...card, statements };
  if (saved.remindDue) await scheduleBillReminder(saved, currentBill(saved, txs)).catch(() => null);
  return saved;
};

/** Turn on "Remind me" for this card and schedule the bill reminder. Returns the date or null. */
export const remindCardBill = async (cardId) => {
  const { card, txs } = await loadCard(cardId);
  if (!card) throw new Error('This card no longer exists.');
  await updateAccount(card.id, { remindDue: true });
  return scheduleBillReminder({ ...card, remindDue: true }, currentBill(card, txs), { ask: true });
};

/** Catch-up: re-schedule every card's bill reminder (a payment may have cleared the bill). */
export const syncCardReminders = async (now = new Date()) => {
  const accounts = await loadAccounts();
  const cards = accounts.filter((a) => a.type === 'Credit Card' && a.remindDue);
  if (!cards.length) return 0;
  const txs = await getAll();
  for (const c of cards)
    await scheduleBillReminder(c, currentBill(normalizeCard(c), txs, now)).catch(() => null);
  return cards.length;
};
