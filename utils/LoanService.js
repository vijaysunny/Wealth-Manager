/**
 * LoanService.js (Phase 13 C2/C3) - loads and saves Loan accounts. The record shape and the checks
 * are in LoanForm (pure); this file only reads and writes storage.
 */
import { putAccount, deleteAccount } from '../data/Collections';
import { updateAccount } from '../data/Storage';
import { getAll } from '../data/TransactionRepo';
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
