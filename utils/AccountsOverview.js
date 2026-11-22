/**
 * AccountsOverview.js (C5.5) - pure. Groups accounts for the Accounts screen and the
 * three-number net-worth card (Cash & bank, Investments, Liabilities).
 */
import { computeNetWorth, isWallet } from './BalanceService';
import { cardDebt, isCardSetUp } from './CardMath';
import { isCardEmi } from './LoanCalculator';
import { loanOwed } from './LoanLedger';

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

/**
 * Phase 13 C1/C5. opts { txs, asOf }: with transactions, cards use CardMath and loans their
 * schedule. liabilities = cards' positive owed (counted ones) + active loans, never card EMIs.
 * An overpaid card's credit is shown in Cash & bank (cardCredit). `owed` = liabilities (alias,
 * kept for one release).
 */
export const accountsOverview = (accounts = [], { txs = null, asOf = new Date() } = {}) => {
  const g = groupAccounts(accounts);
  const nw = computeNetWorth(accounts, [], { txs, asOf });
  const cards = g.cards.map((account) => {
    const d = txs
      ? cardDebt(account, txs, asOf)
      : { owed: num(account.balance), counted: true, source: 'history' };
    return { account, owed: d.owed, counted: d.counted, source: d.source, setUp: isCardSetUp(account) };
  });
  const loans = g.loans.map((account) => ({
    account,
    outstanding: round2(txs ? num(loanOwed(account, txs, asOf)) : num(account.balance)),
    inCard: isCardEmi(account),
    closed: account.status === 'closed',
  }));
  const cardOwed = round2(cards.reduce((s, c) => s + (c.counted && c.owed > 0 ? c.owed : 0), 0));
  const cardCredit = round2(cards.reduce((s, c) => s + (c.counted && c.owed < 0 ? -c.owed : 0), 0));
  const loanTotal = round2(loans.reduce((s, l) => s + (l.inCard || l.closed ? 0 : l.outstanding), 0));
  const liabilities = round2(cardOwed + loanTotal);
  return {
    netWorth: nw.netWorth,
    cashBank: round2(sum([...g.banks, ...g.wallets]) + cardCredit),
    cardCredit,
    investments: sum(g.investments),
    liabilities,
    owed: liabilities,
    missing: accounts.filter(balanceMissing).length,
    notCounted: cards.filter((c) => !c.counted).map((c) => c.account),
    groups: {
      liabilities: {
        cards,
        loans: loans.filter((l) => !l.closed),
        closed: loans.filter((l) => l.closed),
      },
    },
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
