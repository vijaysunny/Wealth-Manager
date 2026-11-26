/**
 * MonthReview (Phase 14 E6) - pure. "November in review": spending against last month, income and
 * savings, where it went (top 4 + the rest), budgets, and up to 3 notes worth a look.
 * Every figure comes from the shared report helper (utils/Report), so splits, refunds,
 * settlements, transfers, rows not in reports and Interest-only loans count as everywhere else.
 */
import { monthSpend, monthIncome, isReportable, round2 } from './Report';
import { payeeKey, payeeName } from './PayeeMatch';
import { isCardSetUp } from './CardMath';
import { shortAccountName } from './TransactionList';
import { backupStatus } from './BackupReminder';

const UNCATEGORISED = ['General', 'Other', 'Uncategorised', 'Uncategorized'];
/** Payees that read better together ("Food delivery 9 times"). */
export const PAYEE_GROUPS = [
  { label: 'Food delivery', re: /swiggy(?!\s*insta)|zomato|eatsure|dominos|domino's/i },
  { label: 'Quick commerce', re: /blinkit|zepto|instamart|bigbasket|bb ?now/i },
  { label: 'Rides', re: /\buber\b|\bola\b|rapido|namma yatri/i },
];

export const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const prevMonth = (d) => new Date(d.getFullYear(), d.getMonth() - 1, 1);
export const monthKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const monthFromKey = (k) => {
  const [y, m] = String(k || '')
    .split('-')
    .map(Number);
  return y && m >= 1 && m <= 12 ? new Date(y, m - 1, 1) : null;
};
export const monthName = (d) => d.toLocaleDateString('en-GB', { month: 'long' });

const inMonth = (tx, d) => {
  const x = new Date(tx.fullDate);
  return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth();
};

/** The most frequent payee (or payee group) among the month's spending: { label, count, total }. */
export const topPayeeGroup = (txs, month, min = 3) => {
  const groups = new Map();
  for (const tx of txs || []) {
    if (!tx || tx.type !== 'expense' || !isReportable(tx) || !inMonth(tx, month)) continue;
    const name = payeeName(tx) || tx.title || '';
    const g = PAYEE_GROUPS.find((x) => x.re.test(name));
    const key = g ? `group:${g.label}` : payeeKey(tx);
    if (!key) continue;
    const cur = groups.get(key) || { label: g ? g.label : name, count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(tx.amount) || 0;
    groups.set(key, cur);
  }
  const best = [...groups.values()]
    .filter((x) => x.count >= min)
    .sort((a, b) => b.count - a.count || b.total - a.total)[0];
  return best ? { ...best, total: round2(best.total) } : null;
};

/**
 * review(month, txs, budgets, opts) →
 * { month, spent, prevSpent, delta, deltaPct, income, saved, savedPct, top, restTotal, restCount,
 *   overBudget: [{ category, by, budget }], underCount, notes }
 * budgets: { categories: { Food: 4500 } } (getMonthlyBudget). opts: { accounts, lastBackupAt, now }.
 */
export const review = (
  monthDate,
  txs = [],
  budgets = {},
  { accounts = [], lastBackupAt, now = new Date() } = {}
) => {
  const month = monthStart(monthDate);
  const cur = monthSpend(txs, month);
  const prev = monthSpend(txs, prevMonth(month));
  const spent = cur.total;
  const prevSpent = prev.total;
  const delta = round2(spent - prevSpent);
  const deltaPct = prevSpent > 0 ? Math.round((delta / prevSpent) * 100) : null;
  const income = monthIncome(txs, month);
  const saved = round2(income - spent);
  const savedPct = income > 0 ? Math.round((saved / income) * 100) : null;

  const cats = Object.entries(cur.byCategory)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = cats.slice(0, 4).map(([category, amount]) => ({
    category,
    amount,
    share: spent > 0 ? amount / spent : 0,
  }));
  const restTotal = round2(spent - top.reduce((s, c) => s + c.amount, 0));
  const restCount = cats.length - top.length;

  const overBudget = [];
  let underCount = 0;
  for (const [category, limit] of Object.entries(budgets?.categories || {})) {
    if (!(Number(limit) > 0)) continue;
    const s = cur.byCategory[category] || 0;
    if (s > Number(limit))
      overBudget.push({ category, by: round2(s - Number(limit)), budget: Number(limit) });
    else underCount += 1;
  }
  overBudget.sort((a, b) => b.by - a.by);

  const notes = [];
  const g = topPayeeGroup(txs, month);
  if (g)
    notes.push({ kind: 'payees', text: `${g.label} ${g.count} times (₹${g.total.toLocaleString('en-IN')})` });
  const uncategorised = (txs || []).filter(
    (tx) =>
      tx &&
      tx.type === 'expense' &&
      isReportable(tx) &&
      inMonth(tx, month) &&
      (!tx.category || UNCATEGORISED.includes(tx.category))
  ).length;
  if (uncategorised)
    notes.push({
      kind: 'uncategorised',
      count: uncategorised,
      text: `${uncategorised} transaction${uncategorised === 1 ? '' : 's'} still uncategorised`,
    });
  const card = accounts.find((a) => a.type === 'Credit Card' && !isCardSetUp(a));
  if (card) notes.push({ kind: 'card', card, text: `${shortAccountName(card.name, card.last4)} not set up` });
  const backup = backupStatus(lastBackupAt, now);
  if (backup.days === null || backup.days > 7)
    notes.push({
      kind: 'backup',
      text: backup.days === null ? 'No backup yet' : `No backup in ${backup.days} days`,
    });

  return {
    month,
    spent,
    prevSpent,
    delta,
    deltaPct,
    income,
    saved,
    savedPct,
    top,
    restTotal,
    restCount,
    overBudget,
    underCount,
    notes: notes.slice(0, 3),
  };
};

/** "₹3,320 less than October (−15%)" / "₹500 more than October (+3%)" / "Same as October". */
export const deltaLine = (r, fmt) => {
  const prev = monthName(prevMonth(r.month));
  if (!r.prevSpent && !r.spent) return null;
  if (!r.prevSpent) return `Nothing spent in ${prev}`;
  if (!r.delta) return `Same as ${prev}`;
  const pct = r.deltaPct == null ? '' : ` (${r.delta < 0 ? '−' : '+'}${Math.abs(r.deltaPct)}%)`;
  return `${fmt(Math.abs(r.delta))} ${r.delta < 0 ? 'less' : 'more'} than ${prev}${pct}`;
};

/** Plain text for the share sheet: totals and categories only, never single payees. */
export const shareText = (r, fmt) =>
  [
    `${monthName(r.month)} ${r.month.getFullYear()} in review`,
    `Spent ${fmt(r.spent)}${deltaLine(r, fmt) ? ` · ${deltaLine(r, fmt)}` : ''}`,
    `Income ${fmt(r.income)} · Saved ${r.savedPct == null ? '—' : `${fmt(r.saved)} (${r.savedPct}%)`}`,
    r.top.length
      ? `Where it went: ${r.top.map((c) => `${c.category} ${fmt(c.amount)}`).join(', ')}${r.restCount ? `, everything else ${fmt(r.restTotal)}` : ''}`
      : null,
    r.overBudget.length
      ? `Over budget: ${r.overBudget.map((o) => `${o.category} by ${fmt(o.by)}`).join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

/** Home shows "<last month> in review" on the 1st–7th. */
export const showReviewCard = (now = new Date()) => now.getDate() <= 7;

/** The next 1st of a month at 9:00 after `now`, and the month it reviews. */
export const nextReviewAt = (now = new Date()) => {
  let at = new Date(now.getFullYear(), now.getMonth(), 1, 9);
  if (at <= now) at = new Date(now.getFullYear(), now.getMonth() + 1, 1, 9);
  return { at, month: prevMonth(at) };
};
