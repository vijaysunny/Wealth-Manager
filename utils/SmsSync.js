/**
 * SmsSync.js  (Phase 6)
 * ONE routine that reads new bank SMS since the last sync, de-duplicates, saves, moves
 * balances and notifies. Used by:
 *   - the background task (BackgroundSync)
 *   - the foreground catch-up when the app opens / returns to the foreground
 *
 * Rules
 *  - Does nothing when "SMS Auto-Tracking" is switched off.
 *  - Never prompts for permission (it can run headless); a missing permission = skipped run.
 *  - `last_bg_sync_time` advances after EVERY successful scan, even when nothing new was
 *    found. A failed scan (no permission / SMS read error) leaves it untouched.
 *  - Runs are serialised: overlapping calls share one in-flight run.
 */
import AsyncStorage from '../data/Storage';
import { scanBankSms } from '../components/RealSmsReader';
import { sendTransactionNotification } from './NotificationService';
import { saveWithDedup, createDedupIndex } from './DeduplicationEngine';
import { isReportable } from './BalanceService';
import { formatMoney } from './Format';
import { aiParseUnparsed, aiCategorizeNew, defaultAiDeps } from './ai/AiSync';

export const SMS_FLAG_KEY = 'sms_auto_track_enabled';
export const LAST_SYNC_KEY = 'last_bg_sync_time';

const HOUR = 60 * 60 * 1000;
const DEFAULT_LOOKBACK_MS = 24 * HOUR; // first ever run
const MAX_LOOKBACK_MS = 90 * 24 * HOUR; // never scan further back than this automatically
const NOTIFY_INDIVIDUALLY_UP_TO = 3;

/** Epoch ms to scan from, given the stored marker (string|null) and "now". */
export const computeSyncStart = (stored, now = Date.now()) => {
  const last = parseInt(stored, 10);
  if (!Number.isFinite(last) || last <= 0) return now - DEFAULT_LOOKBACK_MS;
  return Math.min(Math.max(last, now - MAX_LOOKBACK_MS), now);
};

export const smsToTransaction = (sms) => {
  const when = new Date(sms.date);
  return {
    id: Date.now() + Math.random(),
    smsId: sms.smsId,
    bodyHash: sms.bodyHash,
    refNo: sms.refNo,
    title: sms.merchant || sms.category,
    merchant: sms.merchant,
    vpa: sms.vpa,
    amount: parseFloat(sms.amount),
    type: sms.type,
    date: when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
    fullDate: when.toISOString(),
    category: sms.category,
    account: sms.bankName,
    tags: ['Auto-Sync'],
    extractedBalance: sms.currentBalance,
    ...(sms.captured || {}),
  };
};

const monthSpent = (txs, category, now) =>
  txs
    .filter(
      (t) =>
        isReportable(t) &&
        t.type === 'expense' &&
        t.category === category &&
        new Date(t.fullDate).getMonth() === now.getMonth() &&
        new Date(t.fullDate).getFullYear() === now.getFullYear()
    )
    .reduce((s, t) => s + t.amount, 0);

const notifyOne = async (tx, spentBefore, limit, notify) => {
  if (tx.type === 'transfer') {
    await notify('Transfer captured', `${formatMoney(tx.amount)} · ${tx.category} · ${tx.account}`);
    return;
  }
  if (tx.type === 'income') {
    await notify('Income Credited', `${formatMoney(tx.amount)} credited to ${tx.account}`);
    return;
  }
  const total = spentBefore + tx.amount;
  let body = `Total ${tx.category} spend: ${formatMoney(total)}`;
  if (limit > 0)
    body = `You've spent ${formatMoney(total)} out of ${formatMoney(limit)} (${Math.round((total / limit) * 100)}%)`;
  await notify(`Spent ${formatMoney(tx.amount)} on ${tx.category}`, body);
};

const run = async ({ scan, storage, notify, save, now, ai }) => {
  if ((await storage.getItem(SMS_FLAG_KEY)) === 'false') return { status: 'disabled', added: 0 };

  const startedAt = now();
  const minDate = computeSyncStart(await storage.getItem(LAST_SYNC_KEY), startedAt);
  const res = await scan(minDate);
  if (!res.ok) return { status: 'scan_failed', reason: res.reason, added: 0 }; // marker NOT advanced

  const txJson = await storage.getItem('user_transactions');
  const currentTx = txJson ? JSON.parse(txJson) : [];
  const catJson = await storage.getItem('user_category_budgets');
  const catLimits = catJson ? JSON.parse(catJson) : {};

  const dedup = createDedupIndex(currentTx);
  let fresh = [];
  for (const sms of res.items) {
    if (!sms.amount) continue;
    const tx = smsToTransaction(sms);
    if (dedup.check(tx)) continue;
    fresh.push(tx);
  }
  // Optional AI steps (Settings → AI assistant): read SMS the parser missed, categorize 'General'
  for (const item of await aiParseUnparsed(res.unparsed, storage, ai)) {
    const tx = { ...smsToTransaction(item), tags: ['Auto-Sync', 'AI'] };
    if (dedup.check(tx)) continue;
    fresh.push(tx);
  }
  if (fresh.length > 0) fresh = await aiCategorizeNew(fresh, storage, ai);

  // ONE save path (B6): the repo re-checks duplicates, sets reviewStatus, resolves accounts
  // and moves balances atomically. Only what it actually stored counts as added.
  if (fresh.length > 0) fresh = (await save(fresh)).addedTxs;
  // Advance on every successful scan (found something or not)
  await storage.setItem(LAST_SYNC_KEY, String(startedAt));

  if (fresh.length > 0) {
    try {
      if (fresh.length > NOTIFY_INDIVIDUALLY_UP_TO) {
        await notify('New transactions captured', `${fresh.length} bank messages were added.`);
      } else {
        const nowDate = new Date(startedAt);
        const running = [...currentTx];
        for (const tx of [...fresh].reverse()) {
          // oldest first so running totals build up
          await notifyOne(tx, monthSpent(running, tx.category, nowDate), catLimits[tx.category] || 0, notify);
          running.push(tx);
        }
      }
    } catch (e) {
      console.log('Notification error:', e);
    } // never let a notification failure undo the sync
  }
  return { status: 'ok', added: fresh.length };
};

let inFlight = null;

/** Run one sync. Concurrent callers share the same run. Deps are injectable for tests. */
export const syncSms = (deps = {}) => {
  if (inFlight) return inFlight;
  const d = {
    scan: scanBankSms,
    storage: AsyncStorage,
    notify: sendTransactionNotification,
    save: (txs) => saveWithDedup(txs, { balanceMode: 'captured' }),
    now: Date.now,
    ai: defaultAiDeps(),
    ...deps,
  };
  inFlight = run(d)
    .catch((e) => {
      console.log('SMS sync error:', e);
      return { status: 'error', added: 0 };
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
};
