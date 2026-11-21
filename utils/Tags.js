/**
 * Tags.js (Phase 12 B2) - pure.
 * Tags are lowercase slugs: 'tax-2026'. System tags mark how a row was captured; they are hidden
 * in the UI but stay searchable.
 */
export const SYSTEM_TAGS = ['auto-sms', 'auto-sync'];
const MAX_LEN = 32;

/** "  #Tax 2026! " → "tax-2026"; '' when nothing usable is left. */
export const normalizeTag = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LEN);

export const isSystemTag = (tag) => SYSTEM_TAGS.includes(normalizeTag(tag));

const tagsOf = (tx) => (Array.isArray(tx?.tags) ? tx.tags.map(normalizeTag).filter(Boolean) : []);

/** Returns a new tx with the tag added (normalised, no duplicates). */
export const addTag = (tx, s) => {
  const tag = normalizeTag(s);
  const tags = tagsOf(tx);
  if (!tag || tags.includes(tag)) return { ...tx, tags };
  return { ...tx, tags: [...tags, tag] };
};

export const removeTag = (tx, s) => {
  const tag = normalizeTag(s);
  return { ...tx, tags: tagsOf(tx).filter((g) => g !== tag) };
};

/** Tags to show on a row: user tags only. */
export const visibleTags = (tags) =>
  (Array.isArray(tags) ? tags : []).map(normalizeTag).filter((g) => g && !SYSTEM_TAGS.includes(g));

/** User tags by most recent use (newest transaction first), unique, at most n. */
export const recentTags = (txs = [], n = 8) => {
  const sorted = [...(txs || [])].sort(
    (a, b) => new Date(b?.fullDate || 0).getTime() - new Date(a?.fullDate || 0).getTime()
  );
  const out = [];
  for (const tx of sorted) {
    for (const tag of visibleTags(tx?.tags)) {
      if (!out.includes(tag)) out.push(tag);
      if (out.length >= n) return out;
    }
  }
  return out;
};

/** "google #tax-2026 #work" → { text: 'google', tags: ['tax-2026', 'work'] } */
export const parseSearch = (query = '') => {
  const tags = [];
  const words = [];
  String(query || '')
    .split(/\s+/)
    .filter(Boolean)
    .forEach((w) => {
      if (w.startsWith('#')) {
        const tag = normalizeTag(w);
        if (tag && !tags.includes(tag)) tags.push(tag);
      } else words.push(w);
    });
  return { text: words.join(' ').toLowerCase(), tags };
};

const amountStrings = (amount) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return [];
  return [String(n), n.toFixed(2), n.toLocaleString('en-IN')];
};

/** AND across tags; text matches payee fields, category, amount and attachment names. */
export const matchesSearch = (tx, parsed = { text: '', tags: [] }) => {
  if (!tx) return false;
  const own = tagsOf(tx);
  if ((parsed.tags || []).some((tag) => !own.includes(tag))) return false;
  const text = (parsed.text || '').trim();
  if (!text) return true;
  const hay = [
    tx.title,
    tx.merchant,
    tx.counterparty,
    tx.category,
    tx.note,
    tx.vpa,
    tx.account,
    ...amountStrings(tx.amount),
    ...(Array.isArray(tx.attachments) ? tx.attachments.map((a) => a?.name) : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return text.split(/\s+/).every((w) => hay.includes(w));
};
