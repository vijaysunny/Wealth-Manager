/**
 * BalanceService.js
 * Single place that decides how a transaction moves an account balance, plus the
 * shared net-worth and "reportable" helpers every screen uses.
 *
 * Pure functions (…ToAccounts, computeNetWorth, isReportable) are unit-tested;
 * the async wrappers (applyTransaction, reverseTransaction, …) load/save
 * 'user_wealth_accounts' and are what screens call.
 *
 * Sign convention: asset accounts (Bank/Cash/Wallet) store a positive balance;
 * Credit Card stores the DEBT as a positive number. So:
 *   expense: asset −amount, credit card +amount (debt grows)
 *   income : asset +amount, credit card −amount (payment/refund shrinks debt)  [C9]
 * Loans, investments etc. are never moved by transactions.
 */

import AsyncStorage from '../data/Storage';

const ACCOUNTS_KEY = 'user_wealth_accounts';
const SPENDABLE_TYPES = ['Bank Account', 'Credit Card', 'Cash', 'Wallet'];

// Wallet accounts keep type 'Wallet'; optional metadata on the account record (plan A1):
//   subType: one of WALLET_SUBTYPES, provider: 'PhonePe' | ..., linkedBankId: id | null,
//   aliases: ['phonepe lite', ...] (lowercase, matched against SMS/statement text)
export { WALLET_SUBTYPES } from './TransactionParser';
/** True for wallet accounts (UPI Lite, Paytm Wallet, Amazon Pay, FASTag, other). */
export const isWallet = (account) => !!account && account.type === 'Wallet';
const LIABILITY_TYPES = ['Loan', 'Credit Card'];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// ── Report / net-worth helpers ────────────────────────────────────────────

/** One filter for every report (Home, Budget, History, Savings, Analytics, alerts). [C11] */
export const isReportable = (tx) => !!tx && tx.type !== 'transfer' && !tx.excludeFromReports;

export const isLiability = (account) => LIABILITY_TYPES.includes(account && account.type);

/**
 * One net-worth calculation for Home, Wealth and Analytics. [C10]
 * Credit cards and loans are liabilities. `assets` is an optional extra list of
 * asset records (this app keeps everything in the accounts list, so it is
 * normally omitted). Values keep their sign.
 */
export const computeNetWorth = (accounts = [], assets = []) => {
  let totalAssets = 0;
  let totalLiabilities = 0;
  [...accounts, ...assets].forEach((a) => {
    const bal = num(a.balance);
    if (isLiability(a)) totalLiabilities += bal;
    else totalAssets += bal;
  });
  totalAssets = round2(totalAssets);
  totalLiabilities = round2(totalLiabilities);
  return {
    assets: totalAssets,
    liabilities: totalLiabilities,
    netWorth: round2(totalAssets - totalLiabilities),
  };
};

// ── Pure balance maths ────────────────────────────────────────────────────

/** Index of the account a transaction belongs to: by accountId, else by name. -1 if none. */
export const findAccountIndex = (accounts, tx) => {
  if (!tx || tx.accountUnresolved) return -1; // capture waiting for the user to pick an account
  if (tx.accountId !== undefined && tx.accountId !== null) {
    const byId = accounts.findIndex(
      (a) => String(a.id) === String(tx.accountId) && SPENDABLE_TYPES.includes(a.type)
    );
    if (byId > -1) return byId;
  }
  const name = String(tx.account || '')
    .trim()
    .toLowerCase();
  if (!name) return -1;
  return accounts.findIndex(
    (a) =>
      SPENDABLE_TYPES.includes(a.type) &&
      String(a.name || '')
        .trim()
        .toLowerCase() === name
  );
};

/** Signed change a transaction makes to its account's stored balance. */
export const balanceDelta = (account, tx) => {
  const amt = num(tx.amount);
  const isIncome = tx.type === 'income';
  if (account.type === 'Credit Card') return isIncome ? -amt : amt;
  return isIncome ? amt : -amt;
};

/**
 * A captured transfer (card bill payment, wallet top-up) whose other account is not linked
 * yet: only the leg of the account the message was about can move. `flow` is 'in' or 'out'
 * for that account.
 */
const isOneSidedCapture = (tx) =>
  (tx.toAccountId === undefined || tx.toAccountId === null) &&
  !!tx.transferKind &&
  (tx.flow === 'in' || tx.flow === 'out');

const move = (accounts, tx, direction) => {
  if (tx?.type === 'transfer' && isOneSidedCapture(tx)) {
    return move(accounts, { ...tx, type: tx.flow === 'in' ? 'income' : 'expense' }, direction);
  }
  if (tx?.type === 'transfer') {
    const destination = accounts.find((a) => String(a.id) === String(tx.toAccountId));
    if (
      !destination ||
      !SPENDABLE_TYPES.includes(destination.type) ||
      findAccountIndex(accounts, tx) === -1 ||
      String(tx.accountId) === String(tx.toAccountId)
    )
      throw new Error('Choose two different accounts');
    const outgoing = { ...tx, type: 'expense' };
    const incoming = { ...tx, type: 'income', accountId: tx.toAccountId, account: destination.name };
    return move(move(accounts, outgoing, direction), incoming, direction);
  }
  const idx = findAccountIndex(accounts, tx);
  if (idx === -1) return accounts;
  const next = accounts.slice();
  const acc = { ...next[idx] };
  acc.balance = round2(num(acc.balance) + direction * balanceDelta(acc, tx));
  next[idx] = acc;
  return next;
};

export const applyToAccounts = (accounts, tx) => move(accounts, tx, +1);
export const reverseOnAccounts = (accounts, tx) => move(accounts, tx, -1);
/** Edit = reverse old + apply new. */
export const updateOnAccounts = (accounts, oldTx, newTx) =>
  applyToAccounts(reverseOnAccounts(accounts, oldTx), newTx);

/**
 * Auto-captured transactions (SMS / Gmail scan), processed oldest → newest.
 *  - Unresolved captures (account not picked yet) move nothing.
 *  - Every capture is applied as a delta (both legs for a linked transfer).
 *  - When the SMS carries a running balance, the account that balance belongs to
 *    (`balanceAccountId`, set by AccountResolver from balanceBelongsTo) is then SET to it,
 *    so the latest bank balance wins. Credit cards are never set (the figure is a limit).
 *    balanceBelongsTo 'unknown' → deltas only, nothing is overwritten.
 *  - Accounts are never created here (B7): AccountResolver / the review queue decide.
 * Legacy captures without `balanceAccountId` set the balance of their own account.
 */
export const applyCapturedToAccounts = (accounts, txs) => {
  let next = accounts.slice();
  const ordered = [...txs].sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate));
  ordered.forEach((tx) => {
    if (!tx || tx.accountUnresolved) return;
    const balIdx =
      tx.balanceAccountId !== undefined && tx.balanceAccountId !== null
        ? next.findIndex((a) => String(a.id) === String(tx.balanceAccountId))
        : tx.type !== 'transfer' && tx.balanceBelongsTo !== 'unknown'
          ? findAccountIndex(next, tx)
          : -1;
    try {
      next = applyToAccounts(next, tx);
    } catch {
      return; // a linked account was deleted meanwhile: never let one row break a sync
    }
    if (Number.isFinite(tx.extractedBalance) && balIdx > -1 && next[balIdx].type !== 'Credit Card') {
      next = next.slice();
      next[balIdx] = {
        ...next[balIdx],
        balance: round2(tx.extractedBalance),
        lastUpdated: new Date(tx.fullDate).toISOString(),
      };
    }
  });
  return next;
};

// ── Storage-backed wrappers ───────────────────────────────────────────────

const load = async () => {
  const json = await AsyncStorage.getItem(ACCOUNTS_KEY);
  return json ? JSON.parse(json) : [];
};
const save = (accounts) => AsyncStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));

export const applyTransaction = async (tx) => save(applyToAccounts(await load(), tx));
export const reverseTransaction = async (tx) => save(reverseOnAccounts(await load(), tx));
export const updateTransactionBalance = async (oldTx, newTx) =>
  save(updateOnAccounts(await load(), oldTx, newTx));
export const applyTransactions = async (txs) => {
  if (!txs || txs.length === 0) return;
  let accounts = await load();
  txs.forEach((tx) => {
    accounts = applyToAccounts(accounts, tx);
  });
  await save(accounts);
};
export const applyCapturedTransactions = async (txs) => {
  if (!txs || txs.length === 0) return;
  await save(applyCapturedToAccounts(await load(), txs));
};
