/**
 * WalletReconcile.js (plan A4.1) - pure. Most UPI Lite payments send no bank SMS, so the
 * owner periodically types the balance the UPI app shows; the gap becomes one entry.
 */
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * { diff, action } for a wallet: diff = tracked − entered.
 *   diff > 0 → 'expense' "Unrecorded wallet spends" for diff
 *   diff < 0 → 'income' "Wallet correction" (or 'topup' transfer from the linked bank)
 *   diff = 0 → 'none'
 */
export const computeReconcile = (account, entered) => {
  const value = Number(entered);
  if (!account || account.type !== 'Wallet') throw new Error('Choose a wallet account');
  if (!Number.isFinite(value) || value < 0) throw new Error('Enter the balance shown in the app (0 or more)');
  const diff = round2(Number(account.balance || 0) - value);
  return { diff, action: diff > 0 ? 'expense' : diff < 0 ? 'income' : 'none' };
};

/** The transaction that closes the gap. mode: 'income' (default) or 'topup' for diff < 0. */
export const reconcileTransaction = (
  account,
  entered,
  { id, mode = 'income', category, now = new Date() } = {}
) => {
  const { diff, action } = computeReconcile(account, entered);
  if (action === 'none') return null;
  const base = {
    id,
    amount: Math.abs(diff),
    fullDate: now.toISOString(),
    accountId: account.id,
    account: account.name,
    source: 'wallet_reconcile',
    reconciled: true,
    tags: ['Reconciled'],
  };
  if (action === 'expense')
    return { ...base, type: 'expense', title: 'Unrecorded wallet spends', category: category || 'General' };
  if (mode === 'topup') {
    if (!account.linkedBankId) throw new Error('Link a bank to this wallet to record a top-up');
    return {
      ...base,
      type: 'transfer',
      transferKind: 'wallet_topup',
      title: 'Wallet top-up (not captured)',
      category: 'Wallet Top-up',
      accountId: account.linkedBankId,
      account: undefined,
      toAccountId: account.id,
      toAccount: account.name,
    };
  }
  return { ...base, type: 'income', title: 'Wallet correction', category: category || 'Wallet correction' };
};
