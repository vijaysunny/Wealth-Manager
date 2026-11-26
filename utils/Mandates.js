/**
 * Mandates (Phase 14 E2) - pure. Autopay mandate SMS: set up, paused, cancelled. They are not
 * transactions; they tell Upcoming bills that a payee is (or stops being) a regular bill.
 * mandates store: [{ key, payee, amount, status: 'active'|'paused'|'cancelled', pausedUntil?, date }]
 */
const MANDATE_RE = /\b(?:upi\s*)?(?:autopay|e-?mandate|mandate|standing instruction)\b/i;
// The owner's Axis SMS: "The UPI Autopay mandate set towards OpenAI LLC with INR 399.00 is paused
// from 04-11-26 to 31-12-26, ..." Others are UNVERIFIED-SAMPLE wordings.
const PAYEE_RE =
  /\b(?:towards|for|to|with)\s+([A-Za-z0-9][A-Za-z0-9 .&'-]{1,40}?)\s+(?:with|for|of|is|has|was|amount|INR|Rs)/i;
const AMOUNT_RE = /(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
const PAUSED_RE =
  /\bpaused\b(?:\s+from\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}))?(?:\s+(?:to|till|until)\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}))?/i;
const CANCEL_RE = /\b(cancel(?:l?ed)?|revoked|deleted)\b/i;
const ACTIVE_RE = /\b(created|set up|successfully set|registered|activated|resumed|unpaused)\b/i;

/** "31-12-26" / "31/12/2026" → local date (end of the day), or null. */
export const smsDate = (s) => {
  const m = String(s || '').match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(y, Number(m[2]) - 1, Number(m[1]), 23, 59, 59);
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
};

/** The payee key used to match a mandate to its debits (lowercase words, no company suffix). */
export const mandateKey = (payee) =>
  String(payee || '')
    .toLowerCase()
    .replace(/\b(llc|ltd|limited|pvt|private|inc|india|technologies|tech)\b\.?/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** { key, payee, amount, status, pausedFrom?, pausedUntil?, date } or null. */
export const parseMandate = (body, date = new Date()) => {
  const text = String(body || '');
  if (!MANDATE_RE.test(text)) return null;
  const payee = (text.match(PAYEE_RE) || [])[1];
  if (!payee) return null;
  const paused = text.match(PAUSED_RE);
  const status = paused
    ? 'paused'
    : CANCEL_RE.test(text)
      ? 'cancelled'
      : ACTIVE_RE.test(text)
        ? 'active'
        : null;
  if (!status) return null;
  const amount = Number(String((text.match(AMOUNT_RE) || [])[1] || '').replace(/,/g, '')) || null;
  const out = {
    key: mandateKey(payee),
    payee: payee.trim(),
    amount,
    status,
    date: new Date(date).toISOString(),
  };
  if (paused) {
    const from = smsDate(paused[1]);
    const until = smsDate(paused[2]);
    if (from) out.pausedFrom = from.toISOString();
    if (until) out.pausedUntil = until.toISOString();
  }
  return out;
};

/** Keep the newest message per payee. */
export const mergeMandate = (list = [], m) => {
  if (!m) return list;
  const old = list.find((x) => x.key === m.key);
  if (old && String(old.date) > String(m.date)) return list;
  return [...list.filter((x) => x.key !== m.key), { ...old, ...m }];
};

/** Does this mandate belong to that payee name? (all mandate words appear in the name) */
export const mandateMatches = (m, name) => {
  const words = mandateKey(m?.payee).split(' ').filter(Boolean);
  const hay = ` ${mandateKey(name)} `;
  return words.length > 0 && words.every((w) => hay.includes(` ${w} `));
};

/** Paused now: until a date still to come (or with no end date). */
export const isPausedNow = (m, asOf = new Date()) =>
  m?.status === 'paused' && (!m.pausedUntil || new Date(m.pausedUntil) >= asOf);
