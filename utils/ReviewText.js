/**
 * ReviewText.js - pure helpers for review-queue rows (plan A3/A6).
 */
import { formatMoney } from './Format';

const KIND_LABEL = {
  wallet_topup: 'Top-up',
  wallet_withdraw: 'Withdraw to bank',
  cc_payment: 'Card payment',
};

/** Headline for a captured row: "Top-up: Axis Bank → UPI Lite ₹500". */
export const describeCapture = (tx) => {
  const amount = formatMoney(tx.amount);
  if (tx.type === 'transfer') {
    const label = KIND_LABEL[tx.transferKind] || 'Transfer';
    if (tx.toAccount) return `${label}: ${tx.account} → ${tx.toAccount} ${amount}`;
    const side = tx.flow === 'in' ? `→ ${tx.account}` : `${tx.account} →`;
    return `${label}: ${side} ${amount} (other account not linked yet)`;
  }
  const who = tx.merchant || tx.vpa || tx.title || tx.category;
  return `${tx.type === 'income' ? 'Received' : 'Spent'} ${amount} · ${who} · ${tx.account || '—'}`;
};

/** Why the row needs attention, or null. */
export const reviewHint = (tx) => {
  switch (tx.reviewReason) {
    case 'new_account':
      return `No matching account. Create "${tx.suggestedAccount?.name || tx.bankName}" or pick one.`;
    case 'pick_account':
      return 'More than one account could match. Pick the right one.';
    case 'pick_wallet':
      return 'Which wallet received this? Pick one to link both sides.';
    case 'new_wallet':
      return `A wallet "${tx.toAccount || tx.account}" was created for this. Rename it in Wealth if needed.`;
    default:
      break;
  }
  if (tx.transferCandidate)
    return 'Bank transfer to a person/account. If it went to your own account, edit it into a transfer.';
  return null;
};
