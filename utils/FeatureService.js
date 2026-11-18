import { atomic, insertRow, decodeRow, sourceId } from '../data/Database';
import { readValue, writeValue } from '../data/Storage';
import { getAll, updateInDb, removeInDb, writeRow, moveBalances } from '../data/TransactionRepo';
import { assignCapture, captureSignature, linkToCounter, newAccountId } from './AccountResolver';
import { filterNew } from './DeduplicationEngine';
import { validateBackup, BACKUP_FIELDS } from './BackupService';
import { computeNetWorth, applyCapturedToAccounts } from './BalanceService';
export const bulkUpdate = (ids, changes) =>
  atomic(async (db) => {
    for (const id of ids) await updateInDb(db, id, changes);
  });
export const bulkDelete = (ids) =>
  atomic(async (db) => {
    for (const id of ids) await removeInDb(db, id);
  });
export const rejectCapture = (id) =>
  atomic(async (db) => {
    const row = await db.getFirstAsync('SELECT data FROM transactions WHERE id=?', String(id));
    if (!row) return;
    const source = sourceId(decodeRow(row));
    if (source) {
      const rejected = JSON.parse((await readValue(db, 'rejected_sources')) || '[]');
      await writeValue(db, 'rejected_sources', JSON.stringify([...new Set([...rejected, source])]));
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
        balance: 0,
        createdFrom: 'review',
      };
    } else {
      account = accounts.find((a) => String(a.id) === String(choice.accountId));
      if (!account || !SPENDABLE.includes(account.type)) throw new Error('Choose an account');
    }
    const signature = captureSignature(target);
    const similar = (await db.getAllAsync('SELECT data FROM transactions'))
      .map(decodeRow)
      .filter(
        (t) =>
          String(t.id) === String(target.id) ||
          (t.accountUnresolved && t.reviewStatus === 'pending' && captureSignature(t) === signature)
      )
      .sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate));
    const resolved = [];
    for (const tx of similar) {
      const current = accounts.find((a) => String(a.id) === String(account.id)) || account;
      const r = assignCapture(accounts, tx, current, { newId: newAccountId });
      accounts = r.accounts;
      resolved.push(r.tx);
      await writeRow(db, r.tx);
    }
    const finalAccounts = applyCapturedToAccounts(accounts, resolved);
    await moveBalances(db, () => finalAccounts);
    return { resolved: resolved.length, accountId: account.id };
  });

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
    const snapshot = { date, ...computeNetWorth(accounts) };
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
