/**
 * Splits (Phase 14 E4) - pure. A transaction split into parts: each part has a category, or is
 * paid for a person (an IOU owed to you, not your spending). Parts must add up to the amount.
 * tx.splits = [{ id, amount, category?, personId? }]
 */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const partsTotal = (parts = []) => round2(parts.reduce((s, p) => s + num(p.amount), 0));
/** Your spending: the category parts. */
export const yourSpending = (parts = []) => partsTotal(parts.filter((p) => !p.personId));

/**
 * { ok, diff, errors }: diff = amount − parts (positive: still to assign).
 * Each part needs an amount above 0 and exactly one of category or person; a single
 * category part is not a split.
 */
export const validateSplit = (tx, parts = []) => {
  const errors = [];
  const diff = round2(num(tx?.amount) - partsTotal(parts));
  if (!parts.length) errors.push('Add at least one part.');
  parts.forEach((p, i) => {
    if (!(num(p.amount) > 0)) errors.push(`Part ${i + 1} needs an amount.`);
    if (!!p.category === !!p.personId) errors.push(`Part ${i + 1} needs a category or a person.`);
  });
  if (parts.length === 1 && parts[0].category && !parts[0].personId)
    errors.push('One category is not a split. Remove the split instead.');
  if (Math.abs(diff) >= 0.005) errors.push(diff > 0 ? `${diff} still to assign.` : `${-diff} too much.`);
  return { ok: errors.length === 0, diff, errors };
};

/**
 * Split equally between you and `personIds`. Shares are whole rupees when they can be; the
 * rounding remainder goes to you (your part keeps the transaction's category).
 */
export const equalSplit = (tx, personIds = [], category = tx?.category || 'Other') => {
  const amount = num(tx?.amount);
  const n = personIds.length + 1;
  let share = Math.floor(amount / n);
  if (share <= 0) share = Math.floor((amount * 100) / n) / 100;
  const mine = round2(amount - share * personIds.length);
  return [
    { id: 'p0', category, amount: mine },
    ...personIds.map((personId, i) => ({ id: `p${i + 1}`, personId, amount: share })),
  ];
};

/** Parts as stored: ids, amounts rounded, only the fields that apply. */
export const cleanParts = (parts = []) =>
  parts.map((p, i) => ({
    id: p.id || `p${i}`,
    amount: round2(num(p.amount)),
    ...(p.personId ? { personId: String(p.personId) } : { category: p.category }),
  }));

/** Settled IOU amount per person for this transaction. */
const settledFor = (txId, ious) => {
  const out = {};
  for (const i of ious || [])
    if (i.txId != null && String(i.txId) === String(txId) && i.settledAt)
      out[i.personId] = round2((out[i.personId] || 0) + num(i.amount));
  return out;
};

/**
 * The IOU list after saving `parts` on `tx`: open IOUs from this transaction are replaced; a part
 * already (partly) settled keeps its settled IOU and only the rest stays open. A part can't go
 * below what is settled.
 */
export const iousForSplit = (tx, parts, ious = [], { now = new Date().toISOString(), note } = {}) => {
  const settled = settledFor(tx.id, ious);
  const kept = ious.filter((i) => !(i.txId != null && String(i.txId) === String(tx.id) && !i.settledAt));
  const byPerson = {};
  for (const p of parts)
    if (p.personId) byPerson[p.personId] = round2((byPerson[p.personId] || 0) + num(p.amount));
  for (const [personId, s] of Object.entries(settled))
    if ((byPerson[personId] || 0) < s - 0.005)
      throw new Error('Part of this split is already settled. Unsettle it in People first.');
  const added = Object.entries(byPerson)
    .map(([personId, amt]) => ({ personId, open: round2(amt - (settled[personId] || 0)) }))
    .filter((x) => x.open > 0.005)
    .map((x) => ({
      id: `iou_${tx.id}_${x.personId}_${Date.parse(now) || 0}`,
      personId: x.personId,
      amount: x.open,
      direction: 'owedToMe',
      txId: tx.id,
      note: note || tx.merchant || tx.title || tx.category || 'Split',
      date: tx.fullDate || now,
    }));
  return [...kept, ...added];
};

/** Changes to save on the transaction. */
export const splitChanges = (parts) => ({ splits: cleanParts(parts) });
/** Removing the split: the single category comes back (it was never changed). */
export const UNSPLIT_CHANGES = { splits: undefined };

/** Export rows: one per part, with "Split of" naming the transaction; others unchanged. */
export const exportRows = (txs = [], peopleById = {}) =>
  txs.flatMap((tx) =>
    Array.isArray(tx.splits) && tx.splits.length
      ? tx.splits.map((p) => ({
          ...tx,
          amount: num(p.amount),
          category: p.personId ? `Paid for ${peopleById[p.personId]?.name || 'someone'}` : p.category,
          splitOf: tx.merchant || tx.title || '',
        }))
      : [{ ...tx, splitOf: '' }]
  );
