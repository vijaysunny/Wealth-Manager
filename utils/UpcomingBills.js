/**
 * UpcomingBills (Phase 14 E2) - pure. Everything due in the next `days` days, from:
 *  1. credit card bills (CardMath.currentBill: what is left and the due date),
 *  2. loan EMIs (LoanLedger nextEmi; card EMIs are inside the card bill),
 *  3. your repeating entries (RecurringEngine),
 *  4. saved bills (detected in SMS and confirmed, or added by hand),
 *  5. autopay mandates that are paused (shown apart).
 */
import { currentBill, isCardSetUp, isCardPayment } from './CardMath';
import { ledger } from './LoanLedger';
import { isCardEmi } from './LoanCalculator';
import { fromKey, toKey, advanceDue } from './RecurringEngine';
import { nextAfter, detect } from './RecurringDetect';
import { payeeKey } from './PayeeMatch';
import { isPausedNow, mandateMatches } from './Mandates';
import { shortAccountName } from './TransactionList';

const DAY = 24 * 60 * 60 * 1000;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const dayStart = (d) => {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
};
const dayLabel = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const CADENCE_LABEL = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

/** [from, to]: today and today + days − 1 (whole days). */
export const windowOf = (asOf = new Date(), days = 30) => {
  const from = dayStart(asOf);
  return { from, to: new Date(from.getFullYear(), from.getMonth(), from.getDate() + days - 1, 23, 59, 59) };
};

/** The bank a card bill is usually paid from: the latest payment into the card. */
export const cardPaidFrom = (card, txs = []) => {
  const last = (txs || [])
    .filter((t) => isCardPayment(t, card.id) && t.toAccountId != null && t.accountId != null)
    .sort((a, b) => new Date(b.fullDate) - new Date(a.fullDate))[0];
  return last ? last.accountId : null;
};

/**
 * The next date of a saved bill on or after today: after its latest debit when one is known,
 * else from its stored next date, rolled forward past days already gone.
 */
export const billNext = (bill, txs = [], asOf = new Date()) => {
  const today = dayStart(asOf);
  const paid = bill.key
    ? (txs || [])
        .filter((t) => t && t.type === 'expense' && payeeKey(t) === bill.key)
        .map((t) => dayStart(t.fullDate))
        .sort((a, b) => b - a)[0]
    : null;
  const step = (d) => nextAfter(d, bill.cadence, bill.anchorDay || d.getDate(), bill.stepDays || 7);
  let next = bill.nextDate ? dayStart(bill.nextDate) : today;
  if (paid && step(paid) > next) next = step(paid);
  for (let i = 0; next < today && i < 600; i += 1) next = step(next);
  return next;
};

/** Covered by a loan or a card already in the list (same words in the name). */
const coveredBy = (name, loans, cards) =>
  [...loans, ...cards].some((a) => a.name && mandateMatches({ payee: a.name }, name));

/**
 * Suggestions for "Review N found": detected series not saved, not dismissed, not a loan or card.
 */
export const suggestions = ({
  txs = [],
  bills = [],
  dismissed = [],
  mandates = [],
  accounts = [],
  asOf = new Date(),
} = {}) => {
  const loans = accounts.filter((a) => a.type === 'Loan');
  const cards = accounts.filter((a) => a.type === 'Credit Card');
  return detect(txs, { dismissed, mandates, skip: bills.map((b) => b.key).filter(Boolean), asOf }).filter(
    (s) => !coveredBy(s.name, loans, cards)
  );
};

/**
 * { items, paused, warnings, total, from, to, afterBank }
 * items: [{ id, kind: 'card'|'loan'|'recurring'|'bill', name, date, amount, sub, payFromId, overdue,
 *          reminderDate?, ref }] sorted by date then name.
 * afterBank: { account, balance } for the bank most of these are paid from (null without a bank).
 */
export const upcoming = ({
  accounts = [],
  txs = [],
  recurring = [],
  bills = [],
  mandates = [],
  asOf = new Date(),
  days = 30,
} = {}) => {
  const { from, to } = windowOf(asOf, days);
  const byId = Object.fromEntries(accounts.map((a) => [String(a.id), a]));
  const nameOf = (id) => {
    const a = byId[String(id)];
    return a ? shortAccountName(a.name, a.last4) : null;
  };
  const items = [];
  const warnings = [];
  const inWindow = (d) => d <= to;
  const cards = accounts.filter((a) => a.type === 'Credit Card');
  const loans = accounts.filter((a) => a.type === 'Loan' && !isCardEmi(a) && a.status !== 'closed');

  for (const card of cards) {
    if (!isCardSetUp(card)) {
      warnings.push({ kind: 'cardNotSetUp', card });
      continue;
    }
    const bill = currentBill(card, txs, asOf);
    if (!bill || !(bill.left > 0) || !inWindow(bill.dueDate)) continue;
    const remind = card.remindDue ? new Date(dayStart(bill.dueDate).getTime() - 3 * DAY) : null;
    items.push({
      id: `card_${card.id}`,
      kind: 'card',
      name: `${shortAccountName(card.name, card.last4)} bill`,
      date: dayStart(bill.dueDate).toISOString(),
      amount: bill.left,
      sub: ['From the statement', remind && remind >= from ? `reminder on ${dayLabel(remind)}` : null]
        .filter(Boolean)
        .join(' · '),
      payFromId: cardPaidFrom(card, txs),
      overdue: bill.status === 'overdue',
      ref: { cardId: card.id },
    });
  }

  for (const loan of loans) {
    const next = ledger(loan, txs, asOf).nextEmi;
    if (!next || !inWindow(next.date)) continue;
    const l = ledger(loan, txs, asOf);
    items.push({
      id: `loan_${loan.id}`,
      kind: 'loan',
      name: `${loan.name} EMI`,
      date: dayStart(next.date).toISOString(),
      amount: next.amount,
      sub: ['Auto-debit', nameOf(loan.payFromId), l.monthsLeft != null ? `${l.monthsLeft} left` : null]
        .filter(Boolean)
        .join(' · '),
      payFromId: loan.payFromId ?? null,
      overdue: dayStart(next.date) < from,
      ref: { loanId: loan.id },
    });
  }

  for (const entry of recurring) {
    if (!entry || entry.type !== 'expense' || entry.active === false || !entry.nextDue) continue;
    const acc = accounts.find((a) => a.name === entry.account);
    let due = fromKey(entry.nextDue);
    for (let i = 0; due <= to && i < 60; i += 1, due = advanceDue(entry, due)) {
      if (due < from) continue;
      items.push({
        id: `rec_${entry.id}_${toKey(due)}`,
        kind: 'recurring',
        name: entry.title || entry.category || 'Repeating entry',
        date: due.toISOString(),
        amount: num(entry.amount),
        sub: `${entry.frequency || 'Repeats'} · added by you`,
        payFromId: acc ? acc.id : null,
        overdue: false,
        ref: { recurringId: entry.id },
      });
    }
  }

  const paused = [];
  for (const m of mandates) if (isPausedNow(m, asOf)) paused.push(m);
  const pausedFor = (name) => paused.find((m) => mandateMatches(m, name));

  for (const bill of bills) {
    if (coveredBy(bill.name, loans, cards)) continue;
    const p = pausedFor(bill.name);
    let d = billNext(bill, txs, asOf);
    const step = (x) => nextAfter(x, bill.cadence, bill.anchorDay || x.getDate(), bill.stepDays || 7);
    for (let i = 0; d <= to && i < 60; i += 1, d = step(d)) {
      if (p && (!p.pausedUntil || d <= new Date(p.pausedUntil))) continue;
      items.push({
        id: `bill_${bill.id}_${toKey(d)}`,
        kind: 'bill',
        name: bill.name,
        date: d.toISOString(),
        amount: num(bill.amount),
        sub: [
          CADENCE_LABEL[bill.cadence] || 'Repeats',
          bill.source === 'detected' ? 'found in SMS' : 'added by you',
          bill.source === 'detected' && bill.count ? `${bill.count} times so far` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        payFromId: bill.accountId ?? null,
        overdue: false,
        reminderDate: bill.reminder ? new Date(d.getTime() - 2 * DAY).toISOString() : null,
        ref: { billId: bill.id },
      });
    }
  }

  items.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const total = round2(items.reduce((s, i) => s + i.amount, 0));

  // the bank most of these are paid from (else the bank with the most debits)
  const banks = accounts.filter((a) => a.type === 'Bank Account');
  const uses = (id) => items.filter((i) => i.payFromId != null && String(i.payFromId) === String(id)).length;
  const debits = (id) =>
    txs.filter((t) => t && t.type === 'expense' && String(t.accountId) === String(id)).length;
  const bank = banks.slice().sort((a, b) => uses(b.id) - uses(a.id) || debits(b.id) - debits(a.id))[0];
  const afterBank = bank
    ? {
        account: bank,
        balance: round2(
          num(bank.balance) -
            items.filter((i) => String(i.payFromId) === String(bank.id)).reduce((s, i) => s + i.amount, 0)
        ),
      }
    : null;

  return {
    items,
    paused: paused.map((m) => ({
      id: `mandate_${m.key}`,
      name: `${m.payee} autopay`,
      amount: m.amount,
      sub: [
        m.pausedUntil ? `Paused until ${dayLabel(m.pausedUntil)}` : 'Paused',
        'from the mandate SMS',
      ].join(' · '),
    })),
    warnings,
    total,
    from,
    to,
    afterBank,
  };
};

/** The first bill due (Home: "Next bill: Axis Card ₹3,914 · 5 Dec"). */
export const nextBill = (result) => (result?.items || [])[0] || null;

/**
 * A bill added by hand: { name, amount, cadence, nextDate, accountId?, reminder? } → a saved bill.
 * The next due date can't be in the past.
 */
export const newBill = (
  { name, amount, cadence = 'monthly', nextDate, accountId = null, reminder = false },
  now = new Date()
) => {
  const n = String(name || '').trim();
  if (!n) throw new Error('Enter a name.');
  if (!(num(amount) > 0)) throw new Error('Enter an amount.');
  if (!CADENCE_LABEL[cadence]) throw new Error('Choose how often.');
  const due = nextDate ? dayStart(nextDate) : null;
  if (!due || due < dayStart(now)) throw new Error('Choose the next due date (today or later).');
  return {
    id: `bill_${now.getTime()}`,
    key: payeeKey({ merchant: n, type: 'expense' }) || null,
    name: n,
    amount: round2(num(amount)),
    cadence,
    anchorDay: due.getDate(),
    stepDays: cadence === 'weekly' ? 7 : null,
    nextDate: due.toISOString(),
    accountId,
    source: 'manual',
    reminder: !!reminder,
  };
};
