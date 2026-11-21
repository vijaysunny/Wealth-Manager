/**
 * InvestmentLink.js (Phase 12 B3) - pure. A bank debit to an investment platform (SIP) is
 * money moving, not spending: when the owner has an investment account on that platform,
 * the capture becomes a transfer bank → investment (kind 'investment'). Otherwise it stays
 * an Investment expense and Review offers "Link to an investment".
 */
import { isInvestment } from './AccountsOverview';

export const PLATFORM_RE =
  /groww|zerodha|upstox|kuvera|\bcoin\b|paytm ?money|indmoney|et ?money|mf ?utilities|bse ?star|camsonline|\bcams\b|kfintech/i;

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

/** 'groww', 'paytmmoney', … for a payee text, or null. */
export const platformOf = (text) => {
  const m = String(text || '').match(PLATFORM_RE);
  return m ? norm(m[0]) : null;
};

const payeeText = (tx) => [tx?.merchant, tx?.title, tx?.vpa, tx?.description].filter(Boolean).join(' ');

/** A capture that looks like a SIP debit: bank expense to a known platform. */
export const isSipDebit = (tx) => !!tx && tx.type === 'expense' && !!platformOf(payeeText(tx));

/** Investment accounts on the same platform (account.platform, or the name says it). */
export const investmentsOn = (accounts = [], platform) =>
  !platform
    ? []
    : accounts.filter(
        (a) =>
          isInvestment(a) &&
          (norm(a.platform) === platform || platformOf(`${a.name} ${a.platform || ''}`) === platform)
      );

/** Turn the debit into a transfer into `investment`. */
export const linkToInvestment = (tx, investment) => ({
  ...tx,
  type: 'transfer',
  kind: 'investment',
  category: 'Investment',
  toAccountId: investment.id,
  toAccount: investment.name,
});

/**
 * For captures already resolved to a bank account: link SIP debits to the one investment
 * on that platform. Two or more candidates → left as an expense for Review.
 */
export const linkSipDebits = (accounts = [], txs = []) =>
  txs.map((tx) => {
    if (!isSipDebit(tx) || tx.accountUnresolved || tx.accountId == null) return tx;
    const from = accounts.find((a) => String(a.id) === String(tx.accountId));
    if (!from || from.type !== 'Bank Account') return tx;
    const on = investmentsOn(accounts, platformOf(payeeText(tx)));
    if (on.length !== 1) return tx;
    const linked = linkToInvestment(tx, on[0]);
    // the SMS balance still belongs to the bank (transfers do not look it up by name)
    return Number.isFinite(tx.extractedBalance) && tx.balanceAccountId == null
      ? { ...linked, balanceAccountId: from.id }
      : linked;
  });
