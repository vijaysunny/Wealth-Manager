/**
 * NotificationActions (Phase 14 E3, docs/design/23-notification-actions.png).
 * Category buttons on the "₹322 at Swiggy Instamart" capture notification:
 *  - no category yet: the 3 categories most used for this payee, then this account (last 90 days);
 *  - a rule already chose one: the next 2 likely ones + "Not mine".
 * A tap updates the transaction (categorySource 'user') and posts "Saved as Food"; "Not mine"
 * marks it disputed and opens it. Taps are handled once, whether they arrive in the app, in the
 * background notification task, or (fallback) as the last response when the app next opens.
 * The Review screen later offers "apply to similar" for what was categorised here, never silently.
 */
import * as Notifications from 'expo-notifications';
import Storage from '../data/Storage';
import { atomic, decodeRow } from '../data/Database';
import { getAll, updateInDb } from '../data/TransactionRepo';
import { payeeKey, payeeName } from './PayeeMatch';
import { shortAccountName } from './TransactionList';
import { formatMoney } from './Format';

export const BUTTONS_KEY = 'notif_category_buttons'; // Settings toggle, default on
export const CATEGORISED_KEY = 'notif_categorised'; // [{ id, from, to, at }] for "apply to similar"
const REGISTERED_KEY = 'notif_category_ids';
const HANDLED_KEY = 'notif_handled';
const PENDING_OPEN_KEY = 'notif_open_tx';
export const NOT_MINE = 'not_mine';
const CAT_PREFIX = 'cat:';
const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';

const GENERIC = ['General', 'Other', 'Uncategorised', 'Uncategorized', 'UPI Transfer'];
const FALLBACK = ['Food', 'Groceries', 'Shopping', 'Transport', 'Bills'];
const DAY = 86400000;

export const hasChosenCategory = (tx) => !!tx?.category && !GENERIC.includes(tx.category);

/** Categories by how often they were used (ties: most recent first). */
const ranked = (rows) => {
  const m = new Map();
  for (const r of rows) {
    const cur = m.get(r.category) || { n: 0, last: 0 };
    cur.n += 1;
    cur.last = Math.max(cur.last, new Date(r.fullDate).getTime() || 0);
    m.set(r.category, cur);
  }
  return [...m.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last).map(([c]) => c);
};

/** The buttons for a captured debit: { categories: [...], notMine }. */
export const buttonsFor = (tx, txs = [], { now = new Date() } = {}) => {
  const past = (txs || []).filter(
    (r) =>
      r &&
      String(r.id) !== String(tx.id) &&
      r.type === 'expense' &&
      hasChosenCategory(r) &&
      !(r.splits && r.splits.length)
  );
  const key = payeeKey(tx);
  const byPayee = key ? past.filter((r) => payeeKey(r) === key) : [];
  const since = now.getTime() - 90 * DAY;
  const sameAccount = (r) =>
    (tx.accountId != null && String(r.accountId) === String(tx.accountId)) ||
    (!!tx.account && r.account === tx.account);
  const byAccount = past.filter((r) => sameAccount(r) && new Date(r.fullDate).getTime() >= since);
  const chosen = hasChosenCategory(tx);
  const order = [...new Set([...ranked(byPayee), ...ranked(byAccount), ...FALLBACK])].filter(
    (c) => !chosen || c !== tx.category
  );
  return chosen
    ? { categories: order.slice(0, 2), notMine: true }
    : { categories: order.slice(0, 3), notMine: false };
};

/** One notification category per button set ("tx_food_groceries_nm"). */
export const categoryIdFor = (b) =>
  `tx_${b.categories.map((c) => c.toLowerCase().replace(/[^a-z0-9]+/g, '-')).join('_')}${b.notMine ? '_nm' : ''}`;

/** Category buttons save in the background; "Not mine" opens the app. */
export const actionsFor = (b) => [
  ...b.categories.map((c) => ({
    identifier: `${CAT_PREFIX}${c}`,
    buttonTitle: c,
    options: { opensAppToForeground: false },
  })),
  ...(b.notMine
    ? [{ identifier: NOT_MINE, buttonTitle: 'Not mine', options: { opensAppToForeground: true } }]
    : []),
];

/** Title and body: "₹322 at Swiggy Instamart" / "Axis Card ••9070 · Food (rule) · tap to change". */
export const captureText = (tx, extra = '') => {
  const who = payeeName(tx) || tx.title || 'a payee';
  const acc = tx.account ? `${shortAccountName(tx.account, tx.last4)} · ` : '';
  const cat = hasChosenCategory(tx)
    ? `${tx.category}${tx.categorySource === 'rule' ? ' (rule)' : ''} · tap to change`
    : 'no category yet';
  return { title: `${formatMoney(tx.amount)} at ${who}`, body: `${acc}${cat}${extra ? `\n${extra}` : ''}` };
};

/** What a tap means. */
export const parseAction = (id) => {
  if (typeof id === 'string' && id.startsWith(CAT_PREFIX)) return { kind: 'category', category: id.slice(4) };
  if (id === NOT_MINE) return { kind: 'notMine' };
  return { kind: 'open' };
};

/** The changes a tap makes, or null when it has already been made (two taps → one update). */
export const changesFor = (tx, action) => {
  if (action.kind === 'category')
    return tx.category === action.category && tx.categorySource === 'user'
      ? null
      : { category: action.category, categorySource: 'user' };
  if (action.kind === 'notMine') return tx.reviewStatus === 'disputed' ? null : { reviewStatus: 'disputed' };
  return null;
};

/** Keep the newest entry per transaction, at most 20. */
export const addCategorised = (list, entry) =>
  [entry, ...(list || []).filter((x) => String(x.id) !== String(entry.id))].slice(0, 20);

/** "You categorised 3 from notifications" entries whose row still has that category. */
export const pendingSimilar = (list, txs) => {
  const byId = new Map((txs || []).map((t) => [String(t.id), t]));
  return (list || []).filter((e) => byId.get(String(e.id))?.category === e.to);
};

// ── Native glue ─────────────────────────────────────────────────────────────

const readJson = async (key, fallback) => {
  try {
    return JSON.parse((await Storage.getItem(key)) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
};
export const buttonsEnabled = async () => (await Storage.getItem(BUTTONS_KEY)) !== 'false';

let registered = null;
/** Register a button set once (kept across launches). */
export const ensureCategory = async (b) => {
  const id = categoryIdFor(b);
  if (!registered) registered = new Set(await readJson(REGISTERED_KEY, []));
  if (registered.has(id)) return id;
  await Notifications.setNotificationCategoryAsync(id, actionsFor(b));
  registered.add(id);
  await Storage.setItem(REGISTERED_KEY, JSON.stringify([...registered].slice(-100)));
  return id;
};
/** Tests: forget the in-memory set. */
export const _resetRegistered = () => {
  registered = null;
};

/**
 * The content for a captured transaction's notification: with buttons for a debit when the
 * toggle is on, else plain (null → the caller keeps its own text).
 */
export const captureContent = async (tx, extra = '') => {
  if (!tx || tx.type !== 'expense' || !(await buttonsEnabled())) return null;
  const b = buttonsFor(tx, await getAll());
  const categoryIdentifier = await ensureCategory(b);
  return { ...captureText(tx, extra), categoryIdentifier, data: { txId: String(tx.id), kind: 'capture' } };
};

const openTx = async (id, navigate) => {
  if (!navigate) return Storage.setItem(PENDING_OPEN_KEY, String(id)); // opened by the app later
  const row = (await getAll()).find((t) => String(t.id) === String(id));
  if (row) navigate('TransactionDetail', { transaction: row });
};

/** The app opened after "Not mine" while it was closed: open that transaction now. */
export const openPending = async (navigate) => {
  const id = await Storage.getItem(PENDING_OPEN_KEY);
  if (!id) return false;
  await Storage.removeItem(PENDING_OPEN_KEY);
  await openTx(id, navigate);
  return true;
};

/**
 * Handle one notification response. Returns { status }: 'duplicate' | 'opened' | 'saved' |
 * 'unchanged' | 'missing' | 'ignored'. Never throws.
 */
export const handleResponse = async (response, { navigate } = {}) => {
  try {
    const req = response?.notification?.request;
    const data = req?.content?.data || {};
    const actionId = response?.actionIdentifier || DEFAULT_ACTION;
    const handledKey = `${req?.identifier}|${actionId}`;
    const handled = await readJson(HANDLED_KEY, []);
    if (handled.includes(handledKey)) return { status: 'duplicate' };
    await Storage.setItem(HANDLED_KEY, JSON.stringify([handledKey, ...handled].slice(0, 50)));

    if (data.screen === 'MonthReview') {
      if (navigate) navigate('MonthReview', { month: data.month });
      return { status: 'opened' };
    }
    if (!data.txId) return { status: 'ignored' };
    const action = parseAction(actionId);
    if (action.kind === 'open') {
      await openTx(data.txId, navigate);
      return { status: 'opened' };
    }
    const res = await atomic(async (db) => {
      const row = await db.getFirstAsync('SELECT data FROM transactions WHERE id = ?', String(data.txId));
      if (!row) return { status: 'missing' };
      const tx = decodeRow(row);
      const ch = changesFor(tx, action);
      if (!ch) return { status: 'unchanged', tx };
      return { status: 'saved', tx: await updateInDb(db, tx.id, ch), before: tx };
    });
    if (res.status === 'missing') return res;
    if (action.kind === 'notMine') {
      await openTx(data.txId, navigate);
      return res;
    }
    if (res.status === 'saved') {
      const list = await readJson(CATEGORISED_KEY, []);
      await Storage.setItem(
        CATEGORISED_KEY,
        JSON.stringify(
          addCategorised(list, {
            id: String(res.tx.id),
            from: res.before.category || null,
            to: action.category,
            at: new Date().toISOString(),
          })
        )
      );
    }
    if (req?.identifier) await Notifications.dismissNotificationAsync(req.identifier).catch(() => null);
    const { title } = captureText(res.tx);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Saved as ${action.category}`,
        body: `${title} · Undo in the app`,
        data: { txId: String(res.tx.id), kind: 'saved' },
      },
      trigger: null,
    }).catch(() => null);
    return { status: res.status };
  } catch (e) {
    console.warn('Notification action failed:', e?.message || e);
    return { status: 'error' };
  }
};

/** The "categorised from notifications" entries still worth offering. */
export const loadCategorised = async (txs) => pendingSimilar(await readJson(CATEGORISED_KEY, []), txs);
/** Drop entries once offered (ids), or all of them (null). */
export const dropCategorised = async (ids = null) => {
  const keep = ids
    ? (await readJson(CATEGORISED_KEY, [])).filter((e) => !ids.map(String).includes(String(e.id)))
    : [];
  await Storage.setItem(CATEGORISED_KEY, JSON.stringify(keep));
};
