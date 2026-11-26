/**
 * People (Phase 14 E4) - pure. Who owes whom.
 * people: [{ id, name, payeeKeys: [], upiId? }]
 * ious:   [{ id, personId, amount, direction: 'owedToMe' | 'iOwe', txId?, note, date, settledAt?, settledByTxId? }]
 */
import { payeeKey, payeeName } from './PayeeMatch';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const oldestFirst = (a, b) =>
  String(a.date || '').localeCompare(String(b.date || '')) || String(a.id).localeCompare(String(b.id));

export const isOpen = (iou) => !!iou && !iou.settledAt;
export const openFor = (personId, ious = []) =>
  ious.filter((i) => isOpen(i) && String(i.personId) === String(personId));

/** { owedToMe, iOwe, net } over open IOUs (net > 0: they owe you). */
export const balanceOf = (list = []) => {
  let owedToMe = 0;
  let iOwe = 0;
  for (const i of list)
    if (isOpen(i)) {
      if (i.direction === 'iOwe') iOwe += num(i.amount);
      else owedToMe += num(i.amount);
    }
  return { owedToMe: round2(owedToMe), iOwe: round2(iOwe), net: round2(owedToMe - iOwe) };
};

/** Totals and a row per person with something open (biggest first), items newest first. */
export const peopleSummary = (people = [], ious = []) => {
  const rows = people
    .map((person) => {
      const items = openFor(person.id, ious).sort((a, b) => oldestFirst(b, a));
      return { person, items, ...balanceOf(items) };
    })
    .filter((r) => r.items.length)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.person.name.localeCompare(b.person.name));
  return { ...balanceOf(ious), rows };
};

/** "Amazon · 12 Nov" / "Dinner, trip fuel · 2 items" */
export const itemsLine = (items = []) => {
  if (!items.length) return '';
  if (items.length === 1)
    return [
      items[0].note,
      new Date(items[0].date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    ]
      .filter(Boolean)
      .join(' · ');
  return `${items
    .slice(0, 2)
    .map((i) => i.note)
    .filter(Boolean)
    .join(', ')} · ${items.length} items`;
};

/**
 * Settle `amount` of what a person owes you, oldest first. A part-paid IOU is split: the paid piece
 * is settled, the rest stays open. Returns { ious, settled, left } (left: amount not used).
 */
export const settle = (
  ious = [],
  personId,
  amount,
  { date = new Date().toISOString(), txId = null } = {}
) => {
  let left = round2(num(amount));
  const settled = [];
  const open = openFor(personId, ious)
    .filter((i) => i.direction !== 'iOwe')
    .sort(oldestFirst);
  const patch = new Map();
  const extra = [];
  for (const i of open) {
    if (left <= 0.005) break;
    const amt = num(i.amount);
    const mark = { settledAt: date, ...(txId != null ? { settledByTxId: txId } : {}) };
    if (amt <= left + 0.005) {
      patch.set(i.id, { ...i, ...mark });
      left = round2(left - amt);
      settled.push(i.id);
    } else {
      patch.set(i.id, { ...i, amount: left, ...mark });
      extra.push({ ...i, id: `${i.id}_rest_${Date.parse(date) || 0}`, amount: round2(amt - left) });
      settled.push(i.id);
      left = 0;
    }
  }
  return { ious: [...ious.map((i) => patch.get(i.id) || i), ...extra], settled, left: round2(left) };
};

/** Mark one IOU settled by hand (either direction). */
export const markSettled = (ious = [], id, date = new Date().toISOString()) =>
  ious.map((i) => (String(i.id) === String(id) ? { ...i, settledAt: date } : i));
/** Undo a hand settle. */
export const unsettle = (ious = [], id) =>
  ious.map((i) => {
    if (String(i.id) !== String(id)) return i;
    const { settledAt, settledByTxId, ...rest } = i; // eslint-disable-line no-unused-vars
    return rest;
  });

const words = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
/** "RAVI K" starts with "Ravi"; "Ravindra" does not (whole words). */
export const nameMatches = (person, text) => {
  const p = words(person?.name);
  const t = words(text);
  return p.length > 0 && t.length >= p.length && p.every((w, i) => t[i] === w);
};

const creditName = (tx) => tx.counterparty || payeeName(tx) || tx.title || '';

/**
 * Credits that may be a person paying you back: the payee is one the owner confirmed for them
 * before, or the sender's name starts with theirs; never on amount alone. The amount must be at
 * most what they owe, and the credit no older than their oldest open item.
 * Returns [{ tx, person, owed }], newest first, one person per credit.
 */
export const settleSuggestions = (txs = [], people = [], ious = []) => {
  const out = [];
  const owing = people
    .map((person) => {
      const open = openFor(person.id, ious).filter((i) => i.direction !== 'iOwe');
      return { person, owed: balanceOf(open).owedToMe, since: open.map((i) => i.date).sort()[0] };
    })
    .filter((x) => x.owed > 0);
  if (!owing.length) return out;
  for (const tx of txs) {
    if (!tx || tx.type !== 'income' || tx.kind === 'settlement' || tx.refundOf || tx.settleDismissed)
      continue;
    const key = payeeKey(tx);
    const hit = owing.find(
      (o) =>
        num(tx.amount) <= o.owed + 0.005 &&
        String(tx.fullDate || '') >= String(o.since || '') &&
        ((key && (o.person.payeeKeys || []).includes(key)) || nameMatches(o.person, creditName(tx)))
    );
    if (hit) out.push({ tx, person: hit.person, owed: hit.owed });
  }
  return out.sort((a, b) => String(b.tx.fullDate).localeCompare(String(a.tx.fullDate)));
};

/** The person with this credit's payee learned (the first time the owner confirms). */
export const learnPayee = (person, tx) => {
  const key = payeeKey(tx);
  if (!key || (person.payeeKeys || []).includes(key)) return person;
  return { ...person, payeeKeys: [...(person.payeeKeys || []), key] };
};

/** The changes that turn a credit into a settlement: not income, not in reports. */
export const settlementChanges = (personId) => ({
  kind: 'settlement',
  excludeFromReports: true,
  settledPersonId: personId,
});

/** "Hi Ravi, ₹500 for Amazon (12 Nov). UPI: me@bank" */
export const remindText = (person, items = [], upiId, fmt = (n) => `₹${n}`) => {
  const owed = items.filter((i) => isOpen(i) && i.direction !== 'iOwe');
  const day = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const parts = owed.map((i) => `${fmt(num(i.amount))} for ${i.note || 'this'} (${day(i.date)})`);
  const total = balanceOf(owed).owedToMe;
  const first = String(person?.name || '').split(/\s+/)[0];
  return [
    `Hi ${first}, ${parts.join(', ')}${owed.length > 1 ? `. Total ${fmt(total)}` : ''}.`,
    upiId ? `UPI: ${upiId}` : null,
  ]
    .filter(Boolean)
    .join(' ');
};

/** A new person: trimmed name, no duplicates (case-insensitive). */
export const newPerson = (people = [], name, now = Date.now()) => {
  const n = String(name || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!n) throw new Error('Enter a name.');
  if (people.some((p) => p.name.toLowerCase() === n.toLowerCase()))
    throw new Error(`${n} is already in People.`);
  return { id: `person_${now}`, name: n, payeeKeys: [] };
};

/** A hand-entered IOU ("I owe" or "owes me"). */
export const newIou = ({ personId, amount, direction = 'iOwe', note = '', date }, now = Date.now()) => {
  if (!personId) throw new Error('Choose a person.');
  if (!(num(amount) > 0)) throw new Error('Enter an amount.');
  return {
    id: `iou_${now}`,
    personId: String(personId),
    amount: round2(num(amount)),
    direction: direction === 'owedToMe' ? 'owedToMe' : 'iOwe',
    note: String(note || '').trim(),
    date: date || new Date(now).toISOString(),
  };
};
