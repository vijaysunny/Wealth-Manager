/**
 * RecurringEngine.js
 * Auto-processes recurring transactions on their due dates.
 * Call processRecurringTransactions() on app startup.
 *
 * Each entry stores `nextDue` ('YYYY-MM-DD', local). On every run ALL due dates up
 * to today are generated (catch-up) and nextDue advances along the schedule, never
 * to "today". Month-based schedules stay anchored to `dayOfMonth` and clamp to the
 * last day of short months (31 → Feb 28/29), and weekly entries honour `weekday`.
 */

import AsyncStorage from '../data/Storage';
import { saveWithDedup } from './DeduplicationEngine';

const LAST_RUN_KEY = 'recurring_last_run';
const MAX_CATCH_UP = 1000; // safety cap per entry per run

// ── Date helpers (local calendar days, held at noon to dodge DST edges) ───

const pad = (n) => String(n).padStart(2, '0');
export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
};
const atNoon = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12, 0, 0);

/** Day `day` of month `m` in year `y`, clamped to the month's last day. m may overflow. */
const clampDate = (y, m, day) => {
  const base = new Date(y, m, 1);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  return new Date(base.getFullYear(), base.getMonth(), Math.min(day, last), 12, 0, 0);
};

const domOf = (entry) => Math.min(31, Math.max(1, parseInt(entry.dayOfMonth, 10) || 1));

// ── Schedule maths (pure) ─────────────────────────────────────────────────

/** First scheduled date on or after `from`. */
export const firstDueOnOrAfter = (entry, from) => {
  const f = atNoon(from);
  const dom = domOf(entry);
  switch (entry.frequency) {
    case 'Daily':
      return f;
    case 'Weekly': {
      const wd = Number.isInteger(entry.weekday) ? entry.weekday : f.getDay();
      return addDays(f, (wd - f.getDay() + 7) % 7);
    }
    case 'Yearly': {
      const month = Number.isInteger(entry.month) ? entry.month : f.getMonth();
      const c = clampDate(f.getFullYear(), month, dom);
      return toKey(c) >= toKey(f) ? c : clampDate(f.getFullYear() + 1, month, dom);
    }
    default: {
      // Monthly, Quarterly
      const c = clampDate(f.getFullYear(), f.getMonth(), dom);
      return toKey(c) >= toKey(f) ? c : clampDate(f.getFullYear(), f.getMonth() + 1, dom);
    }
  }
};

/** The scheduled date after `due`, anchored to dayOfMonth (not to the previous, possibly clamped, date). */
export const advanceDue = (entry, due) => {
  const dom = domOf(entry);
  switch (entry.frequency) {
    case 'Daily':
      return addDays(due, 1);
    case 'Weekly':
      return addDays(due, 7);
    case 'Quarterly':
      return clampDate(due.getFullYear(), due.getMonth() + 3, dom);
    case 'Yearly':
      return clampDate(due.getFullYear() + 1, due.getMonth(), dom);
    default:
      return clampDate(due.getFullYear(), due.getMonth() + 1, dom);
  }
};

/** nextDue for a brand-new or edited entry. */
export const initialNextDue = (entry, today = new Date()) => toKey(firstDueOnOrAfter(entry, today));

/**
 * All due dates up to and including `today`, plus the new nextDue.
 * Requires entry.nextDue (see migrateEntry).
 */
export const dueDatesUpTo = (entry, today) => {
  const limit = toKey(today);
  const dates = [];
  let due = fromKey(entry.nextDue);
  while (toKey(due) <= limit && dates.length < MAX_CATCH_UP) {
    dates.push(due);
    due = advanceDue(entry, due);
  }
  return { dates, nextDue: toKey(due) };
};

/**
 * Give an old-format entry (no nextDue) a nextDue derived from lastProcessed, else
 * the app's last recurring run, else its creation time (entry.id), else today.
 */
export const migrateEntry = (entry, today = new Date(), lastRunStr = null) => {
  if (entry.nextDue) return entry;
  const created = Number(entry.id) > 1e12 ? new Date(Number(entry.id)) : null;
  const anchorSrc = entry.lastProcessed || lastRunStr || (created && !isNaN(created) ? created : null);
  const anchor = anchorSrc ? new Date(anchorSrc) : null;
  const valid = anchor && !isNaN(anchor) && anchor <= today;

  const out = { ...entry };
  if (out.frequency === 'Weekly' && !Number.isInteger(out.weekday)) {
    out.weekday = (valid ? anchor : today).getDay();
  }
  if (out.frequency === 'Yearly' && !Number.isInteger(out.month)) {
    out.month = (valid ? anchor : today).getMonth();
  }
  // Processed through the anchor day already → start from the day after it
  const from = valid ? addDays(atNoon(anchor), entry.lastProcessed || lastRunStr ? 1 : 0) : today;
  out.nextDue = toKey(firstDueOnOrAfter(out, from));
  return out;
};

const buildTx = (entry, dueDate) => ({
  id: `rec_${entry.id}_${dueDate.getTime()}`,
  title: entry.title,
  amount: entry.amount,
  type: entry.type,
  category: entry.category || 'General',
  account: entry.account || 'Cash',
  date: dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
  fullDate: dueDate.toISOString(),
  tags: ['Recurring', 'Auto'],
  recurringId: entry.id,
  note: `Auto-generated: ${entry.frequency} recurring`,
});

/**
 * Main function — call on app startup.
 * Returns { processed } count.
 */
export const processRecurringTransactions = async () => {
  try {
    const recurringJson = await AsyncStorage.getItem('recurring_transactions');
    const recurring = recurringJson ? JSON.parse(recurringJson) : [];
    if (!recurring.length) return { processed: 0 };

    const lastRunStr = await AsyncStorage.getItem(LAST_RUN_KEY);
    const today = new Date();

    const newTxs = [];
    const updated = recurring.map((raw) => {
      if (!raw.active) return raw;
      const entry = migrateEntry(raw, today, lastRunStr);
      const { dates, nextDue } = dueDatesUpTo(entry, today);
      dates.forEach((d) => newTxs.push(buildTx(entry, d)));
      return { ...entry, nextDue, lastProcessed: dates.length ? today.toISOString() : entry.lastProcessed };
    });

    // Transactions first (hard ID `rec_…` dedup makes a retry after a crash safe), then balances, then entries
    const { addedTxs } = newTxs.length
      ? await saveWithDedup(newTxs, { balanceMode: 'delta' })
      : { addedTxs: [] };

    await AsyncStorage.setItem('recurring_transactions', JSON.stringify(updated));
    await AsyncStorage.setItem(LAST_RUN_KEY, today.toISOString());

    console.log(`✅ Recurring: processed ${addedTxs.length} transactions`);
    return { processed: addedTxs.length };
  } catch (err) {
    console.error('RecurringEngine error:', err);
    return { processed: 0 };
  }
};
