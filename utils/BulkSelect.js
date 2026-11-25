/**
 * BulkSelect (Phase 14 B5) - pure helpers for select mode on the Transactions list.
 */
import { normalizeTag, visibleTags } from './Tags';
import { round2 } from './Report';

const pickRows = (rows, ids) => {
  const set = new Set([...(ids || [])].map(String));
  return (rows || []).filter((r) => r && set.has(String(r.id)));
};

/** "3 selected · ₹702": the sum of the selected expenses. */
export const selectionTotal = (rows, ids) =>
  round2(pickRows(rows, ids).reduce((s, r) => s + (r.type === 'expense' ? Number(r.amount) || 0 : 0), 0));

/**
 * Which selected rows a Category or Account change may touch. Loan payments (the loan owns their
 * category) and transfers (merged pairs, two accounts) are skipped.
 * Returns { ids, skipped, note } with note like "2 skipped (loan payments / transfers)".
 */
export const eligibleFor = (rows, ids) => {
  const out = [];
  let loans = 0;
  let transfers = 0;
  for (const r of pickRows(rows, ids)) {
    if (r.type === 'transfer') transfers += 1;
    else if (r.loanLink) loans += 1;
    else out.push(r.id);
  }
  const skipped = loans + transfers;
  const why = [loans ? 'loan payments' : null, transfers ? 'transfers' : null].filter(Boolean).join(' / ');
  return { ids: out, skipped, note: skipped ? `${skipped} skipped (${why})` : '' };
};

/** User tags every selected row already has (offered as "Remove #tag"). */
export const sharedTags = (rows, ids) => {
  const sel = pickRows(rows, ids);
  if (!sel.length) return [];
  const [first, ...rest] = sel.map((r) => visibleTags(r.tags));
  return first.filter((g) => rest.every((tags) => tags.includes(g)));
};

/** The reports action: "Count in reports" when every selected row is already left out. */
export const reportsAction = (rows, ids) => {
  const sel = pickRows(rows, ids);
  const allOut = sel.length > 0 && sel.every((r) => r.excludeFromReports);
  return { label: allOut ? 'Count in reports' : 'Not in reports', exclude: !allOut };
};

/** The tag change for "Tag": add a new tag, or remove one every row has. */
export const tagChange = (input, remove = false) => {
  const g = normalizeTag(input);
  if (!g) return null;
  return { tags: remove ? { add: [], remove: [g] } : { add: [g], remove: [] } };
};

export const selectedRows = pickRows;
