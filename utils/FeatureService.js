import { atomic, insertRow, decodeRow, sourceId } from '../data/Database';
import { readValue, writeValue } from '../data/Storage';
import { getAll, updateInDb, removeInDb } from '../data/TransactionRepo';
import { filterNew } from './DeduplicationEngine';
import { validateBackup, BACKUP_FIELDS } from './BackupService';
import { computeNetWorth } from './BalanceService';
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
