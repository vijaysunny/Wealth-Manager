/**
 * TransferPairing.js - pure. Joins the two SMS of ONE money move into one transfer:
 * the card issuer's "payment received" (one-sided cc_payment into the card) and the
 * paying bank's debit SMS (a plain expense). Without this the card bill payment counts
 * as an expense AND the card spends count again.
 *
 * Conservative on purpose: same amount (to the paisa), within 3 days, both accounts known,
 * and the bank debit must look like a card payment. The hint pattern is
 * UNVERIFIED-SAMPLE: replace it with the owner's real bank-side SMS when available.
 */

const PAIR_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
// UNVERIFIED-SAMPLE: words a bank debit for a credit-card bill usually carries
export const CARD_PAYMENT_HINT_RE =
  /credit ?card|\bcc ?(?:bill|payment)|card ?(?:bill|payment|dues)|\bbbps\b|billdesk|\bcred\b|sbi ?card|sbicard|cardpay/i;

const ms = (t) => new Date(t.fullDate).getTime();
const sameAmount = (a, b) => Math.abs(Number(a.amount) - Number(b.amount)) < 0.005;
const hasAccount = (t) => t.accountId !== undefined && t.accountId !== null && !t.accountUnresolved;

export const isOpenCardPayment = (t) =>
  t.type === 'transfer' &&
  t.transferKind === 'cc_payment' &&
  (t.toAccountId === undefined || t.toAccountId === null) &&
  hasAccount(t);

export const looksLikeCardPaymentDebit = (t) =>
  t.type === 'expense' &&
  t.accountType !== 'Credit Card' &&
  hasAccount(t) &&
  CARD_PAYMENT_HINT_RE.test([t.title, t.merchant, t.counterparty, t.vpa, t.category, t.channel].join(' '));

/** The stored row that pairs with `candidate`, closest in time, or null. */
export const findTransferPair = (candidate, rows) => {
  let match;
  if (isOpenCardPayment(candidate)) match = (r) => looksLikeCardPaymentDebit(r);
  else if (looksLikeCardPaymentDebit(candidate)) match = (r) => isOpenCardPayment(r);
  else return null;
  const cMs = ms(candidate);
  let best = null;
  for (const r of rows) {
    if (String(r.id) === String(candidate.id) || !sameAmount(r, candidate) || !match(r)) continue;
    const gap = Math.abs(ms(r) - cMs);
    if (gap > PAIR_WINDOW_MS) continue;
    if (!best || gap < best.gap) best = { row: r, gap };
  }
  return best ? best.row : null;
};

/** Source IDs a (possibly merged) row stands for: its own and any paired SMS. */
export const pairedSmsIdsOf = (t) => (Array.isArray(t.pairedSmsIds) ? t.pairedSmsIds : []);
