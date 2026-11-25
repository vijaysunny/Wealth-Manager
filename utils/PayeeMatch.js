/**
 * PayeeMatch (Phase 14 A2/A5) - pure.
 * Which transactions come from the same payee, what an edit changed, and which other rows that
 * change could be copied to. No fuzzy matching: "SWIGGY INST" and "Swiggy Instamart" differ.
 */
import { normalizeTag, SYSTEM_TAGS } from './Tags';

// A5: who set a category or payee name. Rows saved before Phase 14 have none: 'parser'.
export const sourceOf = (tx, field) => tx?.[`${field}Source`] || 'parser';
/** Rules never overwrite a value the owner chose (by hand or in bulk). */
export const isLocked = (source) => source === 'user' || source === 'bulk';

/** The payee shown on a row (A5 of Phase 12): a title that only repeats the category is no payee. */
export const payeeOf = (tx) => {
  const title = tx.title && tx.title !== tx.category ? tx.title : null;
  return (
    tx.merchant ||
    tx.counterparty ||
    title ||
    tx.category ||
    tx.title ||
    (tx.type === 'transfer' ? 'Transfer' : 'Transaction')
  );
};

/** The payee name the owner can edit: '' when the row only shows its category. */
export const payeeName = (tx) => {
  const p = payeeOf(tx);
  return p === tx.category ? '' : String(p).trim();
};

const GENERIC = new Set(['transfer', 'upi transfer', 'atm', 'cash', 'transaction']);
// Built-in category names (the AI list plus income ones); the owner's own come in opts.categories
const BUILTIN_CATEGORIES = [
  'Food',
  'Transport',
  'Shopping',
  'Bills',
  'Health',
  'Education',
  'Entertainment',
  'Salary',
  'Business',
  'Investment',
  'Loan/EMI',
  'Insurance',
  'Rent',
  'Subscriptions',
  'UPI Transfer',
  'General',
  'Interest',
  'Gift',
  'Refund',
  'Bonus',
  'Cashback',
];
const NOISE = new Set(['pvt', 'ltd', 'private', 'limited', 'llp', 'india', 'inc', 'store', 'payments']);
const REF = /^[a-z]*\d{6,}$/;

const normalize = (s) => {
  const words = String(s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !REF.test(w));
  while (words.length && (NOISE.has(words[words.length - 1]) || /^\d{4,}$/.test(words[words.length - 1])))
    words.pop();
  return words.join(' ');
};

/**
 * The normalised payee key, or null for payees that must never group.
 * opts.categories: the owner's category names (a payee equal to one is no payee).
 */
export const payeeKey = (tx, { categories = [] } = {}) => {
  if (!tx) return null;
  const vpa = String(tx.vpa || '')
    .trim()
    .toLowerCase();
  if (vpa) return vpa;
  const key = normalize(tx.merchant || tx.counterparty || payeeOf(tx));
  if (!key || GENERIC.has(key)) return null;
  const cats = [...BUILTIN_CATEGORIES, ...categories, tx.category].filter(Boolean).map(normalize);
  return cats.includes(key) ? null : key;
};

const userTags = (tx) => [
  ...new Set((tx?.tags || []).map(normalizeTag).filter((g) => g && !SYSTEM_TAGS.includes(g))),
];

/** What the owner changed in one save: { name?, category?, tags? } ({} when nothing to copy). */
export const diffEdit = (before, after) => {
  const out = {};
  const from = payeeName(before);
  const to = payeeName(after);
  if (to && to !== from) out.name = { from, to };
  if ((after.category || '') !== (before.category || '') && after.category)
    out.category = { from: before.category || '', to: after.category };
  const b = userTags(before);
  const a = userTags(after);
  const add = a.filter((g) => !b.includes(g));
  const remove = b.filter((g) => !a.includes(g));
  if (add.length || remove.length) out.tags = { add, remove };
  return out;
};

/** Which of `changes` would alter `row` (a value the owner set by hand is left alone). */
export const willChangeFor = (row, changes) => {
  const out = [];
  if (changes.name && sourceOf(row, 'name') !== 'user' && payeeName(row) !== changes.name.to)
    out.push('name');
  if (changes.category && sourceOf(row, 'category') !== 'user' && row.category !== changes.category.to)
    out.push('category');
  if (changes.tags) {
    const has = userTags(row);
    if (changes.tags.add.some((g) => !has.includes(g)) || changes.tags.remove.some((g) => has.includes(g)))
      out.push('tags');
  }
  return out;
};

const newestFirst = (a, b) => String(b.fullDate || '').localeCompare(String(a.fullDate || ''));

/**
 * Other rows from the same payee that this edit could be copied to.
 * Matches on the payee before the edit (the others still carry the old name) and after it.
 * Returns { matches: [{ ...row, willChange }], skipped: [{ id, reason }], changes, keptCategory, keptName }.
 */
export const findSimilar = (before, after, all, opts = {}) => {
  const changes = diffEdit(before, after);
  const empty = { matches: [], skipped: [], changes, keptCategory: 0, keptName: 0 };
  if (!Object.keys(changes).length || before.type === 'transfer') return empty;
  const keys = new Set([payeeKey(before, opts), payeeKey(after, opts)].filter(Boolean));
  if (!keys.size) return empty;
  const matches = [];
  const skipped = [];
  let keptCategory = 0;
  let keptName = 0;
  const rows = (all || [])
    .filter((r) => r && !r.deleted && String(r.id) !== String(before.id) && keys.has(payeeKey(r, opts)))
    .sort(newestFirst);
  for (const r of rows) {
    if (r.type === 'transfer') {
      skipped.push({ id: r.id, reason: 'transfer' });
      continue;
    }
    if (r.type !== before.type) continue;
    if (r.loanLink) {
      skipped.push({ id: r.id, reason: 'loan' });
      continue;
    }
    if (changes.category && sourceOf(r, 'category') === 'user' && r.category !== changes.category.to)
      keptCategory += 1;
    if (changes.name && sourceOf(r, 'name') === 'user' && payeeName(r) !== changes.name.to) keptName += 1;
    const willChange = willChangeFor(r, changes);
    if (!willChange.length) continue;
    matches.push({ ...r, willChange });
  }
  return { matches, skipped, changes, keptCategory, keptName };
};
