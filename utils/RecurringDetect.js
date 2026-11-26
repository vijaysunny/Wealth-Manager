/**
 * RecurringDetect (Phase 14 E2) - pure. Finds bills and subscriptions in past expenses.
 * A series: one payee (payeeKey), ≥ 3 debits (or 2 plus an active autopay mandate), every gap
 * monthly 26–35 days, weekly 6–8 or yearly 350–380, amounts within ±10 % of the middle one
 * (exact for EMIs). Loan payments, transfers, refunds and split-for-others rows never count.
 */
import { payeeKey, payeeName } from './PayeeMatch';
import { mandateMatches } from './Mandates';

const DAY = 24 * 60 * 60 * 1000;
const CADENCES = [
  { cadence: 'weekly', min: 6, max: 8 },
  { cadence: 'monthly', min: 26, max: 35 },
  { cadence: 'yearly', min: 350, max: 380 },
];
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const lastDayOf = (y, m) => new Date(y, m + 1, 0).getDate();
const isEmi = (tx) => /\b(emi|loan)\b/i.test(`${tx.category || ''} ${tx.title || ''}`);

/** The same day `months` later, clamped to the month's end (31st → 30th / 28th). */
export const addMonths = (date, months, anchorDay = date.getDate()) => {
  const y = date.getFullYear();
  const m = date.getMonth() + months;
  const target = new Date(y, m, 1);
  return new Date(
    target.getFullYear(),
    target.getMonth(),
    Math.min(anchorDay, lastDayOf(target.getFullYear(), target.getMonth()))
  );
};

/** The date after `date` for a cadence (monthly/yearly keep the anchor day). */
export const nextAfter = (date, cadence, anchorDay = date.getDate(), stepDays = 7) => {
  if (cadence === 'monthly') return addMonths(date, 1, anchorDay);
  if (cadence === 'yearly') return addMonths(date, 12, anchorDay);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + Math.round(stepDays));
};

/** A month-end debit (the 28th of Feb, the 30th of a 30-day month) counts as day 31. */
const anchorOf = (dates) =>
  Math.round(
    median(dates.map((d) => (d.getDate() === lastDayOf(d.getFullYear(), d.getMonth()) ? 31 : d.getDate())))
  );

const usable = (tx) =>
  tx &&
  tx.type === 'expense' &&
  !tx.deleted &&
  !tx.loanLink &&
  !tx.refundOf &&
  !(Array.isArray(tx.splits) && tx.splits.length && tx.splits.every((p) => p.personId));

/**
 * One series from a payee's debits (oldest first), or null.
 * { key, name, cadence, count, amount, lastDate, nextDate, anchorDay, stepDays, accountId,
 *   category, confidence, txIds }
 */
export const seriesOf = (key, rows, { mandated = false } = {}) => {
  if (rows.length < (mandated ? 2 : 3)) return null;
  const dates = rows.map((r) => dayStart(new Date(r.fullDate)));
  const gaps = dates.slice(1).map((d, i) => Math.round((d - dates[i]) / DAY));
  const type = CADENCES.find((c) => gaps.every((g) => g >= c.min && g <= c.max));
  if (!type) return null;
  const amounts = rows.map((r) => num(r.amount));
  const mid = median(amounts);
  if (!(mid > 0)) return null;
  const spread = Math.max(...amounts.map((a) => Math.abs(a - mid) / mid));
  if (rows.some(isEmi) ? spread > 0.0001 : spread > 0.1 + 1e-9) return null;
  const last = rows[rows.length - 1];
  const lastDate = dates[dates.length - 1];
  const anchorDay = anchorOf(dates);
  const stepDays = median(gaps);
  const confidence = round2(Math.min(1, (rows.length + (mandated ? 1 : 0)) / 6) * (1 - spread));
  return {
    key,
    name: payeeName(last) || last.title || last.category,
    cadence: type.cadence,
    count: rows.length,
    amount: num(last.amount),
    lastDate: lastDate.toISOString(),
    nextDate: nextAfter(lastDate, type.cadence, anchorDay, stepDays).toISOString(),
    anchorDay,
    stepDays,
    accountId: last.accountId ?? null,
    category: last.category || null,
    confidence,
    mandated,
    txIds: rows.map((r) => r.id),
  };
};

/**
 * Series found in `txs`. opts: dismissed (payee keys: "Not a bill"), mandates (active ones let
 * 2 debits count), skip (keys already saved as bills or covered elsewhere).
 * A series whose next date is long past (more than two gaps ago) has stopped and is left out.
 */
export const detect = (txs = [], { dismissed = [], mandates = [], skip = [], asOf = new Date() } = {}) => {
  const groups = new Map();
  for (const tx of txs) {
    if (!usable(tx)) continue;
    const key = payeeKey(tx);
    if (!key || dismissed.includes(key) || skip.includes(key)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }
  const out = [];
  for (const [key, rows] of groups) {
    rows.sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate));
    const name = payeeName(rows[rows.length - 1]) || rows[0].title;
    const mandated = mandates.some((m) => m.status === 'active' && mandateMatches(m, name));
    const s = seriesOf(key, rows, { mandated });
    if (!s) continue;
    const stale = new Date(s.nextDate).getTime() + 2 * s.stepDays * DAY < asOf.getTime();
    if (!stale) out.push(s);
  }
  return out.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
};

/** A saved bill from a series (or a hand-made one). */
export const billFromSeries = (s, now = Date.now()) => ({
  id: `bill_${now}`,
  key: s.key,
  name: s.name,
  amount: s.amount,
  cadence: s.cadence,
  anchorDay: s.anchorDay,
  stepDays: s.stepDays,
  nextDate: s.nextDate,
  accountId: s.accountId,
  category: s.category,
  source: 'detected',
  count: s.count,
  reminder: false,
});
