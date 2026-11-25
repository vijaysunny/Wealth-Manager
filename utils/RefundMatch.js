/**
 * RefundMatch (Phase 14 E5) - pure. Spot refund-like credits and find the purchase they refund.
 * A linked refund (refundOf) stays in the list as income but is not counted as income; it lowers
 * the purchase's category in the purchase's month (utils/Report).
 */
import { payeeKey } from './PayeeMatch';
import { hasSplits } from './Report';

const DAY = 24 * 60 * 60 * 1000;
export const REFUND_WINDOW_DAYS = 120;
const REFUND_RE = /\b(refund(?:ed)?|reversal|reversed|return(?:ed)?)\b/i;
const CASHBACK_RE = /\bcash\s?back\b/i;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** SMS wording that says money came back (cashback is not a refund). */
export const refundWords = (text) =>
  REFUND_RE.test(String(text || '')) && !CASHBACK_RE.test(String(text || ''));

const isCashback = (tx) =>
  /cashback/i.test(String(tx.category || '')) ||
  CASHBACK_RE.test([tx.title, tx.merchant, tx.note].filter(Boolean).join(' '));

/**
 * Should this new credit be offered as a refund? SMS refund words, or a credit on a credit card
 * from a merchant the owner has paid before. Cashback never is.
 */
export const isRefundLike = (tx, history = []) => {
  if (!tx || tx.type !== 'income' || tx.refundOf || tx.refundDismissed || isCashback(tx)) return false;
  if (tx.refundWords) return true;
  if (tx.accountType !== 'Credit Card') return false;
  const key = payeeKey(tx);
  return !!key && (history || []).some((h) => h && h.type === 'expense' && payeeKey(h) === key);
};

/** Marks refund-like credits in a batch of new rows (refundCandidate: true). */
export const markRefundCandidates = (txs, history) =>
  (txs || []).map((tx) => (isRefundLike(tx, history) ? { ...tx, refundCandidate: true } : tx));

/** How much of a purchase has been refunded already (optionally leaving one refund out). */
export const refundedAmount = (purchaseId, txs, exceptId = null) =>
  round2(
    (txs || [])
      .filter(
        (t) =>
          t &&
          t.refundOf != null &&
          String(t.refundOf) === String(purchaseId) &&
          String(t.id) !== String(exceptId)
      )
      .reduce((s, t) => s + num(t.amount), 0)
  );

/**
 * Purchases this refund may be for: expenses in the 120 days before it, on the same account or
 * from the same payee, with enough left to refund. Best first:
 * exact amount + same account + same payee, then same payee, then same account; newer first.
 * Each: { tx, score, best, left, partRefund, reasons }.
 */
export const candidates = (refund, txs) => {
  if (!refund) return [];
  const at = new Date(refund.fullDate).getTime();
  const key = payeeKey(refund);
  const amount = num(refund.amount);
  const out = [];
  for (const t of txs || []) {
    if (!t || t.type !== 'expense' || String(t.id) === String(refund.id)) continue;
    const when = new Date(t.fullDate).getTime();
    if (!(when <= at && at - when <= REFUND_WINDOW_DAYS * DAY)) continue;
    const sameAccount = refund.accountId != null && String(t.accountId) === String(refund.accountId);
    const samePayee = !!key && payeeKey(t) === key;
    if (!sameAccount && !samePayee) continue;
    const left = round2(num(t.amount) - refundedAmount(t.id, txs, refund.id));
    if (left < amount) continue;
    const exact = Math.abs(num(t.amount) - amount) < 0.005;
    const reasons = [
      exact ? 'same amount' : null,
      sameAccount ? 'same card' : null,
      samePayee ? 'same payee' : null,
    ].filter(Boolean);
    out.push({
      tx: t,
      score: (samePayee ? 2 : 0) + (sameAccount ? 1 : 0) + (exact ? 0.5 : 0),
      left,
      partRefund: hasSplits(t) || !exact,
      reasons,
    });
  }
  out.sort((a, b) => b.score - a.score || new Date(b.tx.fullDate) - new Date(a.tx.fullDate));
  return out.map((c, i) => ({ ...c, best: i === 0 }));
};

/** The category a refund lowers: the purchase's, or its largest split category. */
export const refundCategoryOf = (purchase) => {
  if (!hasSplits(purchase)) return purchase.category || 'Other';
  const parts = purchase.splits.filter((p) => p.category).sort((a, b) => num(b.amount) - num(a.amount));
  return parts[0]?.category || purchase.category || 'Other';
};

/** The changes that link a refund to its purchase (checked: it can't exceed what is left). */
export const linkChanges = (refund, purchase, txs) => {
  const left = round2(num(purchase.amount) - refundedAmount(purchase.id, txs, refund.id));
  if (num(refund.amount) > left + 0.005) throw new Error(`Only ${left} of this purchase is left to refund.`);
  return {
    refundOf: purchase.id,
    refundCategory: refundCategoryOf(purchase),
    refundDate: purchase.fullDate,
    refundCandidate: false,
  };
};
export const UNLINK_CHANGES = { refundOf: undefined, refundCategory: undefined, refundDate: undefined };
