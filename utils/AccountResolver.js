/**
 * AccountResolver.js (plan A3 + B7) - pure, no React Native imports.
 *
 * Decides which account a captured (SMS) transaction belongs to, BEFORE it is stored:
 *   1. Account type comes from the message: card → Credit Card, wallet → Wallet, else Bank Account.
 *      (So an SBI card spend can never land on an SBI savings account.)
 *   2. Bank: the bank's name tokens must appear in the account name / bankName / aliases.
 *   3. Last-4 digits: an account with the same digits wins; an account with DIFFERENT
 *      digits is a different account; an account without digits may match and then
 *      learns them.
 *   Exactly one candidate → matched. Several → 'pick_account' review. None → 'new_account'
 *   review with a suggested account. Bank and card accounts are NEVER auto-created (B7).
 *   Wallets ARE created (plan A3: top-up before the wallet exists), and flagged for review.
 *
 * Wallet top-up / withdraw transfers are then linked to the wallet, so both legs move
 * and net worth does not change.
 */

const lower = (s) => String(s || '').toLowerCase();
const GENERIC_NAMES = ['', 'cash', 'unknown', 'unknown bank', 'bank'];

// Words that identify a bank inside a user-chosen account name ("Axis Salary", "State Bank")
const BANK_TOKENS = {
  SBI: ['sbi', 'state bank'],
  'HDFC Bank': ['hdfc'],
  'ICICI Bank': ['icici'],
  'Axis Bank': ['axis'],
  'Kotak Bank': ['kotak'],
  'Bank of Baroda': ['baroda', 'bob'],
  PNB: ['pnb', 'punjab national'],
  'IDFC First Bank': ['idfc'],
  'Yes Bank': ['yes bank', 'yesbank'],
  'IndusInd Bank': ['indusind'],
  'Federal Bank': ['federal'],
  'Canara Bank': ['canara'],
  'Union Bank': ['union bank'],
  'Equitas Small Finance Bank': ['equitas'],
  'Paytm Payments Bank': ['paytm'],
  'Airtel Payments Bank': ['airtel'],
  Jupiter: ['jupiter'],
};

/** Lowercase tokens that identify `bankName` in an account name; [] for generic names. */
export const bankTokens = (bankName) => {
  const name = String(bankName || '').trim();
  if (GENERIC_NAMES.includes(name.toLowerCase())) return [];
  if (BANK_TOKENS[name]) return BANK_TOKENS[name];
  const first = name
    .toLowerCase()
    .replace(/^bank of\s+/, '')
    .split(/\s+/)[0];
  return first ? [first] : [];
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (account, tokens) => {
  const hay = lower([account.name, account.bankName, account.provider, ...(account.aliases || [])].join(' '));
  return tokens.some((t) => new RegExp(`(?:^|[^a-z0-9])${escapeRe(t)}(?:$|[^a-z0-9])`).test(hay));
};

/** Digits an account is known by: its `last4` field, or a masked tail in its name ("Axis ••0973"). */
export const last4Of = (account) => {
  if (account && account.last4) return String(account.last4);
  const m = String(account?.name || '').match(/(?:•+|\bx{2,}|\*+)\s*(\d{3,4})\b/i);
  return m ? m[1] : null;
};
// "123" (3-digit mask) and "0123" are the same account
const sameDigits = (a, b) => !!a && !!b && (a === b || a.endsWith(b) || b.endsWith(a));

const typeFor = (tx) =>
  tx.accountType === 'Credit Card' ? 'Credit Card' : tx.accountType === 'Wallet' ? 'Wallet' : 'Bank Account';

const walletFits = (a, subType) => a.type === 'Wallet' && (!subType || !a.subType || a.subType === subType);

/** Wallets for a provider; falls back to wallets with no provider set, never a different provider. */
const walletsFor = (accounts, { provider, subType }) => {
  const fit = accounts.filter((a) => walletFits(a, subType));
  if (!provider) return fit;
  const byProvider = fit.filter((a) => mentions(a, [lower(provider)]));
  return byProvider.length ? byProvider : fit.filter((a) => !a.provider);
};

/** Debit-card digits a bank account is known by (A11). */
export const debitCardsOf = (account) =>
  Array.isArray(account?.debitCards) ? account.debitCards.map(String) : [];

/**
 * { status: 'matched', account } | { status: 'ambiguous', candidates } | { status: 'none' }
 * | { status: 'link_debit_card', candidates } - a debit-card SMS (card digits, no account digits)
 *   from a bank the owner has accounts with, but the card is not linked to any of them yet (A11).
 */
export const resolveAccount = (accounts, tx) => {
  const type = typeFor(tx);
  let candidates;
  if (type === 'Wallet') {
    candidates = walletsFor(accounts, { provider: tx.walletProvider, subType: tx.walletSubType });
  } else {
    const tokens = bankTokens(tx.bankName || tx.account);
    candidates = tokens.length ? accounts.filter((a) => a.type === type && mentions(a, tokens)) : [];
    if (type === 'Bank Account' && !tx.last4 && tx.cardLast4) {
      const card = String(tx.cardLast4);
      const linked = candidates.filter((a) => debitCardsOf(a).some((d) => sameDigits(d, card)));
      if (linked.length === 1) return { status: 'matched', account: linked[0] };
      if (linked.length > 1) return { status: 'ambiguous', candidates: linked };
      // A card is never silently assumed to belong to an account: ask once, then remember it
      return candidates.length ? { status: 'link_debit_card', candidates } : { status: 'none' };
    }
    if (tx.last4) {
      const exact = candidates.filter((a) => sameDigits(last4Of(a), String(tx.last4)));
      if (exact.length === 1) return { status: 'matched', account: exact[0] };
      if (exact.length > 1) return { status: 'ambiguous', candidates: exact };
      candidates = candidates.filter((a) => !last4Of(a)); // other digits = another account
    }
  }
  if (candidates.length === 1) return { status: 'matched', account: candidates[0] };
  if (candidates.length > 1) return { status: 'ambiguous', candidates };
  return { status: 'none' };
};

/** Name offered when the user creates an account from a capture: "Axis Bank ••0973". */
export const suggestedAccountFor = (tx) => {
  const type = typeFor(tx);
  const bank = tx.bankName || tx.account || 'Account';
  const label = type === 'Credit Card' && !/card/i.test(bank) ? `${bank} Credit Card` : bank;
  const debitCard = type === 'Bank Account' && !tx.last4 && tx.cardLast4 ? String(tx.cardLast4) : null;
  return {
    name: tx.last4 ? `${label} ••${tx.last4}` : label,
    type,
    subType: type,
    bankName: tx.bankName || null,
    last4: tx.last4 || null,
    ...(debitCard ? { debitCards: [debitCard] } : {}),
  };
};

const hasBalance = (tx) => Number.isFinite(tx.extractedBalance);

const withAccount = (accounts, account) => {
  const i = accounts.findIndex((a) => String(a.id) === String(account.id));
  if (i === -1) return [...accounts, account];
  const next = accounts.slice();
  next[i] = account;
  return next;
};

const newWallet = (tx, bank, newId) => {
  const subType = tx.walletSubType || 'Other Wallet';
  const provider = tx.walletProvider || null;
  const name = provider ? `${provider} ${subType}` : subType;
  return {
    id: newId(),
    name,
    type: 'Wallet',
    subType,
    provider,
    linkedBankId: bank ? bank.id : null,
    aliases: [...new Set([lower(name), provider ? `${lower(provider)} lite` : null].filter(Boolean))],
    balance: 0,
    createdFrom: 'capture',
  };
};

/** Clear the review-only fields once a capture has its account. */
const resolvedFields = (tx, account) => {
  const { accountUnresolved, accountCandidates, suggestedAccount, ...rest } = tx;
  const out = { ...rest, accountId: account.id, account: account.name };
  if (hasBalance(tx) && account.type !== 'Credit Card' && tx.balanceBelongsTo !== 'unknown')
    out.balanceAccountId = account.id;
  return out;
};

/**
 * Link a one-sided wallet transfer to its other account. `perspective` is the account the
 * SMS was about (already resolved). Returns { accounts, tx }.
 */
export const linkWalletTransfer = (accounts, tx, perspective, { newId }) => {
  if (tx.type !== 'transfer' || !String(tx.transferKind || '').startsWith('wallet_')) return { accounts, tx };
  if (tx.toAccountId !== undefined && tx.toAccountId !== null) return { accounts, tx };
  let next = accounts;
  let counter = null;
  let reviewReason = tx.reviewReason;
  if (perspective.type === 'Wallet') {
    counter = next.find(
      (a) => String(a.id) === String(perspective.linkedBankId) && a.type === 'Bank Account'
    );
    if (!counter) return { accounts, tx }; // bank unknown: stays one-sided (wallet leg only)
  } else {
    const wallets = walletsFor(next, { provider: tx.walletProvider, subType: tx.walletSubType });
    let pick = wallets;
    if (pick.length > 1) {
      const linked = pick.filter((a) => String(a.linkedBankId) === String(perspective.id));
      if (linked.length) pick = linked;
    }
    if (pick.length > 1) return { accounts, tx: { ...tx, reviewReason: 'pick_wallet' } }; // bank leg only
    if (pick.length === 1) counter = pick[0];
    else {
      counter = newWallet(tx, perspective, newId);
      next = withAccount(next, counter);
      reviewReason = 'new_wallet';
    }
  }
  const linked = linkToCounter(tx, perspective, counter);
  if (reviewReason) linked.reviewReason = reviewReason;
  return { accounts: next, tx: linked };
};

/**
 * Two-legged version of a one-sided transfer. `perspective` = account the SMS was about,
 * `counter` = the other side. flow 'in' means money arrived at `perspective`.
 */
export const linkToCounter = (tx, perspective, counter) => {
  const receiver = tx.flow === 'in' ? perspective : counter;
  const sender = tx.flow === 'in' ? counter : perspective;
  const out = {
    ...tx,
    accountId: sender.id,
    account: sender.name,
    toAccountId: receiver.id,
    toAccount: receiver.name,
  };
  if (perspective.type === 'Wallet' || counter.type === 'Wallet')
    out.walletAccountId = (perspective.type === 'Wallet' ? perspective : counter).id;
  return out;
};

/**
 * Give a capture its account (matched automatically, or picked/created by the user):
 * learn the account's last-4 digits, record who owns the SMS balance, link wallet transfers.
 */
export const assignCapture = (accounts, tx, account, { newId }) => {
  let next = withAccount(accounts, account);
  let acc = account;
  if (tx.last4 && !last4Of(acc) && acc.type !== 'Wallet') {
    acc = { ...acc, last4: String(tx.last4) }; // learn the digits on first sight
    next = withAccount(next, acc);
  }
  // A11: a bank account learns the debit card used on it (from "A/c XX5678 … Debit Card XX9911",
  // or when the owner confirms which account a card belongs to)
  const card = tx.cardLast4 ? String(tx.cardLast4) : null;
  if (card && acc.type === 'Bank Account' && !debitCardsOf(acc).some((d) => sameDigits(d, card))) {
    acc = { ...acc, debitCards: [...debitCardsOf(acc), card] };
    next = withAccount(next, acc);
  }
  return linkWalletTransfer(next, resolvedFields(tx, acc), acc, { newId });
};

/**
 * Resolve one captured transaction against the accounts. Pure.
 * Returns { accounts, tx } - accounts may gain a wallet or learn last-4 digits.
 */
export const resolveCapture = (accounts, tx, { newId }) => {
  const isCapture = !!(tx.smsId || tx.gmailMsgId);
  if (!isCapture || (tx.accountId !== undefined && tx.accountId !== null)) return { accounts, tx };
  let next = accounts;
  const r = resolveAccount(next, tx);
  let account;
  if (r.status === 'matched') account = r.account;
  else if (r.status === 'none' && typeFor(tx) === 'Wallet') {
    account = newWallet(tx, null, newId);
    next = withAccount(next, account);
  } else if (r.status === 'link_debit_card') {
    return {
      accounts,
      tx: {
        ...tx,
        accountUnresolved: true,
        reviewReason: 'link_debit_card',
        accountCandidates: r.candidates.map((a) => a.id),
        suggestedAccount: suggestedAccountFor(tx),
      },
    };
  } else if (r.status === 'ambiguous') {
    return {
      accounts,
      tx: {
        ...tx,
        accountUnresolved: true,
        reviewReason: 'pick_account',
        accountCandidates: r.candidates.map((a) => a.id),
      },
    };
  } else {
    return {
      accounts,
      tx: {
        ...tx,
        accountUnresolved: true,
        reviewReason: 'new_account',
        suggestedAccount: suggestedAccountFor(tx),
      },
    };
  }
  const out = assignCapture(next, tx, account, { newId });
  if (r.status === 'none') out.tx = { ...out.tx, reviewReason: 'new_wallet' };
  return out;
};

/** Resolve a batch (oldest first so wallets created early are reused). */
export const newAccountId = () => `acc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const resolveCaptures = (accounts, txs, { newId } = {}) => {
  const gen = newId || newAccountId;
  let next = accounts;
  const order = txs.map((tx, i) => [tx, i]).sort((a, b) => new Date(a[0].fullDate) - new Date(b[0].fullDate));
  const out = new Array(txs.length);
  for (const [tx, i] of order) {
    const r = resolveCapture(next, tx, { newId: gen });
    next = r.accounts;
    out[i] = r.tx;
  }
  return { accounts: next, txs: out };
};

/** Same account the same way: used to resolve all similar pending captures in one tap. */
export const captureSignature = (tx) =>
  [
    typeFor(tx),
    lower(tx.bankName || tx.account),
    tx.last4 || '',
    lower(tx.walletProvider),
    // A11: debit-card captures group by card, so one "Yes" resolves that card's captures only
    typeFor(tx) === 'Bank Account' && !tx.last4 ? tx.cardLast4 || '' : '',
  ].join('|');

/**
 * Statement import (plan A5): link UPI Lite transfer rows to the bank account being imported
 * and its wallet. Never creates accounts - returns `missingWallet` (the suggested wallet) so
 * the preview can ASK "Create wallet account?" first.
 * Returns { rows, missingWallet: null | { name, type, subType, linkedBankId }, bank }.
 */
export const prepareStatementWallets = (rows, accounts, accountName) => {
  const name = lower(accountName).trim();
  const bank =
    accounts.find((a) => a.type === 'Bank Account' && lower(a.name).trim() === name) ||
    (() => {
      const hits = accounts.filter((a) => a.type === 'Bank Account' && mentions(a, bankTokens(accountName)));
      return hits.length === 1 ? hits[0] : null;
    })();
  const walletRows = rows.filter((r) => r.type === 'transfer' && /^wallet_/.test(r.transferKind || ''));
  if (!walletRows.length || !bank) return { rows, missingWallet: null, bank };
  let wallets = walletsFor(accounts, { subType: 'UPI Lite' });
  if (wallets.length > 1) {
    const linked = wallets.filter((w) => String(w.linkedBankId) === String(bank.id));
    if (linked.length) wallets = linked;
  }
  if (wallets.length === 0)
    return {
      rows: rows.map((r) => (walletRows.includes(r) ? { ...r, accountId: bank.id, account: bank.name } : r)),
      missingWallet: { name: 'UPI Lite', type: 'Wallet', subType: 'UPI Lite', linkedBankId: bank.id },
      bank,
    };
  if (wallets.length > 1) return { rows, missingWallet: null, bank }; // ambiguous: leave one-sided
  const wallet = wallets[0];
  return {
    rows: rows.map((r) =>
      walletRows.includes(r) ? linkToCounter({ ...r, accountId: bank.id }, bank, wallet) : r
    ),
    missingWallet: null,
    bank,
  };
};
