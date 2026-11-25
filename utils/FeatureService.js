import { deleteAllFor } from './Attachments';
import { atomic, insertRow, decodeRow, sourceId } from '../data/Database';
import { readValue, writeValue } from '../data/Storage';
import { getAll, updateInDb, removeInDb, writeRow, moveBalances } from '../data/TransactionRepo';
import {
  assignCapture,
  captureSignature,
  linkToCounter,
  newAccountId,
  resolveAccount,
} from './AccountResolver';
import { findTransferPair, isOpenCardPayment, isBankSideOfCardBill, pairedSmsIdsOf } from './TransferPairing';
import { discoverAccounts } from './AccountDiscovery';
import { filterNew } from './DeduplicationEngine';
import { validateBackup, BACKUP_FIELDS } from './BackupService';
import {
  computeNetWorth,
  applyCapturedToAccounts,
  applyToAccounts,
  reverseOnAccounts,
} from './BalanceService';
import { reconcileTransaction } from './WalletReconcile';
import { bulkPatch } from './PayeeMatch';
import { ruleFromChanges, mergeRule, restoreRule } from './PayeeRules';
import { recordBulk, takeUndo } from './UndoStore';
import { linkChanges as refundLinkChanges, UNLINK_CHANGES } from './RefundMatch';
export const bulkUpdate = (ids, changes) =>
  atomic(async (db) => {
    for (const id of ids) await updateInDb(db, id, changes);
  });
/**
 * A3/A4: copy the owner's changes ({ name?, category?, tags? }) to these rows in one batch,
 * through updateInDb. opts.ruleKey also saves a payee rule for future transactions;
 * opts.force changes names/categories the owner set by hand (rows they picked themselves).
 * The change can be undone (undoLastBulk) for 10 minutes. Returns { updated }.
 */
export const bulkApply = async (
  ids,
  changes,
  { ruleKey = null, ruleLabel = '', force = false, kind = 'apply' } = {}
) => {
  const { entries, rule } = await atomic(async (db) => {
    const done = [];
    for (const id of ids) {
      const row = await db.getFirstAsync('SELECT data FROM transactions WHERE id = ?', String(id));
      if (!row) continue;
      const old = decodeRow(row);
      const patch = bulkPatch(old, changes, { force });
      if (!Object.keys(patch).length) continue;
      await updateInDb(db, old.id, patch);
      done.push({ id: old.id, before: pick(old, Object.keys(patch)), after: patch });
    }
    let saved = null;
    const newRule = ruleKey ? ruleFromChanges(ruleKey, changes, ruleLabel) : null;
    if (newRule) {
      const rules = JSON.parse((await readValue(db, 'category_rules')) || '[]');
      const merged = mergeRule(rules, newRule);
      await writeValue(db, 'category_rules', JSON.stringify(merged.rules));
      saved = { id: merged.id, previous: merged.previous };
    }
    return { entries: done, rule: saved };
  });
  recordBulk(kind, entries, rule ? { rule } : {});
  return { updated: entries.length };
};
/** B5: change the same fields on every row (category, account, reports…) with undo. */
export const bulkSet = async (ids, changes, kind = 'set') => {
  const entries = await atomic(async (db) => {
    const done = [];
    for (const id of ids) {
      const row = await db.getFirstAsync('SELECT data FROM transactions WHERE id = ?', String(id));
      if (!row) continue;
      const old = decodeRow(row);
      const fields = Object.keys(changes).filter(
        (f) => JSON.stringify(old[f] ?? null) !== JSON.stringify(changes[f] ?? null)
      );
      if (!fields.length) continue;
      const patch = pick(changes, fields);
      await updateInDb(db, old.id, patch);
      done.push({ id: old.id, before: pick(old, fields), after: patch });
    }
    return done;
  });
  recordBulk(kind, entries);
  return { updated: entries.length };
};
/** B6: undo the last bulk change. Returns { restored, skipped } or null when there is none. */
export const undoLastBulk = () =>
  atomic(async (db) => {
    const rows = (await db.getAllAsync('SELECT data FROM transactions')).map(decodeRow);
    const plan = takeUndo(rows);
    if (!plan) return null;
    for (const { id, changes } of plan.patches) await updateInDb(db, id, changes);
    if (plan.rule) {
      const rules = JSON.parse((await readValue(db, 'category_rules')) || '[]');
      await writeValue(db, 'category_rules', JSON.stringify(restoreRule(rules, plan.rule)));
    }
    return { restored: plan.patches.length, skipped: plan.skipped };
  });
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));
/** E5: link a refund to the purchase it refunds (checked: it can't exceed what is left). */
export const linkRefund = (refundId, purchaseId) =>
  atomic(async (db) => {
    const all = (await db.getAllAsync('SELECT data FROM transactions')).map(decodeRow);
    const refund = all.find((t) => String(t.id) === String(refundId));
    const purchase = all.find((t) => String(t.id) === String(purchaseId));
    if (!refund || !purchase) throw new Error('Transaction no longer exists');
    return updateInDb(db, refund.id, refundLinkChanges(refund, purchase, all));
  });
/** E5: undo a link; the refund counts as income again. */
export const unlinkRefund = (refundId) =>
  atomic((db) => updateInDb(db, refundId, { ...UNLINK_CHANGES, refundCandidate: true }));
/** E5: "Not a refund": it stays income and is not offered again. */
export const dismissRefund = (id) =>
  atomic((db) => updateInDb(db, id, { refundCandidate: false, refundDismissed: true }));
export const bulkDelete = async (ids) => {
  await atomic(async (db) => {
    for (const id of ids) await removeInDb(db, id);
  });
  for (const id of ids) await deleteAllFor(id).catch(() => {}); // B1: files go too
};
export const rejectCapture = (id) =>
  atomic(async (db) => {
    const row = await db.getFirstAsync('SELECT data FROM transactions WHERE id=?', String(id));
    if (!row) return;
    const tx = decodeRow(row);
    // a merged transfer stands for every SMS paired into it: reject them all
    const sources = [sourceId(tx), ...(tx.pairedSmsIds || []).map((s) => `sms:${s}`)].filter(Boolean);
    if (sources.length) {
      const rejected = JSON.parse((await readValue(db, 'rejected_sources')) || '[]');
      await writeValue(db, 'rejected_sources', JSON.stringify([...new Set([...rejected, ...sources])]));
    }
    await removeInDb(db, id);
  });
export const reviewQueue = async () => (await getAll()).filter((tx) => tx.reviewStatus === 'pending');

const SPENDABLE = ['Bank Account', 'Credit Card', 'Cash', 'Wallet'];
const loadAccounts = async (db) =>
  (await db.getAllAsync('SELECT data FROM accounts')).map((r) => JSON.parse(r.data));

/**
 * Give an unresolved capture its account - and every other pending capture from the same
 * bank/card/digits, so one tap fixes them all. choice: { accountId } or { create: true, name? }
 * (creates the suggested account, starting at 0; the latest SMS balance then sets it).
 * Atomic: rows, new account and balances commit together.
 */
export const resolveCaptureAccount = (id, choice = {}) =>
  atomic(async (db) => {
    const row = await db.getFirstAsync('SELECT data FROM transactions WHERE id=?', String(id));
    if (!row) throw new Error('Transaction no longer exists');
    const target = decodeRow(row);
    if (!target.accountUnresolved) return { resolved: 0 };
    let accounts = await loadAccounts(db);
    let account;
    if (choice.create) {
      const s = target.suggestedAccount || {};
      account = {
        id: newAccountId(),
        name: String(choice.name || s.name || target.bankName || 'Account').trim(),
        type: s.type || 'Bank Account',
        subType: s.subType || s.type || 'Bank Account',
        ...(s.bankName ? { bankName: s.bankName } : {}),
        ...(s.last4 ? { last4: s.last4 } : {}),
        ...(Array.isArray(s.debitCards) && s.debitCards.length ? { debitCards: s.debitCards } : {}),
        balance: 0,
        createdFrom: 'review',
      };
    } else {
      account = accounts.find((a) => String(a.id) === String(choice.accountId));
      if (!account || !SPENDABLE.includes(account.type)) throw new Error('Choose an account');
    }
    const signature = captureSignature(target);
    const all = (await db.getAllAsync('SELECT data FROM transactions')).map(decodeRow);
    const similar = all
      .filter(
        (t) =>
          String(t.id) === String(target.id) ||
          (t.accountUnresolved && t.reviewStatus === 'pending' && captureSignature(t) === signature)
      )
      .sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate));
    const resolved = [];
    const assign = async (tx) => {
      const current = accounts.find((a) => String(a.id) === String(account.id)) || account;
      const r = assignCapture(accounts, tx, current, { newId: newAccountId });
      accounts = r.accounts;
      // The account was the only open question: confirm the capture so it leaves Check. A
      // possible self-transfer (IMPS/NEFT to a person) still waits for that answer.
      const done = r.tx.transferCandidate ? r.tx : { ...r.tx, reviewStatus: 'confirmed' };
      resolved.push(done);
      await writeRow(db, done);
    };
    for (const tx of similar) await assign(tx);
    // A2: other new-account captures that now match this account unambiguously (e.g. an Axis
    // debit SMS without digits once Axis ••0973 exists) resolve in the same tap.
    const done = new Set(similar.map((t) => String(t.id)));
    const others = all
      .filter(
        (t) =>
          !done.has(String(t.id)) &&
          t.accountUnresolved &&
          t.reviewStatus === 'pending' &&
          t.reviewReason === 'new_account'
      )
      .sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate));
    for (const tx of others) {
      const r = resolveAccount(accounts, tx);
      if (r.status === 'matched' && String(r.account.id) === String(account.id)) await assign(tx);
      else if (r.status === 'link_debit_card') {
        // A11: the bank now has an account, so the card question replaces "add an account"
        await writeRow(db, {
          ...tx,
          reviewReason: 'link_debit_card',
          accountCandidates: r.candidates.map((a) => a.id),
        });
      }
    }
    accounts = applyCapturedToAccounts(accounts, resolved);
    accounts = await pairResolvedCardBills(db, accounts, resolved);
    await moveBalances(db, () => accounts);
    return { resolved: resolved.length, accountId: account.id };
  });

/**
 * After captures get their accounts, a card bill seen twice (bank cc_bill + card cc_payment)
 * can pair for the first time. Merge each pair into ONE transfer bank → card: both one-sided
 * effects are reversed and the linked transfer applied, so net worth does not change.
 */
const pairResolvedCardBills = async (db, accounts, resolved) => {
  let next = accounts;
  const byId = (id) => next.find((a) => String(a.id) === String(id));
  const live = (await db.getAllAsync('SELECT data FROM transactions'))
    .map(decodeRow)
    .filter((r) => r.balanceMode === 'captured');
  for (const tx of resolved) {
    const row = live.find((r) => String(r.id) === String(tx.id));
    if (!row || !(isOpenCardPayment(row) || isBankSideOfCardBill(row))) continue;
    const partner = findTransferPair(row, live);
    if (!partner) continue;
    const [cardSide, bankSide] = isOpenCardPayment(row) ? [row, partner] : [partner, row];
    const card = byId(cardSide.accountId);
    const bank = byId(bankSide.accountId);
    if (!card || !bank) continue;
    next = reverseOnAccounts(reverseOnAccounts(next, cardSide), bankSide);
    const merged = {
      ...linkToCounter(cardSide, card, bank),
      pairedSmsIds: [...pairedSmsIdsOf(cardSide), ...pairedSmsIdsOf(bankSide), bankSide.smsId].filter(
        Boolean
      ),
    };
    await db.runAsync('DELETE FROM transactions WHERE id=?', String(bankSide.id));
    await writeRow(db, merged);
    next = applyToAccounts(next, merged);
    live.splice(live.indexOf(bankSide), 1);
    live[live.indexOf(cardSide)] = merged;
  }
  return next;
};

/** Pending new-account groups from the stored transactions (Review accounts, Home card). */
export const discoveredAccounts = async () => discoverAccounts(await getAll());

/**
 * "Add all N accounts": create every discovered account and resolve its captures.
 * Each group is its own atomic step; a group already resolved by an earlier one is skipped.
 */
export const addAllDiscoveredAccounts = async () => {
  const groups = await discoveredAccounts();
  let resolved = 0;
  for (const g of groups) resolved += (await resolveCaptureAccount(g.firstTxId, { create: true })).resolved;
  return { accounts: groups.length, resolved };
};

/** Link a top-up/withdraw that matched several wallets to the one the user picked. */
export const pickCaptureWallet = (id, walletId) =>
  atomic(async (db) => {
    const row = await db.getFirstAsync('SELECT data FROM transactions WHERE id=?', String(id));
    if (!row) throw new Error('Transaction no longer exists');
    const tx = decodeRow(row);
    if (tx.type !== 'transfer' || (tx.toAccountId !== undefined && tx.toAccountId !== null))
      throw new Error('This transfer is already linked');
    const accounts = await loadAccounts(db);
    const wallet = accounts.find((a) => String(a.id) === String(walletId) && a.type === 'Wallet');
    const perspective = accounts.find((a) => String(a.id) === String(tx.accountId));
    if (!wallet || !perspective) throw new Error('Choose a wallet');
    const { reviewReason, ...rest } = linkToCounter(tx, perspective, wallet);
    return updateInDb(db, tx.id, {
      ...rest,
      reviewReason: reviewReason === 'pick_wallet' ? null : reviewReason,
    });
  });
export const saveNetWorthSnapshot = () =>
  atomic(async (db) => {
    const accounts = JSON.parse(await readValue(db, 'user_wealth_accounts'));
    const history = JSON.parse((await readValue(db, 'networth_history')) || '[]');
    const date = new Date().toLocaleDateString('en-CA');
    // C5: cards are valued from their SMS (available limit) and bills, loans by their schedule
    const txs = (await db.getAllAsync('SELECT data FROM transactions')).map(decodeRow);
    const snapshot = { date, ...computeNetWorth(accounts, [], { txs }) };
    await writeValue(
      db,
      'networth_history',
      JSON.stringify([...history.filter((row) => row.date !== date), snapshot])
    );
    return snapshot;
  });
export const contributeToGoal = (id, amount, note = '') =>
  atomic(async (db) => {
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a positive contribution');
    const goals = JSON.parse((await readValue(db, 'user_goals')) || '[]');
    const goal = goals.find((row) => String(row.id) === String(id));
    if (!goal) throw new Error('Goal no longer exists');
    goal.savedAmount = (Number(goal.savedAmount) || 0) + amount;
    goal.contributions = [
      ...(goal.contributions || []),
      { id: Date.now(), amount, note, date: new Date().toISOString() },
    ];
    await writeValue(db, 'user_goals', JSON.stringify(goals));
  });
export const mergeRestore = (data) =>
  atomic(async (db) => {
    const check = validateBackup(data);
    if (!check.ok) throw new Error(check.errors.join('\n'));
    const current = (await db.getAllAsync('SELECT data FROM transactions')).map(decodeRow);
    const byId = new Set(current.map((tx) => String(tx.id)));
    const fresh = filterNew(data.transactions || [], current).filter((tx) => !byId.has(String(tx.id)));
    let added = 0;
    for (const tx of fresh) added += (await insertRow(db, { ...tx, balanceMode: 'none' })).changes;
    for (const field of ['wealth', 'recurring', 'goals', 'savings', 'categoryRules', 'netWorthHistory']) {
      if (!data[field]) continue;
      const key = BACKUP_FIELDS[field].key;
      const existing = JSON.parse((await readValue(db, key)) || '[]');
      const identity = (row) => String(row.id ?? row.date ?? row.pattern ?? row.name);
      const ids = new Set(existing.map(identity));
      await writeValue(
        db,
        key,
        JSON.stringify([...existing, ...data[field].filter((row) => !ids.has(identity(row)))])
      );
    }
    if (data.rejectedSources) {
      const existing = JSON.parse((await readValue(db, 'rejected_sources')) || '[]');
      await writeValue(
        db,
        'rejected_sources',
        JSON.stringify([...new Set([...existing, ...data.rejectedSources])])
      );
    }
    if (data.categories) {
      const existing = JSON.parse((await readValue(db, 'user_categories')) || '[]');
      await writeValue(
        db,
        'user_categories',
        JSON.stringify([...new Set([...existing, ...data.categories])])
      );
    }
    for (const field of ['budgets', 'monthlyBudgets']) {
      if (!data[field]) continue;
      const key = BACKUP_FIELDS[field].key;
      await writeValue(
        db,
        key,
        JSON.stringify({ ...data[field], ...JSON.parse((await readValue(db, key)) || '{}') })
      );
    }
    return { added, skipped: (data.transactions || []).length - added };
  });

/**
 * Reconcile a wallet to the balance the UPI app shows (A4.1). Atomic; idempotent per
 * `requestId` (the dialog makes one id, so a double tap saves once); reversible by deleting
 * the created entry. Returns { tx } or { tx: null } when there was no gap.
 */
export const reconcileWallet = (accountId, entered, { requestId, mode, category } = {}) =>
  atomic(async (db) => {
    if (!requestId) throw new Error('requestId required');
    const id = `recon_${requestId}`;
    const existing = await db.getFirstAsync('SELECT data FROM transactions WHERE id=?', id);
    if (existing) return { tx: decodeRow(existing), repeated: true };
    const accounts = await loadAccounts(db);
    const account = accounts.find((a) => String(a.id) === String(accountId));
    const tx = reconcileTransaction(account, entered, { id, mode, category });
    if (!tx) return { tx: null };
    const record = { ...tx, balanceMode: 'delta' };
    if (record.type === 'transfer')
      record.account = accounts.find((a) => String(a.id) === String(record.accountId))?.name || 'Bank';
    await insertRow(db, record);
    await moveBalances(db, () => applyToAccounts(accounts, record));
    return { tx: record };
  });
