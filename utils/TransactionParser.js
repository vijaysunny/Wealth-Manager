/**
 * TransactionParser.js
 * Single, pure (no React Native imports) parsing module shared by:
 *   RealSmsReader, InstantSmsListener, GmailTracker, StatementParser, SmsParser.
 *
 * Covers: amount / balance extraction, bank detection, income-vs-expense
 * classification, category guessing, statement column detection, statement row
 * parsing, and PDF text-line parsing.
 */
import { isNonTransactionNotice } from './CardStatementSms';

// ── Regexes ───────────────────────────────────────────────────────────────

const AMOUNT_G = /(?:Rs\.?|INR|₹)\s*\.?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
const BALANCE_RE =
  /(?:avl\.?\s*|avbl\.?\s*|available\s*)?bal(?:ance)?\.?[:\s]*(?:is\s*)?(?:rs\.?|inr|₹)?\s*\.?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
// Text just before an amount that marks it as a balance/limit, not the transaction
const NOT_TXN_AMOUNT_BEFORE = /(?:bal(?:ance)?|limit|avl|avbl|available)[:\s.]*(?:is\s*)?$/i;

// Words that make a message look like a transaction at all
const TXN_WORD_RE =
  /\b(debited|credited|debit|credit|sent|paid|spent|received|withdrawn|withdrawal|deposited|transfer|transferred|purchase|used at|txn|transaction|refund|cashback)\b/i;

// Messages that are NOT transactions (OTPs, reminders, failures, promos)
const IGNORE_RE = new RegExp(
  [
    '\\botp\\b',
    'one[- ]time password',
    '\\blogin\\b',
    '\\bverif(?:y|ication)\\b',
    '\\bpin\\b',
    '\\bcvv\\b',
    '\\bpassword\\b',
    'will be (?:debited|credited|deducted)',
    'request(?:ed)? received',
    '\\bfailed\\b',
    '\\bdeclined\\b',
    'payment due',
    '\\bdue (?:date|on|by|amount)\\b',
    'min(?:imum)? (?:amount )?due',
    '\\breminder\\b',
    '\\breward points?\\b',
    '\\boffer\\b',
    '\\bexpires?\\b',
    // A7: card limit-change notices ("request to re-set the limit … is set at Rs. 156000")
    '\\bre-?set the limit\\b',
    '\\blimit\\b[^.]{0,80}\\b(?:is set at|has been (?:set|changed|updated|accepted))',
  ].join('|'),
  'i'
);

// Direction words. Whichever appears FIRST in the text decides the direction, so
// "Rs 500 debited ... Info: XYZ credited" is an expense, not income.
const DEBIT_WORDS =
  /\b(debited|debit(?!\s*card)|spent|paid|sent|withdrawn|withdrawal|purchase|used at|deducted)\b/i;
const CREDIT_WORDS = /\b(credited|received|deposited|refund(?:ed)?|cashback|added to)\b/i;

// ── Amount / balance ──────────────────────────────────────────────────────

/** First amount in the text that is not a balance/limit. Returns number or null. */
export const extractAmount = (text = '') => {
  const re = new RegExp(AMOUNT_G.source, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 20), m.index);
    if (NOT_TXN_AMOUNT_BEFORE.test(before)) continue;
    const n = parseFloat(m[1].replace(/,/g, ''));
    if (!isNaN(n)) return n;
  }
  return null;
};

/** Available balance mentioned in the text, as a number, or null. */
export const extractBalance = (text = '') => {
  const m = text.match(BALANCE_RE);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return isNaN(n) ? null : n;
};

// ── Bank detection ────────────────────────────────────────────────────────

// Word-boundary patterns: plain substring checks wrongly matched "CRED" inside
// "CREDITED" and "BOB" inside unrelated words.
const BANKS = [
  [/\bSBI\b|STATE BANK/, 'SBI'],
  [/\bHDFC/, 'HDFC Bank'],
  [/\bICICI/, 'ICICI Bank'],
  [/\bAXIS\b/, 'Axis Bank'],
  [/\bKOTAK/, 'Kotak Bank'],
  [/\bBOB\b|BARODA/, 'Bank of Baroda'],
  [/\bPNB\b/, 'PNB'],
  [/\bIDFC/, 'IDFC First Bank'],
  [/YES ?BANK/, 'Yes Bank'],
  [/INDUSIND/, 'IndusInd Bank'],
  [/FEDERAL|\bFEDBK\b/, 'Federal Bank'],
  [/CANARA|\bCNRB\b/, 'Canara Bank'],
  [/UNION BANK/, 'Union Bank'],
  [/EQUITAS/, 'Equitas Small Finance Bank'],
  // Paytm Payments Bank is a bank; "Paytm" alone (wallet / UPI Lite / app) is a provider below
  [/PAYTM PAYMENTS BANK|\bPPBL\b/, 'Paytm Payments Bank'],
  [/AIRTEL (?:PAYMENTS )?BANK|AIRTEL PAYMENTS/, 'Airtel Payments Bank'],
  [/JUPITER/, 'Jupiter'],
];

// Wallet / UPI-app providers. Never treated as banks by account creation; detectBank()
// only falls back to them when no real bank is named (keeps old labels for app-only SMS).
export const WALLET_PROVIDERS = [
  [/PAYTM/, 'Paytm'],
  [/AMAZON|\bAMZN\b/, 'Amazon Pay'],
  [/PHONE ?PE/, 'PhonePe'],
  [/\bGPAY\b|GOOGLE ?PAY/, 'Google Pay'],
  [/\bBHIM\b/, 'BHIM'],
  [/\bCRED\b/, 'CRED'],
  [/MOBIKWIK/, 'MobiKwik'],
];

// ── Sender filter ───────────────────────────────────────────────────────

// Tokens found in Indian bank / UPI / wallet sender IDs (e.g. "AX-HDFCBK", "VM-SBIUPI", "JD-ICICIT-S")
const SENDER_TOKENS = [
  'HDFC',
  'SBI',
  'ICICI',
  'AXIS',
  'KOTAK',
  'BOB',
  'BARODA',
  'PNB',
  'IDFC',
  'YESBNK',
  'YESBANK',
  'INDUS',
  'FEDBK',
  'FEDERAL',
  'CNRB',
  'CANARA',
  'UNION',
  'UBOI',
  'BOI',
  'CENTBK',
  'IOB',
  'UCOBNK',
  'PAYTM',
  'PYTM',
  'AIRTEL',
  'AMZN',
  'AMAZON',
  'PHONEPE',
  'GPAY',
  'CRED',
  'MOBIKW',
  'JUPITR',
  'JUPITER',
  'RBL',
  'AUBANK',
  'AUSFB',
  'EQUITAS',
  'BANDHAN',
  'KVB',
  'SIB',
  'DBS',
  'HSBC',
  'SCBANK',
  'CITI',
  'AMEX',
  'UPI',
  'BANK',
  'BNK',
  'CARD',
  'WALLET',
  'NPCI',
  'BHIM',
];

/**
 * True when an SMS sender could be a bank / UPI / wallet.
 *  - known bank or payment token in the sender ID  → yes
 *  - other alphanumeric DLT header ("VM-XYZ123")    → yes (the message parser still has to
 *    find a transaction in it, so promos and OTPs are dropped there)
 *  - a plain phone number / short numeric code      → no (personal chats are never scanned)
 */
export const isTransactionalSender = (address = '') => {
  const a = String(address || '')
    .trim()
    .toUpperCase();
  if (!a) return false;
  if (/^\+?[0-9][0-9\s-]*$/.test(a)) return false; // numeric sender
  const core = a.replace(/^[A-Z]{2}-/, ''); // strip operator/circle prefix "AX-"
  if (SENDER_TOKENS.some((tok) => core.includes(tok))) return true;
  return /[A-Z]/.test(core); // any other alphanumeric header
};

const firstMatch = (table, text) => {
  for (const [re, name] of table) if (re.test(text)) return name;
  return null;
};

/** Known bank in sender + body; a wallet/app provider only if no bank is named; else null. */
export const detectBank = (sender = '', body = '') => {
  // Reference numbers like "NEFT/HDFCH00000000001" name the other bank's IFSC, not this account's.
  const t = `${sender} ${body}`.toUpperCase().replace(/\b[A-Z]{4,}\d{6,}\b/g, ' ');
  return firstMatch(BANKS, t) || firstMatch(WALLET_PROVIDERS, t);
};

/** Wallet / UPI app named in sender + body (PhonePe, Paytm, ...), or null. */
export const detectWalletProvider = (sender = '', body = '') =>
  firstMatch(WALLET_PROVIDERS, `${sender} ${body}`.toUpperCase());

// ── Wallets and UPI Lite (plan A2) ────────────────────────────────────────
// Patterns marked VERIFIED come from the owner's real samples (__fixtures__/sms).
// UNVERIFIED-SAMPLE patterns are best guesses: replace them when a real message arrives.

export const WALLET_SUBTYPES = ['UPI Lite', 'Paytm Wallet', 'Amazon Pay', 'FASTag', 'Other Wallet'];

// Which wallet product a message is about.
const WALLET_PRODUCTS = [
  [/\bupi[\s-]?lite\b|\bupilite\b/i, 'UPI Lite'], // VERIFIED: "UPI LITE enabled on UPI App ..." (Axis)
  [/\bpaytm\s+wallet\b/i, 'Paytm Wallet'], // UNVERIFIED-SAMPLE
  [/\bamazon\s+pay\s+balance\b/i, 'Amazon Pay'], // UNVERIFIED-SAMPLE
  [/\bfastag\b/i, 'FASTag'], // UNVERIFIED-SAMPLE
  [/\bmobikwik\s+wallet\b|\bwallet\b.*\bmobikwik\b/i, 'Other Wallet'], // UNVERIFIED-SAMPLE
];
// Not completed yet / failed: never applied
const WALLET_NOT_DONE_RE =
  /\b(?:fail(?:ed|ure)?|unsuccessful|declined|pending|in progress|will be (?:debited|credited)|request (?:received|initiated)|otp)\b/i;
// Money moved bank → wallet. VERIFIED: "with successful top-up of INR 500.00".
// FASTag "recharge" is UNVERIFIED-SAMPLE (and only counts for FASTag).
const WALLET_TOPUP_RE = /\btop[\s-]?up\b|\badded to\b|\bloaded\b|\bload money\b/i; // only "top-up" is VERIFIED
const FASTAG_RECHARGE_RE = /\brecharge[ds]?\b/i; // UNVERIFIED-SAMPLE
// Money moved wallet → bank (withdraw, disable with balance return, reversed top-up). UNVERIFIED-SAMPLE
const WALLET_WITHDRAW_RE =
  /\bwithdraw(?:n|al)?\b|\btransferred back\b|\breversed\b|\breversal\b|\bdisabled\b|\bunload(?:ed)?\b/i;
// Refund/credit INTO the wallet from a merchant. UNVERIFIED-SAMPLE
const WALLET_CREDIT_RE = /\b(?:refund(?:ed)?|cashback|credited)\b/i;
// Payment FROM the wallet. UNVERIFIED-SAMPLE ("paid to X using UPI Lite", "deducted from FASTag")
const WALLET_SPEND_RE = /\b(?:paid|spent|sent|deducted|debited|payment of)\b/i;
// The message is about a bank account (bank perspective) rather than the wallet itself
const BANK_ACCOUNT_REF_RE = /\b(?:a\/c|acct|account)\b/i;

const WALLET_IGNORE = Object.freeze({ ignore: true });

/**
 * Wallet / UPI Lite classification. Pure.
 * Returns null for non-wallet messages, WALLET_IGNORE ({ignore:true}) for a wallet message
 * that must not be applied (failed / pending), else:
 *   { kind: 'wallet_topup'|'wallet_withdraw'|'wallet_spend'|'wallet_credit',
 *     provider: 'PhonePe'|'Paytm'|...|null, subType: 'UPI Lite'|..., perspective: 'bank'|'wallet',
 *     balanceBelongsTo: 'bank'|'wallet'|'unknown' }
 * perspective = which account the SMS is about: a bank top-up debit SMS is the bank's view.
 */
export const classifyWalletEvent = (body = '', { sender = '' } = {}) => {
  const text = String(body || '');
  const subType = firstMatch(WALLET_PRODUCTS, text);
  if (!subType) return null;
  if (WALLET_NOT_DONE_RE.test(text)) return WALLET_IGNORE;

  const provider =
    subType === 'Paytm Wallet'
      ? 'Paytm'
      : subType === 'Amazon Pay'
        ? 'Amazon Pay'
        : detectWalletProvider(sender, text);
  const isTopup = WALLET_TOPUP_RE.test(text) || (subType === 'FASTag' && FASTAG_RECHARGE_RE.test(text));
  const isWithdraw = WALLET_WITHDRAW_RE.test(text);
  const bankNamed = !!firstMatch(BANKS, `${sender} ${text}`.toUpperCase());
  // A5: a top-up/withdraw SMS sent by a bank ("UPI LITE top-up … successful … - Axis Bank") is the
  // bank's view of a bank ↔ wallet move even without an "A/c" word, so both legs get linked.
  const perspective =
    bankNamed && (BANK_ACCOUNT_REF_RE.test(text) || isTopup || isWithdraw) ? 'bank' : 'wallet';
  const balanceBelongsTo = perspective;
  const base = { provider, subType, perspective, balanceBelongsTo };

  if (isWithdraw) return { ...base, kind: 'wallet_withdraw' };
  if (isTopup) return { ...base, kind: 'wallet_topup' };
  if (perspective === 'wallet' && WALLET_CREDIT_RE.test(text) && !WALLET_SPEND_RE.test(text))
    return { ...base, kind: 'wallet_credit' };
  if (WALLET_SPEND_RE.test(text)) return { ...base, kind: 'wallet_spend' };
  return null; // wallet mentioned, but no money movement we understand (e.g. "UPI Lite enabled")
};

/**
 * 'Credit Card' for credit-card messages, 'Wallet' for messages about a wallet balance
 * itself (UPI Lite spend, Paytm Wallet, FASTag ...), otherwise 'Bank Account'.
 * Card wording wins, so RuPay-credit-card-on-UPI spends stay card expenses.
 */
// A11: a card SMS that names neither debit nor credit ("Spent / Card no. XX4821 / … / Avl Bal")
// is decided by the balance wording: a bank balance means a debit card, a limit means a credit card.
const BANK_BALANCE_RE = /\b(?:avl|avbl|available)\.?\s*bal(?:ance)?\b/i;
const CARD_LIMIT_RE = /\b(?:avl|avbl|available)\.?\s*(?:credit\s*|cr\.?\s*)?(?:limit|lmt)\b/i;
export const detectAccountType = (body = '', { sender = '' } = {}) => {
  if (/credit\s*card|\bcc\b/i.test(body)) return 'Credit Card';
  if (/\bcard\b/i.test(body) && !/debit\s*card/i.test(body)) {
    if (CARD_LIMIT_RE.test(body)) return 'Credit Card';
    if (BANK_BALANCE_RE.test(body)) return 'Bank Account';
    return 'Credit Card';
  }
  const wallet = classifyWalletEvent(body, { sender });
  if (wallet && !wallet.ignore && wallet.perspective === 'wallet') return 'Wallet';
  return 'Bank Account';
};

// ── Income vs expense ─────────────────────────────────────────────────────

/**
 * 'income' | 'expense' for a message. The earliest direction word wins.
 * Falls back to 'expense' when no direction word is present.
 */
export const detectDirection = (text = '') => {
  const d = text.search(DEBIT_WORDS);
  const c = text.search(CREDIT_WORDS);
  if (c === -1) return 'expense';
  if (d === -1) return 'income';
  return c < d ? 'income' : 'expense';
};

// ── Category guessing ─────────────────────────────────────────────────────

const CATEGORY_RULES = [
  [
    'Food',
    // "ADYAR ANAND" = Adyar Ananda Bhavan, cut off by the card network (A7)
    /zomato|swiggy|dominos|pizza|burger|restaurant|\bfood\b|\bcafe\b|\bkfc\b|\bmcd\b|mcdonald|blinkit|zepto|grofer|dunzo|bigbasket|ananda ?bhavan|adyar ?anand|\ba2b\b/i,
  ],
  [
    'Transport',
    /\buber\b|\bola\b|rapido|\bfuel\b|petrol|diesel|\bmetro\b|irctc|railway|\bcab\b|\bauto\b|\btoll\b|fastag/i,
  ],
  ['Shopping', /amazon|flipkart|myntra|ajio|nykaa|meesho|dmart|\bmart\b|\bstore\b|\bshop\b|retail/i],
  [
    'Bills',
    /\bjio\b|airtel|\bvi\b|bsnl|electricity|\bwater\b|\bgas\b|\bbill\b|recharge|netflix|spotify|hotstar|\bprime\b|\bdth\b|broadband|tatasky/i,
  ],
  [
    'Investment',
    /zerodha|groww|\bmf\b|\bsip\b|\bstocks?\b|mutual fund|upstox|angel|smallcase|demat|\bnse\b|\bbse\b/i,
  ],
  ['Salary', /salary|sal cr|payroll|stipend|pay credit/i],
  [
    'Health',
    // "PRADHANMANTRIBHARTIYAJ" = Pradhan Mantri Bhartiya Janaushadhi Kendra (truncated by the card network)
    /hospital|pharmacy|medical|doctor|clinic|apollo|netmeds|\b1mg\b|medplus|practo|\bhealth\b|jan ?aushadhi|pradhan ?mantri ?bh[a]?r[a]?tiya ?j/i,
  ],
  ['Loan/EMI', /\bemi\b|loan repay|home loan|car loan|personal loan|bajaj ?fin/i],
  ['Insurance', /insurance|\blic\b|premium|star health|hdfc ergo|tata aig/i],
  // Recurring mandate debits ("A/c has been debited towards Google ...", e-mandate, autopay)
  ['Subscriptions', /\bauto ?pay\b|\be-?mandate\b|\bmandate\b|standing instruction|debited towards/i],
  ['Rent', /\brent\b|maintenance|society|\bpg\b|hostel/i],
  ['Education', /school|college|university|\bfees?\b|tuition|education|\bcourse\b|udemy|coursera/i],
  ['UPI Transfer', /\bupi\b|\bvpa\b|\bneft\b|\brtgs\b|\bimps\b|transfer|\btrf\b/i],
  ['Cash', /\batm\b|\bcash\b|withdrawal/i],
];

export const guessCategory = (text = '') => {
  for (const [name, re] of CATEGORY_RULES) if (re.test(text)) return name;
  return 'General';
};

// ── SMS / email text → transaction ────────────────────────────────────────

/**
 * Bank/UPI reference number (UPI ref, RRN, UTR, "Ref No"), digits/letters only.
 * Used by the dedup engine to match the same payment across SMS, Gmail and
 * statements. Returns null when no reliable reference is present.
 */
// Up to 40 chars: UPI Lite references are ~35 digits ("Ref no. 0100710261640900517940...")
const REF_LABELLED_RE =
  /(?:\bupi(?:\s*ref(?:erence)?)?|\bref(?:erence)?(?:\s*(?:no|number|num|id))?|\brrn|\butr|\btxn\s*(?:id|no)|\btransaction\s*(?:id|no))\s*[:.#\-/]*\s*([A-Za-z]*\d{6,40})/i;
// Slash narration used by Axis and others: "IMPS/P2A/632013023016/baja", "UPI/P2M/630969451444/GROWW INVEST TECH P"
const CHANNEL_SLASH_RE = /\b(IMPS|UPI|NEFT|RTGS)\/(?:(P2A|P2M|P2P)\/)?([A-Za-z]*\d{6,40})\/([^\n/]{1,60})/i;
// A6: the slash narration runs into the bank's trailer ("C DA.View bal: https:", "BAJA. Chk Bal").
const SLASH_PAYEE_STOP_RE = /\.?\s*(?:view\s*bal|chk\s*bal|check\s*bal|https?:|not\s*you)|\s+-\s+/i;
/** Counterparty from a slash narration, cut at the trailer and trimmed of punctuation. */
export const cleanSlashPayee = (raw = '') => {
  let v = String(raw);
  const stop = v.search(SLASH_PAYEE_STOP_RE);
  if (stop >= 0) v = v.slice(0, stop);
  return v.replace(/^[\s.,:;-]+|[\s.,:;/-]+$/g, '') || null;
};
// A bare 12-digit number right after "+", "to " or "call" is a phone number (helpline / "SMS BLOCK ... to 91..."), not a ref
const PHONE_BEFORE_RE = /(?:\+|\bto\s*\+?|\bcall\s*:?\s*\+?)$/i;
export const extractRefNo = (text = '') => {
  const s = String(text);
  const slash = s.match(CHANNEL_SLASH_RE);
  if (slash) return slash[3].toUpperCase();
  const labelled = s.match(REF_LABELLED_RE);
  if (labelled) return labelled[1].toUpperCase();
  const bare = /\b(\d{12})\b/g;
  let m;
  while ((m = bare.exec(s)) !== null) {
    if (!PHONE_BEFORE_RE.test(s.slice(Math.max(0, m.index - 10), m.index))) return m[1];
  }
  return null;
};

/**
 * Payment rail and counterparty: { channel: 'IMPS'|'UPI'|'NEFT'|'RTGS'|'BBPS'|'NACH'|'ACH'|'ECS'|'SI'|null,
 * mode: 'P2A'|'P2M'|'P2P'|null, counterparty: string|null }.
 */
export const extractChannel = (text = '') => {
  const s = String(text);
  const slash = s.match(CHANNEL_SLASH_RE);
  if (slash)
    return {
      channel: slash[1].toUpperCase(),
      mode: slash[2]?.toUpperCase() || null,
      counterparty: cleanSlashPayee(slash[4]),
    };
  // C4: auto-debit mandates. "ACH-DR-<lender>" is from the owner's Axis SMS (Bajaj Finance).
  if (/\bACH[- ]?DR\b/i.test(s)) return { channel: 'ACH', mode: null, counterparty: null };
  // UNVERIFIED-SAMPLE: ECS and standing-instruction ("SI-") debits; no real SMS seen yet (D0).
  if (/\bECS\b/.test(s)) return { channel: 'ECS', mode: null, counterparty: null };
  if (/\bSI-[A-Z]/.test(s)) return { channel: 'SI', mode: null, counterparty: null };
  const named =
    s.match(/\bvia\s+(UPI|IMPS|NEFT|RTGS|BBPS|NACH)\b/i) || s.match(/\b(IMPS|NEFT|RTGS|BBPS|NACH|UPI)\b/i);
  return { channel: named ? named[1].toUpperCase() : null, mode: null, counterparty: null };
};

// Masked account / card digits: "A/c no. XX0973", "A/C *1234", "Equitas A/c 1246", "ending 1987", "Card no. XX9070"
const LAST4_PATTERNS = [
  /\bending(?:\s+(?:with|in))?\s*[X*]*\s*(\d{3,18})\b/i,
  /\b(?:a\/c|acct|account|card)\b\.?\s*(?:no\.?|number)?\s*[:.]?\s*[X*]*\s*(\d{3,18})\b/i,
  /\b[X*]{2,}(\d{3,18})\b/i,
];
/** Last 4 digits of the account/card the message is about (3 if the bank masks to 3), or null. */
export const extractLast4 = (text = '') => {
  for (const re of LAST4_PATTERNS) {
    const m = String(text).match(re);
    if (m) return m[1].slice(-4);
  }
  return null;
};

// A11: account digits and card digits are different numbers on a debit-card SMS
// ("debited from A/c XX5678 using SBI Debit Card XX9911").
const ACCOUNT_DIGITS_RE = /\b(?:a\/c|acct|account)\b\.?\s*(?:no\.?|number)?\s*[:.]?\s*[X*]*\s*(\d{3,18})\b/i;
const CARD_DIGITS_RE =
  /\bcard\b\.?\s*(?:no\.?|number)?\s*(?:ending(?:\s+(?:with|in))?)?\s*[:.]?\s*[X*]*\s*(\d{3,18})\b/i;
/** Digits after "A/c" / "Acct" / "Account", or null. */
export const extractAccountLast4 = (text = '') => {
  const m = String(text).match(ACCOUNT_DIGITS_RE);
  return m ? m[1].slice(-4) : null;
};
/** Digits after "Card" ("Card no. XX4821", "Debit Card XX9911", "card ending 1234"), or null. */
// Axis puts the debit card only in the block instruction: "SMS BLOCKCARD XX8285 to +91..."
const BLOCKCARD_RE = /\bblock\s*card\s+[X*]*(\d{4,18})\b/i;
export const extractCardLast4 = (text = '') => {
  const m = String(text).match(CARD_DIGITS_RE) || String(text).match(BLOCKCARD_RE);
  return m ? m[1].slice(-4) : null;
};

const LIMIT_RE =
  /(?:avl|avbl|available)\.?\s*(?:credit\s*|cr\.?\s*)?limit\s*(?:is\s*)?[:\-\s]*(?:rs\.?|inr|₹)?\s*\.?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
/** Credit-card available limit ("Avl limit: INR 275541.19"), or null. Never a balance. */
export const extractAvailableLimit = (text = '') => {
  const m = String(text).match(LIMIT_RE);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return isNaN(n) ? null : n;
};

// "We have received payment of Rs.5,770.00 via BBPS & the same has been credited to your SBI Credit Card"
// "Payment of INR 9145.91 has been received towards your Axis Bank Credit Card": the gap must allow
// the decimal point in the amount, so it is a bounded lazy match rather than [^.]* (A3).
const CC_PAYMENT_RE =
  /\bpayment\b[\s\S]{0,80}?\b(?:received|credited)\b|\b(?:received|credited)\b[\s\S]{0,80}?\bpayment\b/i;
const NOT_CC_PAYMENT_RE = /\brefund|\breversal|\bcashback|\bspent\b|\bpurchase\b/i;
const isCardPayment = (body, accountType) =>
  accountType === 'Credit Card' && CC_PAYMENT_RE.test(body) && !NOT_CC_PAYMENT_RE.test(body);
// A4: a bank debit whose payee/narration is a credit-card bill ("UPI/P2M/.../Amazon Pay Credit C",
// "CC BILL", "CRED Club", "BBPS ... card"). The card's own spends are already expenses, so the bill
// is a transfer bank → card, not spending.
export const CARD_BILL_PAYEE_RE =
  /credit\s*c(?:ard)?\b|\bcc\s*(?:bill|payment)\b|cred\s*club|\bbbps\b.*card/i;
const isCardBillFromBank = (payee, accountType, type) =>
  accountType === 'Bank Account' && type === 'expense' && !!payee && CARD_BILL_PAYEE_RE.test(payee);
// Statement "Ref No" cells: keep only values long enough to be a real reference
const normRef = (v) => {
  const r = String(v || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  return r.length >= 6 ? r : null;
};

const DEBITED_ON_PAYEE_RE =
  /\bdebited from a\/?c(?:count)?\.?(?:\s*no\.?)?\s*[X*]*\d{3,18}\s+on\s+([a-z][a-z0-9 .&_-]{1,40}?)\s+\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/i;
const MERCHANT_RE =
  /\b(?:paid to|sent to|received from|towards|at|to)\s+([a-z][a-z0-9 .&_-]{1,60}?)(?=\s+(?:on|via|using|ref|upi|avl|available|bal|from|for)\b|[.;\n]|$)/i;
// "credited to your SBI Credit Card" names the account, not a merchant
const NOT_MERCHANT_RE = /^(?:your|you|the|a\/c|ac|acct|account)\b/i;
/**
 * The message with the payee removed, so bank / account-type detection describes the
 * account money moved FROM/TO, not the payee: "A/c XX0973 debited ... UPI/P2M/.../SBI CARD
 * ... Axis Bank" is an Axis bank debit, not an SBI credit-card transaction.
 */
export const ownAccountText = (text = '') => {
  let t = String(text).replace(
    CHANNEL_SLASH_RE,
    (m, ch, mode, ref) => `${ch}/${mode ? `${mode}/` : ''}${ref}/ `
  );
  const payee = t.match(MERCHANT_RE)?.[1];
  if (payee && !NOT_MERCHANT_RE.test(payee.trim())) t = t.replace(payee, ' ');
  return t;
};
// A7: NACH/ACH auto-debit narration "ACH-DR-BAJAJ FINANCE LTD-V" → "Bajaj Finance"
const ACH_DR_RE = /\bN?ACH[-\s]*DR[-\s]+([^\n]{2,60})/i;
const COMPANY_SUFFIX_RE = /\s+(?:ltd|limited|pvt|private|co|corp|inc|llp)\.?$/i;
const titleCase = (v) => v.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
export const extractAchPayee = (text = '') => {
  const m = String(text).match(ACH_DR_RE);
  if (!m) return null;
  let name = m[1].split(/\s*-\s*/)[0].trim();
  while (COMPANY_SUFFIX_RE.test(name)) name = name.replace(COMPANY_SUFFIX_RE, '');
  return /[a-z]{2}/i.test(name) ? titleCase(name) : null;
};
export const extractMerchant = (text = '') => {
  const s = String(text);
  const vpa = s.match(/\b([a-z0-9._-]+@[a-z0-9.-]+)\b/i)?.[1] || null;
  const slash = s.match(CHANNEL_SLASH_RE);
  let merchant = slash ? cleanSlashPayee(slash[4]) : extractAchPayee(s);
  // Axis debit card: "debited from A/c no. XX620973 on NGEF KASTUR 11-11-2026 17:30:31"
  if (!merchant) merchant = s.match(DEBITED_ON_PAYEE_RE)?.[1]?.trim() || null;
  if (!merchant) {
    const candidate = s.match(MERCHANT_RE)?.[1]?.trim();
    if (candidate && !NOT_MERCHANT_RE.test(candidate)) merchant = candidate;
  }
  return { merchant: merchant || vpa, vpa };
};

const TRANSFER_RAILS = ['IMPS', 'NEFT', 'RTGS'];

/**
 * Parse an SMS or email body. Returns null if it is not a transaction.
 *
 * type: 'income' | 'expense' | 'transfer'. A transfer is ONE side of a money move that
 * does not change net worth (card bill payment, wallet top-up). `flow` says which way
 * money moved for the account this message is about ('in' | 'out'), so the pipeline can
 * apply that leg even before the other account is known.
 *
 * needsAccountReview: the message names no account digits and is not about a card, so
 * the bank may have several matching accounts (pipeline decides).
 * transferCandidate: IMPS/NEFT/RTGS debit to a person/account - possibly a self-transfer.
 */
// Wallet event → parser fields. Bank-perspective top-up/withdraw = one-sided transfer of the
// bank; wallet-perspective spend/credit = expense/income ON the wallet account.
const WALLET_SHAPES = {
  wallet_topup: { bank: { type: 'transfer', flow: 'out' }, wallet: { type: 'transfer', flow: 'in' } },
  wallet_withdraw: { bank: { type: 'transfer', flow: 'in' }, wallet: { type: 'transfer', flow: 'out' } },
  wallet_spend: { bank: { type: 'expense', flow: null }, wallet: { type: 'expense', flow: null } },
  wallet_credit: { bank: { type: 'income', flow: null }, wallet: { type: 'income', flow: null } },
};
const WALLET_CATEGORY = { wallet_topup: 'Wallet Top-up', wallet_withdraw: 'Wallet Withdrawal' };

export const parseTransactionText = (body, { sender = '', bankFallback = 'Unknown Bank' } = {}) => {
  // B7: statements become the card's bill; lender EMI receipts repeat the bank debit.
  if (isNonTransactionNotice(body)) return null;
  if (!body) return null;
  const wallet = classifyWalletEvent(body, { sender });
  if (wallet && wallet.ignore) return null;
  // A recognised wallet event skips the generic ignore/keyword gates: its own rules decided
  // (e.g. a real top-up that also says "offer", or "top-up" with no "debited" word).
  if (!wallet) {
    if (IGNORE_RE.test(body)) return null;
    if (!TXN_WORD_RE.test(body)) return null;
  }

  const amount = extractAmount(body);
  if (amount === null || amount <= 0) return null;

  const own = ownAccountText(body);
  const accountType = detectAccountType(own, { sender });
  // A11: on a bank (debit card) SMS the card digits are not the account's digits
  const cardLast4 = /\bcard\b|\bblock\s*card\b/i.test(body) ? extractCardLast4(body) : null;
  const last4 = accountType === 'Bank Account' && cardLast4 ? extractAccountLast4(own) : extractLast4(body);
  const { channel, mode, counterparty } = extractChannel(body);
  let type = detectDirection(body);
  let category = guessCategory(body);
  let kind = null;
  let flow = null;
  if (wallet) {
    ({ type, flow } = WALLET_SHAPES[wallet.kind][wallet.perspective]);
    if (type === 'transfer') kind = wallet.kind;
    category = WALLET_CATEGORY[wallet.kind] || category;
  } else if (isCardPayment(own, accountType)) {
    type = 'transfer';
    kind = 'cc_payment';
    flow = 'in';
    category = 'Card Payment';
  }
  const merchantInfo = extractMerchant(body);
  if (!wallet && isCardBillFromBank(counterparty || merchantInfo.merchant, accountType, type)) {
    type = 'transfer';
    kind = 'cc_bill';
    flow = 'out';
    category = 'Card Payment';
  }
  const isTransfer = type === 'transfer';
  const bankName =
    wallet && wallet.perspective === 'wallet'
      ? wallet.provider || detectBank(sender, own) || bankFallback
      : detectBank(sender, own) || bankFallback;

  return {
    amount,
    ...merchantInfo,
    merchant: isTransfer ? null : merchantInfo.merchant,
    type,
    kind,
    flow,
    category,
    walletEvent: wallet ? { kind: wallet.kind, provider: wallet.provider, subType: wallet.subType } : null,
    subType: wallet ? wallet.subType : null,
    provider: wallet ? wallet.provider : null,
    balanceBelongsTo: wallet ? wallet.balanceBelongsTo : null,
    bankName,
    balance: extractBalance(body),
    availableLimit: extractAvailableLimit(body),
    accountType,
    last4,
    cardLast4,
    channel,
    channelMode: mode,
    counterparty,
    refNo: extractRefNo(body),
    needsAccountReview: !last4 && accountType === 'Bank Account',
    transferCandidate: type === 'expense' && TRANSFER_RAILS.includes(channel) && mode !== 'P2M',
  };
};

// ── Dates & amounts (statements) ──────────────────────────────────────────

const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const MONTH_NAMES =
  'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';

const fullYear = (y) => (String(y).length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10));
const mkDate = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m, d, 12, 0, 0)); // noon UTC: safe from timezone day-shifts
  return dt.getUTCMonth() === m && dt.getUTCDate() === d ? dt : null; // rejects 31/02 etc.
};

export const parseDate = (val) => {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val) ? null : val;
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000); // Excel serial
    return isNaN(d) ? null : d;
  }
  const s = String(val).trim();
  let m;
  // YYYY-MM-DD
  if ((m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/))) return mkDate(+m[1], +m[2] - 1, +m[3]);
  // DD/MM/YYYY, DD-MM-YY
  if ((m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/)))
    return mkDate(fullYear(m[3]), +m[2] - 1, +m[1]);
  // 05 Jan 2024, 05-Jan-24, 5 January, 2024
  if ((m = s.match(new RegExp(`^(\\d{1,2})[ \\-/.]*(${MONTH_NAMES})[a-z]*[ \\-/.,]*(\\d{2,4})\\b`, 'i')))) {
    return mkDate(fullYear(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
};

export const parseAmount = (val) => {
  if (val === undefined || val === null || val === '') return null;
  const s = String(val).replace(/,/g, '').replace(/₹/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.abs(n);
};

const fmtDate = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// ── Statement column detection ────────────────────────────────────────────

// Checked in this order; a header cell is assigned to the FIRST key it matches.
// Word boundaries matter: "Description" must not match "cr", "Details" not "dt".
const HEADER_PATTERNS = [
  [
    'drCr',
    /^(dr\s*[\/.]?\s*cr|cr\s*[\/.]?\s*dr|debit\s*[\/.]?\s*credit|credit\s*[\/.]?\s*debit|(?:txn|transaction)\s*type|type)\.?$/i,
  ],
  ['date', /\b(date|dt)\b/i],
  ['refNo', /\b(ref(?:erence)?|utr|cheque|chq|txn\s*id|transaction\s*id)\b/i],
  ['balance', /\b(balance|bal|closing)\b/i],
  ['debit', /\b(debits?|dr|withdrawals?|withdrawl|paid\s*out|money\s*out)\b/i],
  ['credit', /\b(credits?|cr|deposits?|received|paid\s*in|money\s*in)\b/i],
  ['amount', /^(?:transaction\s*|txn\s*)?(?:amount|amt)(?:\s*\(.*\))?\.?$/i],
  ['narration', /\b(narration|description|particulars|details|remarks|merchant|note)\b/i],
];

export const detectColumns = (headers) => {
  const cols = {};
  headers.forEach((h, i) => {
    if (h === undefined || h === null) return;
    const hs = String(h).trim();
    if (!hs) return;
    for (const [key, re] of HEADER_PATTERNS) {
      if (re.test(hs)) {
        if (cols[key] === undefined) cols[key] = i; // `!cols[key]` wrongly treated index 0 as unset
        break; // one column → one meaning
      }
    }
  });
  return cols;
};

const hasUsableColumns = (c) =>
  c.date !== undefined && (c.amount !== undefined || (c.debit !== undefined && c.credit !== undefined));

// ── Statement row helpers (plan A5, B8) ───────────────────────────────────

// UNVERIFIED-SAMPLE: bank-statement narration for UPI Lite top-ups / withdrawals
const STATEMENT_LITE_RE = /upi[\s-]?lite|upilite|lite[\s-]?top[\s-]?up/i;

/**
 * A statement row whose narration says UPI Lite is money moving between the bank and the
 * wallet: a debit is a top-up (transfer out of the bank), a credit a withdrawal back.
 * Returns the fields to merge into the row, or null.
 */
export const statementWalletFields = (narration, type) => {
  if (!STATEMENT_LITE_RE.test(String(narration || ''))) return null;
  const topup = type !== 'income';
  return {
    type: 'transfer',
    transferKind: topup ? 'wallet_topup' : 'wallet_withdraw',
    flow: topup ? 'out' : 'in',
    walletSubType: 'UPI Lite',
    category: topup ? 'Wallet Top-up' : 'Wallet Withdrawal',
  };
};

// FNV-1a: tiny deterministic string hash (no imports, so the parser stays pure)
const fnv1a = (str) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

/**
 * Deterministic row IDs (B8): the same row in a re-imported file gets the same ID, and two
 * identical rows in one file differ by occurrence index. Call once per file.
 */
export const makeRowIdFactory = (prefix, account = '') => {
  const seen = new Map();
  return ({ date, amount, refNo, narration }) => {
    const key = [
      account,
      date.toISOString().slice(0, 10),
      Number(amount).toFixed(2),
      refNo || '',
      narration || '',
    ]
      .join('|')
      .toLowerCase();
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    return `${prefix}_${date.toISOString().slice(0, 10).replace(/-/g, '')}_${fnv1a(key)}_${n}`;
  };
};

const guessType = (drCr, narration = '') => {
  if (drCr) {
    const dc = drCr.trim().toUpperCase();
    if (dc === 'CR' || dc === 'CREDIT' || dc === 'C') return 'income';
    if (dc === 'DR' || dc === 'DEBIT' || dc === 'D') return 'expense';
  }
  if (/salary|credited|received|\bcr\b/i.test(narration)) return 'income';
  return 'expense';
};

/**
 * Parse spreadsheet rows (array of arrays, header row somewhere near the top).
 * Pure: the caller does the file reading / xlsx decoding.
 */
export const parseStatementRows = (rawRows, bankHint = '') => {
  const rowId = makeRowIdFactory('stmt', bankHint);
  // Header row = first row (within 30) that yields a usable column map
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 30); i++) {
    if (hasUsableColumns(detectColumns(rawRows[i] || []))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    // Fallback: first row with >= 3 non-empty cells
    headerIdx = 0;
    for (let i = 0; i < Math.min(rawRows.length, 15); i++) {
      const nonEmpty = (rawRows[i] || []).filter((c) => c && String(c).trim()).length;
      if (nonEmpty >= 3) {
        headerIdx = i;
        break;
      }
    }
  }

  const headers = (rawRows[headerIdx] || []).map((h) => String(h || '').trim());
  const cols = detectColumns(headers);
  const transactions = [];

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every((c) => !c || String(c).trim() === '')) continue;

    const date = parseDate(cols.date !== undefined ? row[cols.date] : null);
    if (!date) continue;

    const narration = cols.narration !== undefined ? String(row[cols.narration] || '').trim() : '';

    let amount = null;
    let txType = 'expense';
    if (cols.debit !== undefined && cols.credit !== undefined) {
      const debit = parseAmount(row[cols.debit]);
      const credit = parseAmount(row[cols.credit]);
      if (credit && credit > 0) {
        amount = credit;
        txType = 'income';
      } else if (debit && debit > 0) {
        amount = debit;
        txType = 'expense';
      }
    } else if (cols.amount !== undefined) {
      amount = parseAmount(row[cols.amount]);
      const drCrVal = cols.drCr !== undefined ? String(row[cols.drCr] || '') : '';
      txType = guessType(drCrVal, narration);
    }
    if (!amount || amount <= 0) continue;

    const balance = cols.balance !== undefined ? parseAmount(row[cols.balance]) : null;
    const refNo = cols.refNo !== undefined ? String(row[cols.refNo] || '').trim() : null;
    const category = guessCategory(narration);
    const wallet = statementWalletFields(narration, txType);

    transactions.push({
      id: rowId({ date, amount, refNo, narration }),
      title: narration || category,
      amount,
      type: txType,
      date: fmtDate(date),
      fullDate: date.toISOString(),
      category,
      account: bankHint || 'Bank Statement',
      tags: ['imported'],
      note: refNo ? `Ref: ${refNo}` : '',
      refNo: normRef(refNo) || extractRefNo(narration),
      extractedBalance: balance,
      source: 'statement',
      ...(wallet || {}),
    });
  }
  return transactions;
};

// ── PDF text lines → transactions ─────────────────────────────────────────

const PDF_DATE_RE = new RegExp(
  `\\b(\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[ \\-/.]*(?:${MONTH_NAMES})[a-z]*[ \\-/.,]*\\d{2,4})\\b`,
  'i'
);
const PDF_AMOUNT_RE = /(?:Rs\.?|INR|₹)?\s*([0-9][0-9,]*\.[0-9]{2})\b/g;

/**
 * Parse text produced by the PDF WebView (one statement row per line).
 * Direction comes from, in order: a Cr/Dr marker next to the amount, the change
 * in running balance versus the previous row, then narration keywords.
 */
export const parsePdfText = (text, bankHint = '') => {
  const rowId = makeRowIdFactory('pdf', bankHint);
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const transactions = [];
  let prevBalance = null;

  for (const line of lines) {
    const dateMatch = line.match(PDF_DATE_RE);
    if (!dateMatch) continue;
    const date = parseDate(dateMatch[0]);
    if (!date) continue;

    const amounts = [];
    let m;
    const re = new RegExp(PDF_AMOUNT_RE.source, 'g');
    while ((m = re.exec(line)) !== null) amounts.push(parseFloat(m[1].replace(/,/g, '')));
    if (amounts.length === 0) continue;

    // Last amount is the running balance when the row has 2+ amounts
    const balance = amounts.length >= 2 ? amounts[amounts.length - 1] : null;
    const amount = amounts.find((a) => a > 0);
    if (!amount) continue;

    let type = null;
    if (/\bCr\b/.test(line) && !/\bDr\b/.test(line)) type = 'income';
    else if (/\bDr\b/.test(line) && !/\bCr\b/.test(line)) type = 'expense';
    if (!type && balance !== null && prevBalance !== null && Math.abs(balance - prevBalance) > 0.004) {
      type = balance > prevBalance ? 'income' : 'expense';
    }
    if (!type) type = /salary|credited|received|refund|interest|\bcr\b/i.test(line) ? 'income' : 'expense';
    if (balance !== null) prevBalance = balance;

    const narration = line
      .replace(PDF_DATE_RE, '')
      .replace(/[0-9][0-9,]*\.[0-9]{2}/g, '')
      .replace(/Rs\.?|INR|₹/g, '')
      .replace(/\b(Cr|Dr)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    const category = guessCategory(narration);
    const wallet = statementWalletFields(narration, type);

    transactions.push({
      id: rowId({ date, amount, refNo: null, narration: line }),
      title: narration || category,
      amount,
      type,
      date: fmtDate(date),
      fullDate: date.toISOString(),
      category,
      account: bankHint || 'PDF Statement',
      tags: ['PDF Import'],
      refNo: extractRefNo(line.replace(PDF_DATE_RE, '')),
      extractedBalance: balance,
      source: 'pdf',
      ...(wallet || {}),
    });
  }
  return transactions;
};
