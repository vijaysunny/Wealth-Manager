/**
 * TransactionQuery (Phase 14 B1) - pure. The Transactions list's search, filters, sort and totals.
 *
 * query = { text, date: { preset, from?, to? }, types, accountIds, categories,
 *           amountMin, amountMax, flags, sort }
 * Filters are AND across groups and OR inside a group; an empty group means "all".
 * Dates are compared in local time. Totals follow the report rules (utils/Report).
 */
import { parseSearch, matchesSearch, visibleTags } from './Tags';
import { payeeOf } from './PayeeMatch';
import { shortAccountName } from './TransactionList';
import { totalsOf } from './Report';
import { formatMoney } from './Format';

export const SORTS = ['newest', 'oldest', 'amountDesc', 'amountAsc', 'payee'];
export const SORT_LABELS = {
  newest: 'Newest',
  oldest: 'Oldest',
  amountDesc: 'Amount: high to low',
  amountAsc: 'Amount: low to high',
  payee: 'Payee A–Z',
};
export const DATE_PRESETS = ['thisMonth', 'lastMonth', 'last3', 'thisFY', 'custom'];
export const FLAG_LABELS = {
  needsReview: 'Needs review',
  hasFile: 'Has file',
  hasTags: 'Has tags',
  notInReports: 'Not in reports',
  loanPayments: 'Loan payments',
  manual: 'Added by hand',
  sms: 'From SMS',
};
const TYPE_LABELS = { expense: 'Expenses', income: 'Income', transfer: 'Transfers' };
const AUTO_TAGS = ['imported', 'recurring', 'auto'];

export const defaultQuery = () => ({
  text: '',
  date: { preset: 'all' },
  types: [],
  accountIds: [],
  categories: [],
  amountMin: null,
  amountMax: null,
  flags: [],
  sort: 'newest',
});

const norm = (query) => {
  const d = defaultQuery();
  const q = { ...d, ...(query || {}) };
  for (const k of ['types', 'accountIds', 'categories', 'flags']) if (!Array.isArray(q[k])) q[k] = [];
  if (!q.date || !q.date.preset) q.date = d.date;
  return q;
};

/** "2026-11-05" (local day) or a Date / ISO string → a Date at local midnight of that day. */
const dayStart = (v) => {
  if (v == null || v === '') return null;
  const m = typeof v === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

/** { from, to } in local time, `to` exclusive; nulls when open. */
export const dateRange = (date, asOf = new Date()) => {
  const y = asOf.getFullYear();
  const m = asOf.getMonth();
  switch (date?.preset) {
    case 'thisMonth':
      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 1) };
    case 'lastMonth':
      return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1) };
    case 'last3':
      return { from: new Date(y, m - 2, 1), to: new Date(y, m + 1, 1) };
    case 'thisFY': {
      const start = m >= 3 ? y : y - 1; // Indian FY: 1 Apr – 31 Mar
      return { from: new Date(start, 3, 1), to: new Date(start + 1, 3, 1) };
    }
    case 'custom': {
      const from = dayStart(date.from);
      const end = dayStart(date.to);
      const to = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1) : null;
      return { from, to };
    }
    default:
      return { from: null, to: null };
  }
};

const FLAG_TESTS = {
  needsReview: (tx) => tx.reviewStatus === 'pending' || !!tx.accountUnresolved,
  hasFile: (tx) => Array.isArray(tx.attachments) && tx.attachments.length > 0,
  hasTags: (tx) => visibleTags(tx.tags).length > 0,
  notInReports: (tx) => !!tx.excludeFromReports,
  loanPayments: (tx) => !!tx.loanLink,
  manual: (tx) => !tx.smsId && !tx.gmailMsgId && !(tx.tags || []).some((g) => AUTO_TAGS.includes(g)),
  sms: (tx) => !!tx.smsId,
};

/** Either side of a transfer, by id; older rows that only store the account's name match by name. */
const onAccount = (tx, a) => {
  const ids = [tx.accountId, tx.toAccountId, tx.balanceAccountId].filter((x) => x != null).map(String);
  if (ids.includes(String(a.id))) return true;
  return !!a.name && (tx.account === a.name || tx.toAccount === a.name);
};

const time = (tx) => {
  const t = new Date(tx.fullDate).getTime();
  return Number.isNaN(t) ? 0 : t;
};
const byId = (a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
const newer = (a, b) => time(b) - time(a) || byId(a, b);
// One collator for the whole sort: localeCompare with options builds a new one per call (slow).
const PAYEE_COLLATOR = new Intl.Collator('en-IN', { sensitivity: 'base' });
const COMPARE = {
  newest: newer,
  oldest: (a, b) => time(a) - time(b) || byId(a, b),
  amountDesc: (a, b) => Number(b.amount) - Number(a.amount) || newer(a, b),
  amountAsc: (a, b) => Number(a.amount) - Number(b.amount) || newer(a, b),
  payee: (a, b) => PAYEE_COLLATOR.compare(String(payeeOf(a)), String(payeeOf(b))) || newer(a, b),
};

/**
 * rows → { rows (filtered + sorted, a new array), totals: { count, spent, income, transfers } }.
 * opts.accounts lets an account filter also match older rows that only store the account name.
 */
export const runQuery = (rows, query, asOf = new Date(), { accounts = [] } = {}) => {
  const q = norm(query);
  const search = parseSearch(q.text);
  const { from, to } = dateRange(q.date, asOf);
  const accs = q.accountIds.map((id) => accounts.find((a) => String(a.id) === String(id)) || { id });
  const flagTests = q.flags.map((f) => FLAG_TESTS[f] || (() => false));
  const out = (rows || []).filter((tx) => {
    if (!tx) return false;
    if (from || to) {
      const t = new Date(tx.fullDate);
      if (Number.isNaN(t.getTime()) || (from && t < from) || (to && t >= to)) return false;
    }
    if (q.types.length && !q.types.includes(tx.type)) return false;
    if (accs.length && !accs.some((a) => onAccount(tx, a))) return false;
    if (q.categories.length && !q.categories.includes(tx.category)) return false;
    const amt = Number(tx.amount);
    if (q.amountMin != null && !(amt >= q.amountMin)) return false;
    if (q.amountMax != null && !(amt <= q.amountMax)) return false;
    if (flagTests.length && !flagTests.some((f) => f(tx))) return false;
    return matchesSearch(tx, search);
  });
  out.sort(COMPARE[q.sort] || COMPARE.newest);
  return { rows: out, totals: totalsOf(out) };
};

const monthName = (d) => d.toLocaleDateString('en-GB', { month: 'long' });
const shortDay = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const dateLabel = (date, asOf) => {
  const { from } = dateRange(date, asOf);
  switch (date.preset) {
    case 'thisMonth':
    case 'lastMonth':
      return monthName(from);
    case 'last3':
      return 'Last 3 months';
    case 'thisFY':
      return `FY ${from.getFullYear()}–${String(from.getFullYear() + 1).slice(2)}`;
    default: {
      const a = dayStart(date.from);
      const b = dayStart(date.to);
      if (a && b) return `${shortDay(a)} – ${shortDay(b)}`;
      return a ? `From ${shortDay(a)}` : `Until ${shortDay(b)}`;
    }
  }
};

const amountLabel = (min, max) => {
  if (min != null && max != null) return `${formatMoney(min)}–${formatMoney(max)}`;
  return min != null ? `Over ${formatMoney(min)}` : `Under ${formatMoney(max)}`;
};

/** One removable chip per active filter (text and sort are not chips). */
export const activeFilterChips = (query, accounts = [], asOf = new Date()) => {
  const q = norm(query);
  const chips = [];
  if (q.date.preset !== 'all' && (q.date.preset !== 'custom' || q.date.from || q.date.to))
    chips.push({ key: 'date', label: dateLabel(q.date, asOf) });
  for (const ty of q.types) chips.push({ key: `type:${ty}`, label: TYPE_LABELS[ty] || ty });
  for (const id of q.accountIds) {
    const a = (accounts || []).find((x) => String(x.id) === String(id));
    chips.push({ key: `account:${id}`, label: a ? shortAccountName(a.name, a.last4) : 'Account' });
  }
  for (const c of q.categories) chips.push({ key: `category:${c}`, label: c });
  if (q.amountMin != null || q.amountMax != null)
    chips.push({ key: 'amount', label: amountLabel(q.amountMin, q.amountMax) });
  for (const f of q.flags) chips.push({ key: `flag:${f}`, label: FLAG_LABELS[f] || f });
  return chips;
};

/** The Filter button's badge: active filters (sort doesn't count). */
export const activeCount = (query) => activeFilterChips(query).length;

/** The query without the filter behind chip `key`. */
export const removeChip = (query, key) => {
  const q = norm(query);
  const [kind, ...rest] = String(key).split(':');
  const value = rest.join(':');
  const without = (list) => list.filter((x) => String(x) !== value);
  switch (kind) {
    case 'date':
      return { ...q, date: { preset: 'all' } };
    case 'type':
      return { ...q, types: without(q.types) };
    case 'account':
      return { ...q, accountIds: without(q.accountIds) };
    case 'category':
      return { ...q, categories: without(q.categories) };
    case 'amount':
      return { ...q, amountMin: null, amountMax: null };
    case 'flag':
      return { ...q, flags: without(q.flags) };
    default:
      return q;
  }
};
