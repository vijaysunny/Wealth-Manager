/**
 * AiTasks.js - what the app asks the LLM to do, and the checks on every answer.
 *
 * Trust rules (an LLM can invent things):
 *  - An amount is accepted only if that number literally appears in the source text.
 *  - type / category must come from a fixed list; anything else falls back to safe defaults.
 *  - Reference numbers, last-4 digits and balances are extracted LOCALLY by the regex parser,
 *    never taken from the model.
 *  - Long digit runs (phone numbers, full account numbers) are masked before text leaves the phone.
 *  - Everything AI-made is tagged 'ai' and SMS rows land in the normal review queue (pending).
 */
import { isNonTransactionNotice } from '../CardStatementSms';
import { askAi } from './AiClient';
import {
  extractRefNo,
  extractLast4,
  extractBalance,
  extractAmount,
  makeRowIdFactory,
  parseDate,
} from '../TransactionParser';
import { buildSmsId, hashText } from '../DeduplicationEngine';
import { isReportable } from '../BalanceService';

export const DEFAULT_CATEGORIES = [
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
  'Cash',
  'General',
];
const SMS_TYPES = ['expense', 'income'];
const ACCOUNT_TYPES = ['Bank Account', 'Credit Card', 'Wallet'];
const SMS_BATCH = 8;
const CATEGORIZE_BATCH = 40;
const STATEMENT_CHUNK = 7000;
const MAX_STATEMENT_CHUNKS = 8;

// ── helpers (pure, exported for tests) ────────────────────────────────────

/** Mask 9+ digit runs (phones, full account/card numbers). Amounts and XX1234 stay readable. */
export const redact = (text = '') =>
  String(text).replace(/\d[\d -]{7,}\d/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '#########' : m));

/** Every number written in the text (handles 1,23,456.78 and Rs.500). */
export const numbersIn = (text = '') =>
  (String(text).match(/\d[\d,]*(?:\.\d+)?/g) || [])
    .map((n) => parseFloat(n.replace(/,/g, '')))
    .filter(Number.isFinite);

export const amountInText = (amount, text) => {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) return false;
  return numbersIn(text).some((n) => Math.abs(n - a) < 0.005);
};

const pick = (value, allowed, fallback) => {
  const v = String(value || '').trim();
  return allowed.find((x) => x.toLowerCase() === v.toLowerCase()) || fallback;
};
const cleanText = (v, max = 60) => {
  const s = String(v || '')
    .replace(/\s+/g, ' ')
    .trim();
  return s && !/^(null|none|unknown|n\/a)$/i.test(s) ? s.slice(0, max) : null;
};

/** Worth sending to the AI: the regex parser missed it but it looks like money moved. */
const MONEY_WORD_RE =
  /debit|credit|spent|paid|payment|received|sent|withdrawn|deposit|txn|transaction|transferred|purchase|refund|deducted|charged/i;
const NOISE_RE =
  /\botp\b|one[- ]time password|verification code|\bcode is\b|will be debited|due (on|date)|\boffer\b|cashback up to|win |\bloan of\b|pre-?approved|apply now/i;
export const isAiSmsCandidate = (body = '') =>
  !!body &&
  extractAmount(body) > 0 &&
  MONEY_WORD_RE.test(body) &&
  !NOISE_RE.test(body) &&
  !isNonTransactionNotice(body); // B7: statements and lender EMI receipts

const categoryList = (categories) => [...new Set([...(categories || []), 'General'])];

// ── 1. SMS the regex parser could not read ────────────────────────────────

const SMS_SYSTEM = `You read Indian bank, card, UPI and wallet SMS and extract the transaction.
Reply with JSON only. Never guess an amount that is not written in the message.
A message is a transaction only if money already moved (debited/credited/spent/received).
OTPs, offers, reminders, bill-due notices and future debits are NOT transactions.`;

/** Validate one model result against its SMS; returns parser-shaped fields or null. */
export const validateSmsResult = (r, sms, categories) => {
  if (!r || r.isTransaction !== true) return null;
  const amount = Number(r.amount);
  if (!amountInText(amount, sms.body)) return null;
  // AI rows are never 'transfer': transfers need the regex parser's kind/flow to move balances
  // safely. A move between own accounts stays an expense the user can re-mark in Review.
  const type = pick(r.type === 'transfer' ? 'expense' : r.type, SMS_TYPES, null);
  if (!type) return null;
  return {
    amount,
    type,
    category: r.type === 'transfer' ? 'UPI Transfer' : pick(r.category, categoryList(categories), 'General'),
    merchant: r.type === 'transfer' ? null : cleanText(r.merchant),
    bankName: cleanText(r.bank, 40) || 'Unknown Bank',
    accountType: pick(r.accountType, ACCOUNT_TYPES, 'Bank Account'),
  };
};

/** Turn validated fields into the same item shape scanBankSms produces. */
export const toSmsItem = (sms, f) => {
  const last4 = extractLast4(sms.body);
  return {
    id: sms.id,
    smsId: buildSmsId(sms.sender, sms.date, f.amount),
    bodyHash: hashText(sms.body),
    refNo: extractRefNo(sms.body),
    date: sms.date,
    body: sms.body,
    sender: sms.sender,
    amount: f.amount,
    type: f.type,
    category: f.category,
    merchant: f.merchant,
    vpa: null,
    bankName: f.bankName,
    currentBalance: extractBalance(sms.body),
    accountType: f.accountType,
    // same fields capturedFields() produces for regex-parsed SMS
    captured: {
      accountType: f.accountType,
      last4,
      channel: null,
      counterparty: null,
      availableLimit: null,
      bankName: f.bankName,
      ...(!last4 && f.accountType === 'Bank Account' ? { needsAccountReview: true } : {}),
      ...(f.type === 'expense' && f.category === 'UPI Transfer' ? { transferCandidate: true } : {}),
      aiParsed: true,
    },
  };
};

/**
 * smsList: [{ id, body, sender, date }]. Returns scan-shaped items (only real transactions).
 * Batches of SMS_BATCH; a failed batch is skipped, never fatal.
 */
export const aiParseSms = async (smsList, { categories = DEFAULT_CATEGORIES, ask = askAi } = {}) => {
  const out = [];
  for (let i = 0; i < smsList.length; i += SMS_BATCH) {
    const batch = smsList.slice(i, i + SMS_BATCH);
    const prompt = `Categories: ${categoryList(categories).join(', ')}
For each SMS return {"results":[{"i":<index>,"isTransaction":true|false,"amount":<number>,"type":"expense|income|transfer","merchant":"<payee/payer or null>","bank":"<bank or wallet name>","accountType":"Bank Account|Credit Card|Wallet","category":"<one category>"}]}
"transfer" = moving money between the user's own accounts or paying a credit-card bill.

${batch.map((s, j) => `[${j}] From ${s.sender}: ${redact(s.body)}`).join('\n')}`;
    try {
      const { data } = await ask({
        job: 'sms',
        system: SMS_SYSTEM,
        prompt,
        json: true,
        validate: (d) => {
          if (!Array.isArray(d.results)) throw new Error('missing results');
        },
      });
      for (const r of data.results) {
        const sms = batch[Number(r.i)];
        if (!sms) continue;
        const f = validateSmsResult(r, sms, categories);
        if (f) out.push(toSmsItem(sms, f));
      }
    } catch (e) {
      console.log('AI SMS parse skipped:', e.message);
    }
  }
  return out;
};

// ── 2. Categorize ─────────────────────────────────────────────────────────

/** txs: [{ id, title, merchant, amount, type, note }]. Returns Map(id → category), only changes. */
export const aiCategorize = async (txs, { categories = DEFAULT_CATEGORIES, ask = askAi } = {}) => {
  const allowed = categoryList(categories);
  const result = new Map();
  for (let i = 0; i < txs.length; i += CATEGORIZE_BATCH) {
    const batch = txs.slice(i, i + CATEGORIZE_BATCH);
    const prompt = `Allowed categories: ${allowed.join(', ')}
Pick the best category for each Indian bank transaction. Use "General" only if nothing fits.
Return JSON {"results":[{"i":<index>,"category":"<allowed category>"}]}

${batch
  .map(
    (t, j) =>
      `[${j}] ${t.type} ₹${t.amount} — ${redact(cleanText([t.merchant, t.title, t.note].filter(Boolean).join(' | '), 140) || '')}`
  )
  .join('\n')}`;
    try {
      const { data } = await ask({
        job: 'categorize',
        system: 'You categorize personal finance transactions. Reply with JSON only.',
        prompt,
        json: true,
        validate: (d) => {
          if (!Array.isArray(d.results)) throw new Error('missing results');
        },
      });
      for (const r of data.results) {
        const tx = batch[Number(r.i)];
        const cat = pick(r.category, allowed, null);
        if (tx && cat && cat !== 'General' && cat !== tx.category) result.set(tx.id, cat);
      }
    } catch (e) {
      console.log('AI categorize skipped:', e.message);
    }
  }
  return result;
};

// ── 3. Statements the regex parsers could not read ────────────────────────

const chunkLines = (text) => {
  const chunks = [];
  let cur = '';
  for (const line of String(text).split('\n')) {
    if (cur.length + line.length + 1 > STATEMENT_CHUNK && cur) {
      chunks.push(cur);
      cur = '';
    }
    cur += `${line.slice(0, STATEMENT_CHUNK)}\n`;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks.slice(0, MAX_STATEMENT_CHUNKS);
};

const fmtDate = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Validate model rows against the chunk they came from; returns ImportScreen preview rows. */
export const validateStatementRows = (
  rows,
  chunk,
  { bankHint = '', categories = DEFAULT_CATEGORIES, rowId } = {}
) => {
  const allowed = categoryList(categories);
  const id = rowId || makeRowIdFactory('ai', bankHint);
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const amount = Math.abs(Number(r.amount));
    if (!amountInText(amount, chunk)) continue;
    const date = parseDate(r.date);
    if (!date) continue;
    const type = pick(r.type, ['expense', 'income'], null);
    if (!type) continue;
    const narration = cleanText(r.description, 60) || '';
    const balance =
      r.balance != null && amountInText(Math.abs(Number(r.balance)), chunk) ? Number(r.balance) : null;
    out.push({
      id: id({ date, amount, refNo: null, narration: `${narration}|${r.balance ?? ''}` }),
      title: narration || 'Statement entry',
      amount,
      type,
      date: fmtDate(date),
      fullDate: date.toISOString(),
      category: pick(r.category, allowed, 'General'),
      account: bankHint || 'Bank Statement',
      tags: ['imported', 'ai'],
      refNo: extractRefNo(narration),
      extractedBalance: balance,
      source: 'statement',
    });
  }
  return out;
};

/** text: statement as plain text (PDF text or CSV). Returns preview rows (user confirms before save). */
export const aiParseStatement = async (
  text,
  { bankHint = '', categories = DEFAULT_CATEGORIES, ask = askAi } = {}
) => {
  const rowId = makeRowIdFactory('ai', bankHint);
  const rows = [];
  for (const chunk of chunkLines(text)) {
    const { data } = await ask({
      job: 'statement',
      system: 'You extract transactions from Indian bank and card statements. Reply with JSON only.',
      prompt: `Categories: ${categoryList(categories).join(', ')}
Extract every transaction row. Skip opening/closing balance, totals and headers.
Return {"rows":[{"date":"YYYY-MM-DD","description":"<narration>","amount":<positive number>,"type":"expense|income","balance":<number or null>,"category":"<category>"}]}
Debits/withdrawals are "expense"; credits/deposits are "income".

${redact(chunk)}`,
      json: true,
      timeoutMs: 60000,
      validate: (d) => {
        if (!Array.isArray(d.rows)) throw new Error('missing rows');
      },
    });
    rows.push(...validateStatementRows(data.rows, chunk, { bankHint, categories, rowId }));
  }
  return rows;
};

// ── 4. Spending insights ──────────────────────────────────────────────────

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * Aggregate summary sent to the model: totals only, no SMS text, no account numbers.
 * Transfers are excluded from spending; `months` most recent months.
 */
export const buildSpendingSummary = (txs, { budgets = {}, months = 3, now = new Date() } = {}) => {
  const keys = [];
  for (let i = months - 1; i >= 0; i--)
    keys.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  const byMonth = Object.fromEntries(
    keys.map((k) => [k, { income: 0, expense: 0, categories: {}, merchants: {} }])
  );
  for (const t of txs) {
    if (!isReportable(t) || !t.fullDate) continue;
    const m = byMonth[monthKey(new Date(t.fullDate))];
    if (!m) continue;
    const amt = Number(t.amount) || 0;
    if (t.type === 'income') m.income += amt;
    else if (t.type === 'expense') {
      m.expense += amt;
      const c = t.category || 'General';
      m.categories[c] = (m.categories[c] || 0) + amt;
      const who = cleanText(t.merchant || t.title, 30);
      if (who) m.merchants[who] = (m.merchants[who] || 0) + amt;
    }
  }
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
  const top = (o, n) =>
    round(
      Object.fromEntries(
        Object.entries(o)
          .sort((a, b) => b[1] - a[1])
          .slice(0, n)
      )
    );
  return {
    currency: 'INR',
    months: keys.map((k) => ({
      month: k,
      income: Math.round(byMonth[k].income),
      expense: Math.round(byMonth[k].expense),
      byCategory: top(byMonth[k].categories, 15),
      topMerchants: top(byMonth[k].merchants, 8),
    })),
    monthlyBudgets: round(budgets),
  };
};

export const aiInsights = async (question, summary, { ask = askAi } = {}) => {
  const { text, provider } = await ask({
    job: 'chat',
    system: `You are a concise personal-finance assistant for an Indian user. Amounts are in INR (₹).
Use only the numbers in the summary; say so when the data cannot answer. Keep answers under 150 words,
use short bullet points, and give one practical suggestion when relevant.`,
    prompt: `Spending summary (JSON):\n${JSON.stringify(summary)}\n\nQuestion: ${String(question).slice(0, 500)}`,
    temperature: 0.3,
  });
  return { text, provider };
};
