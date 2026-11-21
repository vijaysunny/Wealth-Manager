/**
 * AccountsOverview.js (C5.5) - pure. Groups accounts for the Accounts screen and the
 * three-number net-worth card (Cash & bank, Investments, Owed).
 */
import { computeNetWorth, isWallet } from './BalanceService';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n) => Math.round(n * 100) / 100;
const sum = (list) => round2(list.reduce((s, a) => s + num(a.balance), 0));

export const isBank = (a) => a?.type === 'Bank Account';
export const isCard = (a) => a?.type === 'Credit Card';
export const isLoan = (a) => a?.type === 'Loan';
export const isCashOrWallet = (a) => a?.type === 'Cash' || isWallet(a);
export const isInvestment = (a) => !!a && !isBank(a) && !isCard(a) && !isLoan(a) && !isCashOrWallet(a);

/**
 * An account made automatically (from SMS or Review) whose real balance nobody has told us:
 * no SMS balance (lastUpdated), never set by hand (balanceSetAt). Cards owe from zero, so
 * they never count as missing.
 */
export const balanceMissing = (a) =>
  !!a && !!a.createdFrom && !isCard(a) && !isInvestment(a) && !a.lastUpdated && !a.balanceSetAt;

export const groupAccounts = (accounts = []) => ({
  banks: accounts.filter(isBank),
  cards: accounts.filter(isCard),
  wallets: accounts.filter(isCashOrWallet),
  investments: accounts.filter(isInvestment),
  loans: accounts.filter(isLoan),
});

export const accountsOverview = (accounts = []) => {
  const g = groupAccounts(accounts);
  const nw = computeNetWorth(accounts);
  return {
    netWorth: nw.netWorth,
    cashBank: sum([...g.banks, ...g.wallets]),
    investments: sum(g.investments),
    owed: sum([...g.cards, ...g.loans]),
    missing: accounts.filter(balanceMissing).length,
  };
};

/** Latest available card limit seen in SMS, by account id. */
export const latestLimits = (txs = []) => {
  const out = {};
  const seen = {};
  for (const tx of txs) {
    if (!tx || tx.accountId == null || !Number.isFinite(tx.availableLimit)) continue;
    const id = String(tx.accountId);
    const t = new Date(tx.fullDate).getTime();
    if (seen[id] === undefined || t > seen[id]) {
      seen[id] = t;
      out[id] = tx.availableLimit;
    }
  }
  return out;
};

/** Transactions this month per account id (either side of a transfer). */
export const monthCounts = (txs = [], now = new Date()) => {
  const out = {};
  for (const tx of txs) {
    const d = new Date(tx?.fullDate);
    if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) continue;
    [tx.accountId, tx.toAccountId]
      .filter((x) => x != null)
      .forEach((id) => {
        out[String(id)] = (out[String(id)] || 0) + 1;
      });
  }
  return out;
};

/** "MF, stocks, FD/RD, PF · none added yet" / "· 3 holdings" */
export const investmentsSummary = (list = []) =>
  `MF, stocks, FD/RD, PF · ${list.length ? `${list.length} holding${list.length === 1 ? '' : 's'}` : 'none added yet'}`;
