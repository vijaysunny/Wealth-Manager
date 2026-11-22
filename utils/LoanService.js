/**
 * LoanService.js (Phase 13 C2/C3) - loads and saves Loan accounts. The record shape and the checks
 * are in LoanForm (pure); this file only reads and writes storage.
 */
import { putAccount, deleteAccount } from '../data/Collections';
import { updateAccount } from '../data/Storage';
import { getAll, update } from '../data/TransactionRepo';
import { applyLink, linkError, removeLink } from './LoanLink';
import { loadAccounts } from './CardService';
import { buildLoan, loanFormCheck } from './LoanForm';

export const loadLoan = async (loanId) => {
  const accounts = await loadAccounts();
  const loan =
    loanId == null ? null : accounts.find((a) => String(a.id) === String(loanId) && a.type === 'Loan');
  return { loan: loan || null, accounts };
};

export const loadLoanWithTxs = async (loanId) => ({ ...(await loadLoan(loanId)), txs: await getAll() });

/** Saves a new loan (loanId null) or replaces an existing one. Throws with the form's message. */
export const saveLoan = async (values, loanId = null, { now = new Date() } = {}) => {
  const { error } = loanFormCheck(values);
  if (error) throw new Error(error);
  let existing = {};
  if (loanId != null) {
    const { loan } = await loadLoan(loanId);
    if (!loan) throw new Error('This item no longer exists.');
    existing = loan;
  }
  const record = buildLoan(values, existing, now);
  if (values.sourceTxId && !record.fromTxId) record.fromTxId = values.sourceTxId;
  record.lastUpdated = now.toISOString();
  await putAccount(record);
  return record;
};

/** C3 "Mark as closed": nothing more is owed. */
export const closeLoan = async (loanId, now = new Date()) => {
  const ok = await updateAccount(loanId, { status: 'closed', closedAt: now.toISOString(), balance: 0 });
  if (!ok) throw new Error('This item no longer exists.');
};

export const reopenLoan = async (loanId) => {
  const ok = await updateAccount(loanId, { status: 'active', closedAt: null });
  if (!ok) throw new Error('This item no longer exists.');
};

export const deleteLoan = (loanId) => deleteAccount(loanId);

/** C3 Part-prepay without a transaction: stored on the loan; mode 'reduceEmi' | 'endSooner'. */
export const addPrepayment = async (loanId, { date, amount, mode }) => {
  const { loan } = await loadLoan(loanId);
  if (!loan) throw new Error('This item no longer exists.');
  const value = Number(amount);
  if (!(value > 0)) throw new Error('Enter the amount prepaid.');
  if (!(date instanceof Date) || !Number.isFinite(date.getTime()))
    throw new Error('Enter the date as DD/MM/YYYY.');
  const prepayments = [
    ...(Array.isArray(loan.prepayments) ? loan.prepayments : []),
    {
      id: `pp_${Date.now().toString(36)}`,
      date: date.toISOString(),
      amount: Math.round(value * 100) / 100,
      mode: mode === 'reduceEmi' ? 'reduceEmi' : 'endSooner',
    },
  ];
  await updateAccount(loanId, { prepayments, lastUpdated: new Date().toISOString() });
  return prepayments;
};

/** Changes for TransactionRepo.update that turn `old` into `next` (removed keys become undefined). */
const changesFor = (old, next) => {
  const out = { ...next };
  Object.keys(old).forEach((k) => {
    if (!(k in next)) out[k] = undefined;
  });
  return out;
};
const findTx = async (txId) => (await getAll()).find((t) => String(t.id) === String(txId)) || null;

/**
 * C6: link a transaction to a loan with the owner's split. Balances move as the type changes
 * (Loan received: income → one-sided transfer in, so the bank ends the same). A foreclosure closes
 * the loan; Loan received sets the loan amount when the loan has none yet.
 */
export const saveLink = async (txId, link, { now = new Date() } = {}) => {
  const tx = await findTx(txId);
  if (!tx) throw new Error('This item no longer exists.');
  const { loan } = await loadLoan(link.loanId);
  if (!loan) throw new Error('Pick a loan.');
  const txType = tx.loanLinkPrev ? tx.loanLinkPrev.type : tx.type;
  const error = linkError({ ...link, amount: tx.amount, txType });
  if (error) throw new Error(error);
  const next = applyLink(tx, link, loan);
  await update(tx.id, changesFor(tx, next));
  if (link.kind === 'foreclosure') await closeLoan(loan.id, now);
  if (link.kind === 'disbursal' && !(Number(loan.originalAmount) > 0))
    await updateAccount(loan.id, { originalAmount: Number(tx.amount) });
  return next;
};

/** C6: unlink; the transaction's earlier type and category come back. */
export const unlinkPayment = async (txId) => {
  const tx = await findTx(txId);
  if (!tx) throw new Error('This item no longer exists.');
  const next = removeLink(tx);
  await update(tx.id, changesFor(tx, next));
  return next;
};

/** C6 "Count in budget as" (per loan): 'full' | 'interestOnly', mirrored on its linked payments. */
export const setBudgetMode = async (loanId, mode) => {
  const budgetMode = mode === 'interestOnly' ? 'interestOnly' : 'full';
  await updateAccount(loanId, { budgetMode });
  const linked = (await getAll()).filter((t) => t.loanLink && String(t.loanLink.loanId) === String(loanId));
  for (const t of linked) {
    if (!!t.loanLink.interestOnly !== (budgetMode === 'interestOnly'))
      await update(t.id, { loanLink: { ...t.loanLink, interestOnly: budgetMode === 'interestOnly' } });
  }
};
