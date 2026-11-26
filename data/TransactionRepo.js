import { deleteAllFor } from '../utils/Attachments';
import { linkSipDebits } from '../utils/InvestmentLink';
import { atomic, getDatabase, insertRow, decodeRow, encodeTransaction, sourceId } from './Database';
import { applyCategoryRules } from '../utils/FinanceTools';
import { readValue, writeValue } from './Storage';
import { countHits } from '../utils/PayeeRules';
import { markRefundCandidates, UNLINK_CHANGES } from '../utils/RefundMatch';
import { checkBudgetAlerts } from '../utils/MonthlyBudgets';
import { filterNew } from '../utils/DeduplicationEngine';
import { applyToAccounts, reverseOnAccounts, applyCapturedToAccounts } from '../utils/BalanceService';
import { resolveCaptures, linkToCounter } from '../utils/AccountResolver';
import { findTransferPair, isOpenCardPayment, pairedSmsIdsOf } from '../utils/TransferPairing';
export const getAll = async () =>
  (await (await getDatabase()).getAllAsync('SELECT data FROM transactions ORDER BY fullDate DESC')).map(
    decodeRow
  );
export const getByMonth = async (year, month) => {
  const start = new Date(year, month, 1).toISOString();
  const end = new Date(year, month + 1, 1).toISOString();
  return (
    await (
      await getDatabase()
    ).getAllAsync(
      'SELECT data FROM transactions WHERE fullDate >= ? AND fullDate < ? ORDER BY fullDate DESC',
      start,
      end
    )
  ).map(decodeRow);
};
export const moveBalances = async (db, task) => {
  const accounts = (await db.getAllAsync('SELECT data FROM accounts')).map((r) => JSON.parse(r.data));
  for (const account of task(accounts))
    await db.runAsync(
      'INSERT OR REPLACE INTO accounts(id, data) VALUES (?, ?)',
      String(account.id),
      JSON.stringify(account)
    );
};
const persistMany = (transactions, { balanceMode = 'none', dedup = true } = {}) =>
  atomic(async (db) => {
    const rules = JSON.parse((await readValue(db, 'category_rules')) || '[]');
    // A6: rules apply to every capture, statement import and recurring posting (not manual entries,
    // whose category the owner picks; a category set by hand is never changed)
    transactions = transactions.map((tx) => {
      const capture = tx.smsId || tx.gmailMsgId;
      if (capture) return applyCategoryRules({ ...tx, reviewStatus: tx.reviewStatus || 'pending' }, rules);
      const tags = tx.tags || [];
      return tags.includes('imported') || tags.includes('recurring') ? applyCategoryRules(tx, rules) : tx;
    });
    const current = (await db.getAllAsync('SELECT data FROM transactions')).map(decodeRow);
    const rejected = new Set(JSON.parse((await readValue(db, 'rejected_sources')) || '[]'));
    let candidates = (dedup ? filterNew(transactions, current) : transactions).filter(
      (tx) => !rejected.has(sourceId(tx))
    );
    // Captures get their account BEFORE they are stored (A3/B7): matched, pick, or new-account review
    let accounts = null;
    if (balanceMode === 'captured') {
      accounts = (await db.getAllAsync('SELECT data FROM accounts')).map((r) => JSON.parse(r.data));
      ({ accounts, txs: candidates } = resolveCaptures(accounts, candidates));
      candidates = linkSipDebits(accounts, candidates); // B3: SIP debit → transfer to the investment
    }
    candidates = markRefundCandidates(candidates, current); // E5: Review → Check offers a match
    const addedTxs = [];
    const applyTxs = []; // rows whose balance effect is applied below (new + re-linked)
    const live = current.slice();
    const accountById = (id) => accounts && accounts.find((a) => String(a.id) === String(id));
    for (const tx of candidates) {
      let record = { ...tx, balanceMode };
      const partner =
        balanceMode === 'captured'
          ? findTransferPair(
              record,
              live.filter((r) => r.balanceMode === 'captured')
            )
          : null;
      const card = partner && accountById(isOpenCardPayment(record) ? record.accountId : partner.accountId);
      const bank = partner && accountById(isOpenCardPayment(record) ? partner.accountId : record.accountId);
      if (partner && card && bank) {
        // One card-bill payment seen twice (issuer + paying bank) → ONE transfer bank → card
        accounts = reverseOnAccounts(accounts, partner);
        if (isOpenCardPayment(record)) {
          await db.runAsync('DELETE FROM transactions WHERE id=?', String(partner.id));
          live.splice(live.indexOf(partner), 1);
          record = {
            ...linkToCounter(record, card, bank),
            pairedSmsIds: [...pairedSmsIdsOf(record), ...pairedSmsIdsOf(partner), partner.smsId].filter(
              Boolean
            ),
          };
        } else {
          const merged = {
            ...linkToCounter(partner, card, bank),
            pairedSmsIds: [...pairedSmsIdsOf(partner), record.smsId].filter(Boolean),
            ...(Number.isFinite(record.extractedBalance)
              ? { extractedBalance: record.extractedBalance, balanceAccountId: bank.id }
              : {}),
          };
          await writeRow(db, merged);
          live[live.indexOf(partner)] = merged;
          applyTxs.push(merged);
          continue; // the bank debit is now the transfer's other leg, not a row of its own
        }
      }
      if ((await insertRow(db, record)).changes === 1) {
        addedTxs.push(record);
        applyTxs.push(record);
        live.push(record);
      }
    }
    if (balanceMode === 'captured') await moveBalances(db, () => applyCapturedToAccounts(accounts, applyTxs));
    if (balanceMode === 'delta')
      await moveBalances(db, (accounts) => addedTxs.reduce(applyToAccounts, accounts));
    const counted = countHits(rules, addedTxs);
    if (counted !== rules) await writeValue(db, 'category_rules', JSON.stringify(counted));
    return { added: addedTxs.length, skipped: transactions.length - addedTxs.length, addedTxs };
  });
export const addMany = async (...args) => {
  const result = await persistMany(...args);
  if (result.added)
    await checkBudgetAlerts().catch((error) => console.warn('Budget alert failed', error.message));
  return result;
};
export const add = (tx) => addMany([tx], { balanceMode: 'delta', dedup: false });
export const updateInDb = async (db, id, changes) => {
  const row = await db.getFirstAsync('SELECT data FROM transactions WHERE id = ?', String(id));
  if (!row) throw new Error('Transaction no longer exists');
  const old = decodeRow(row);
  const next = encodeTransaction({ ...old, ...changes, id: old.id });
  if (old.balanceMode !== 'none')
    await moveBalances(db, (accounts) => applyToAccounts(reverseOnAccounts(accounts, old), next));
  await writeRow(db, next);
  return next;
};
/** Overwrite a stored row as-is (no balance movement). Callers handle balances. */
export const writeRow = (db, tx) => {
  const next = encodeTransaction(tx);
  return db.runAsync(
    'UPDATE transactions SET sourceId=?, fullDate=?, category=?, account=?, type=?, amount=?, excluded=?, data=? WHERE id=?',
    sourceId(next),
    next.fullDate,
    next.category || '',
    next.account || '',
    next.type,
    Number(next.amount),
    next.excludeFromReports ? 1 : 0,
    JSON.stringify(next),
    String(next.id)
  );
};
export const update = (id, changes) => atomic((db) => updateInDb(db, id, changes));
export const removeInDb = async (db, id) => {
  const row = await db.getFirstAsync('SELECT data FROM transactions WHERE id=?', String(id));
  if (!row) return false;
  const tx = decodeRow(row);
  if (tx.balanceMode !== 'none') await moveBalances(db, (accounts) => reverseOnAccounts(accounts, tx));
  await db.runAsync('DELETE FROM transactions WHERE id=?', String(id));
  await dropLinksTo(db, tx);
  return true;
};

/**
 * E4/E5: what pointed at a deleted transaction goes with it. Open IOUs from its split are removed
 * (settled ones stay as history), and refunds linked to it count as income again.
 */
const dropLinksTo = async (db, tx) => {
  const key = String(tx.id);
  let ious = [];
  try {
    ious = JSON.parse((await readValue(db, 'ious')) || '[]');
  } catch {
    ious = [];
  }
  if (Array.isArray(ious)) {
    const kept = ious.filter((i) => !(i && i.txId != null && String(i.txId) === key && !i.settledAt));
    if (kept.length !== ious.length) await writeValue(db, 'ious', JSON.stringify(kept));
  }
  const linked = (await db.getAllAsync('SELECT data FROM transactions WHERE data LIKE ?', '%"refundOf"%'))
    .map(decodeRow)
    .filter((r) => r.refundOf != null && String(r.refundOf) === key);
  for (const r of linked) await updateInDb(db, r.id, { ...UNLINK_CHANGES, refundCandidate: true });
};
export const remove = async (id) => {
  const removed = await atomic((db) => removeInDb(db, id));
  // B1: the transaction's files go with it (outside the DB transaction; a missing folder is fine)
  if (removed) await deleteAllFor(id).catch(() => {});
  return removed;
};
export const monthlyAggregates = async (start, end) =>
  (await getDatabase()).getAllAsync(
    `SELECT strftime('%Y-%m', fullDate, 'localtime') AS month, type, SUM(amount) AS total FROM transactions WHERE fullDate >= ? AND fullDate < ? AND excluded = 0 AND type IN ('expense','income') GROUP BY month, type`,
    start,
    end
  );
