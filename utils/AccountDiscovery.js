/**
 * AccountDiscovery.js (Phase 12 A2) - pure, no React Native imports.
 *
 * Bank and card accounts are never auto-created from SMS (plan B7), so captures from an
 * account the owner has not added wait as 'new_account' review items. This groups them by
 * account so the Review accounts screen can offer one "Add account" per bank account/card.
 */
import { captureSignature, suggestedAccountFor } from './AccountResolver';

const isPendingNewAccount = (tx) =>
  !!tx &&
  tx.accountUnresolved === true &&
  tx.reviewReason === 'new_account' &&
  tx.reviewStatus !== 'confirmed';

const typeBank = (signature) => signature.split('|').slice(0, 2).join('|');
const digitsOf = (signature) => signature.split('|')[2] || '';

const latestLimit = (txs) => {
  const withLimit = txs
    .filter((t) => Number.isFinite(t.availableLimit))
    .sort((a, b) => new Date(b.fullDate) - new Date(a.fullDate));
  return withLimit.length ? withLimit[0].availableLimit : null;
};

/**
 * discoverAccounts(txs) → [{ signature, suggested, count, txIds, firstTxId, availableLimit }]
 * Grouped by captureSignature (type + bank + last-4 + wallet provider), biggest group first.
 * A group with no digits ("Your A/c has been debited … - Axis Bank") folds into the one group of
 * the same type and bank that has digits, because once that account exists the resolver
 * matches it anyway. With zero or several such groups it stays separate.
 */
export const discoverAccounts = (txs = []) => {
  const groups = new Map();
  for (const tx of txs) {
    if (!isPendingNewAccount(tx)) continue;
    const signature = captureSignature(tx);
    if (!groups.has(signature)) groups.set(signature, { signature, txs: [] });
    groups.get(signature).txs.push(tx);
  }
  for (const [signature, g] of [...groups]) {
    if (digitsOf(signature)) continue;
    const homes = [...groups.values()].filter(
      (o) => o !== g && digitsOf(o.signature) && typeBank(o.signature) === typeBank(signature)
    );
    if (homes.length === 1) {
      homes[0].txs.push(...g.txs);
      groups.delete(signature);
    }
  }
  return [...groups.values()]
    .map((g) => {
      const ordered = g.txs.slice().sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate));
      // the suggestion comes from a capture that carries the digits, when there is one
      const lead = ordered.find((t) => t.last4) || ordered[0];
      return {
        signature: g.signature,
        suggested: lead.suggestedAccount || suggestedAccountFor(lead),
        count: ordered.length,
        txIds: ordered.map((t) => t.id),
        firstTxId: lead.id,
        availableLimit: latestLimit(ordered),
      };
    })
    .sort((a, b) => b.count - a.count || a.suggested.name.localeCompare(b.suggested.name));
};

/** Review items that are not new-account groups (self-transfer, pick account, pick wallet …). */
export const checkItems = (txs = []) =>
  txs.filter((tx) => tx && tx.reviewStatus === 'pending' && !isPendingNewAccount(tx));

/** Total captures waiting in discovered groups. */
export const waitingCount = (groups = []) => groups.reduce((n, g) => n + g.count, 0);
