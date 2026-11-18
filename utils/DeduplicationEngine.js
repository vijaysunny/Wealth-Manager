/**
 * DeduplicationEngine.js
 * Conflict-free deduplication across SMS, Gmail, manual, recurring and file imports.
 * Goal: never drop a real transaction, never double-count the same one.
 *
 * Matching rules (first hit wins), see findMatch():
 *   1. Hard IDs      smsId / gmailMsgId / recurring id            → duplicate
 *   2. Same SMS text identical body within 10 min (listener vs inbox scan
 *                    timestamps can differ by a few seconds)       → duplicate
 *   3. Cross-source  SMS vs Gmail, both with real timestamps: same amount/type/
 *                    day/bank within 5 min, or the same reference no. → duplicate
 *   4. No time of day (statements, manual, recurring): same amount/type/day/bank
 *                    AND a matching reference, description or running balance.
 *                    Without that match both are kept.
 * Occurrences are counted: every existing row can absorb only ONE candidate,
 * so a statement with two identical ₹100 rows against one stored row adds one.
 */

import { addMany } from '../data/TransactionRepo';

const CROSS_SOURCE_TOLERANCE_MS = 5 * 60 * 1000;
const SAME_SMS_TOLERANCE_MS = 10 * 60 * 1000;
const GENERIC_BANKS = new Set([
  '',
  'unknown',
  'unknownbank',
  'bank',
  'cash',
  'bankstatement',
  'pdfstatement',
]);

// ── Helpers ───────────────────────────────────────────────────────────────

/** Small non-crypto string hash (djb2), base36. */
export const hashText = (text = '') => {
  const s = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/**
 * Unified SMS source ID, identical in the live listener, background task and
 * manual scan: sms:<sender>:<epoch ms>:<amount>
 */
export const buildSmsId = (address, dateMs, amount) => {
  const addr = String(address || 'unknown')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  const ts = Math.round(Number(dateMs) || 0);
  const amt = Number(amount);
  return `sms:${addr}:${ts}:${Number.isFinite(amt) ? amt.toFixed(2) : '0.00'}`;
};

const bankKey = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/\s+/g, '');
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const toMs = (t) => {
  const ms = t.fullDate ? new Date(t.fullDate).getTime() : NaN;
  return Number.isFinite(ms) ? ms : Date.now();
};
const dayKey = (ms) => {
  const d = new Date(ms); // local day: matches how the user sees the date
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
/** Only SMS and Gmail carry a trustworthy time of day. */
const hasRealTime = (t) => !!(t.smsId || t.gmailMsgId);
const banksCompatible = (a, b) => {
  const x = bankKey(a),
    y = bankKey(b);
  return GENERIC_BANKS.has(x) || GENERIC_BANKS.has(y) || x === y;
};
const refOf = (t) => {
  const r = norm(t.refNo);
  return r.length >= 6 ? r : '';
};
const descOf = (t) => {
  const d = norm(t.title);
  return d && d !== norm(t.category) ? d : ''; // a bare category name says nothing
};
const textOf = (t) => norm(`${t.title || ''}${t.note || ''}`);

/**
 * Generate a fingerprint for fast lookup: amount + bank + type + (local) day.
 * Kept for callers that want a coarse key; matching itself uses findMatch().
 */
export const generateFingerprint = (amount, bankName, type, dateMs) => {
  const cleanBank = bankKey(bankName) || 'unknown';
  const cleanAmount = parseFloat(amount).toFixed(2);
  return `${cleanAmount}|${cleanBank}|${type}|${dayKey(dateMs)}`;
};

const bucketKey = (t, ms, type = t.type) => `${parseFloat(t.amount).toFixed(2)}|${type}|${dayKey(ms)}`;

/**
 * The account-level entries a transaction shows up as on statements (plan A3 dedup
 * normalisation). A wallet top-up captured from SMS is a transfer, but the bank statement
 * shows it as a plain debit, so a transfer is indexed under each of its legs:
 *   one-sided (only the SMS's account known) → its own leg ('income' for flow in, else 'expense')
 *   linked (two accounts)                    → 'expense' on the source, 'income' on the destination
 * plus 'transfer' (shares the source leg's slot) so transfer rows still match each other.
 */
const legsOf = (t) => {
  if (t.type !== 'transfer') return [{ types: [t.type], account: t.account }];
  const linked = t.toAccountId !== undefined && t.toAccountId !== null;
  if (!linked) return [{ types: ['transfer', t.flow === 'in' ? 'income' : 'expense'], account: t.account }];
  return [
    { types: ['transfer', 'expense'], account: t.account },
    { types: ['income'], account: t.toAccount || '' },
  ];
};
// UPI Lite wording on both sides is enough evidence for a no-time statement row (A3)
const LITE_RE = /upi ?lite|upilite|lite ?top ?up/i;
const isLite = (t) =>
  /^wallet_/.test(t.transferKind || '') ||
  t.walletSubType === 'UPI Lite' ||
  LITE_RE.test(`${t.title || ''} ${t.note || ''} ${t.narration || ''}`);
// Statements often print a shortened reference; a long ref containing the other is the same one
const refsCompatible = (a, b) =>
  a === b || (Math.min(a.length, b.length) >= 10 && (a.includes(b) || b.includes(a)));

// ── Index ─────────────────────────────────────────────────────────────────

/**
 * Build an index over existing transactions ONCE (O(n)); each check is then a
 * bucket lookup instead of a scan of the whole store.
 * check(candidate) → true if duplicate (and consumes the matched row).
 * When the candidate is new it is registered, so later candidates in the same
 * batch dedupe against it with correct occurrence counting.
 */
export const createDedupIndex = (existing = []) => {
  const ids = new Set();
  const bodies = new Map(); // bodyHash → [ms]
  const buckets = new Map(); // amount|type|day → [slot]

  const register = (t, consumed) => {
    [
      t.smsId,
      t.gmailMsgId,
      typeof t.id === 'string' && t.id.startsWith('rec_') ? t.id : null,
      ...(Array.isArray(t.pairedSmsIds) ? t.pairedSmsIds : []), // SMS merged into this transfer
    ].forEach((v) => {
      if (v) ids.add(v);
    });
    const ms = toMs(t);
    if (t.bodyHash) {
      if (!bodies.has(t.bodyHash)) bodies.set(t.bodyHash, []);
      bodies.get(t.bodyHash).push(ms);
    }
    for (const leg of legsOf(t)) {
      const state = { consumed }; // one leg is matched at most once, under any of its keys
      for (const type of leg.types) {
        const k = bucketKey(t, ms, type);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push({ tx: t, ms, state, account: leg.account });
      }
    }
  };

  existing.forEach((t) => register(t, false));

  const check = (c) => {
    // 1. Hard IDs
    if (c.smsId && ids.has(c.smsId)) return true;
    if (c.gmailMsgId && ids.has(c.gmailMsgId)) return true;
    if (typeof c.id === 'string' && c.id.startsWith('rec_') && ids.has(c.id)) return true;

    const cMs = toMs(c);

    // 2. Same SMS seen twice with slightly different timestamps
    if (
      c.bodyHash &&
      bodies.has(c.bodyHash) &&
      bodies.get(c.bodyHash).some((ms) => Math.abs(ms - cMs) <= SAME_SMS_TOLERANCE_MS)
    )
      return true;

    // 3/4. Bucket match with occurrence counting (every leg of the candidate)
    const cRef = refOf(c);
    const cDesc = descOf(c);
    const cBal = Number.isFinite(c.extractedBalance) ? c.extractedBalance : null;
    const slots = [];
    for (const leg of legsOf(c))
      for (const type of leg.types)
        for (const slot of buckets.get(bucketKey(c, cMs, type)) || [])
          slots.push({ slot, account: leg.account });

    for (const { slot, account: cAccount } of slots) {
      if (slot.state.consumed) continue;
      const t = slot.tx;
      if (!banksCompatible(cAccount, slot.account)) continue;
      const tRef = refOf(t);
      if (cRef && tRef && !refsCompatible(cRef, tRef)) continue; // two different references = two payments

      let match = false;
      if (hasRealTime(c) && hasRealTime(t)) {
        // Both stamped: only SMS-vs-Gmail may merge. Two SMS (or two emails)
        // with different IDs are two different transactions.
        const crossSource = !!c.smsId !== !!t.smsId || !!c.gmailMsgId !== !!t.gmailMsgId;
        if (crossSource)
          match = Math.abs(cMs - slot.ms) <= CROSS_SOURCE_TOLERANCE_MS || (!!cRef && cRef === tRef);
      } else {
        const tBal = Number.isFinite(t.extractedBalance) ? t.extractedBalance : null;
        const refHit =
          (cRef && cRef === tRef) || (cRef && textOf(t).includes(cRef)) || (tRef && textOf(c).includes(tRef));
        const descHit = !!cDesc && cDesc === descOf(t);
        const balHit = cBal !== null && tBal !== null && Math.abs(cBal - tBal) < 0.005;
        const liteHit = isLite(c) && isLite(t);
        match = refHit || descHit || balHit || liteHit || (!!cRef && !!tRef && refsCompatible(cRef, tRef));
      }
      if (match) {
        slot.state.consumed = true;
        return true;
      }
    }

    register(c, true);
    return false;
  };

  return { check };
};

// ── Public API ────────────────────────────────────────────────────────────

/** True if the candidate already exists in `existingTransactions`. */
export const isDuplicate = (candidate, existingTransactions = []) =>
  createDedupIndex(existingTransactions).check(candidate);

/** Candidates that are NOT already stored (and not repeated within the batch). */
export const filterNew = (newTxs, existingTxs = []) => {
  const index = createDedupIndex(existingTxs);
  return newTxs.filter((tx) => !index.check(tx));
};

/**
 * Merge new transactions into existing, skipping duplicates.
 * Returns { merged, added, skipped }
 */
export const mergeTransactions = (newTxs, existingTxs) => {
  const fresh = filterNew(newTxs, existingTxs);
  const merged = [...existingTxs, ...fresh];
  merged.sort((a, b) => new Date(b.fullDate) - new Date(a.fullDate));
  return { merged, added: fresh.length, skipped: newTxs.length - fresh.length };
};

/**
 * Save transactions with deduplication to AsyncStorage.
 * Returns { added, skipped, addedTxs } (addedTxs = the rows that were actually stored,
 * so callers can apply balance changes to exactly those).
 */
export const saveWithDedup = (newTransactions, options) => addMany(newTransactions, options);
