/**
 * UndoStore (Phase 14 B6) - pure, in memory, one level.
 * A bulk change records each row's fields before and after. Undo restores the "before" values of
 * exactly those fields, skipping rows changed since. Expires after 10 minutes or at the next bulk change.
 */
export const UNDO_TTL_MS = 10 * 60 * 1000;

let last = null;

/**
 * kind: 'apply' | 'category' | 'tag' | 'account' | 'reports' …
 * entries: [{ id, before: { field: value }, after: { field: value } }]
 * extra.rule: { id, previous } - a payee rule this action created or merged into (previous = the rule before, or null).
 */
export const recordBulk = (kind, entries, extra = {}) => {
  last = entries && entries.length ? { kind, entries, at: Date.now(), ...extra } : null;
};

export const clearUndo = () => {
  last = null;
};

const alive = () => {
  if (last && Date.now() - last.at > UNDO_TTL_MS) last = null;
  return last;
};

/** { kind, count } of the change that can still be undone, or null. */
export const lastBulk = () => {
  const l = alive();
  return l ? { kind: l.kind, count: l.entries.length } : null;
};

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Takes the last bulk change (it can be undone once) and plans its undo against the rows as they
 * are now. Returns { patches: [{ id, changes }], skipped, rule } or null when nothing can be undone.
 */
export const takeUndo = (currentRows) => {
  const l = alive();
  if (!l) return null;
  last = null;
  const byId = new Map((currentRows || []).map((r) => [String(r.id), r]));
  const patches = [];
  let skipped = 0;
  for (const { id, before, after } of l.entries) {
    const row = byId.get(String(id));
    if (!row || Object.keys(after).some((f) => !same(row[f], after[f]))) {
      skipped += 1;
      continue;
    }
    patches.push({ id, changes: { ...before } });
  }
  return { patches, skipped, rule: l.rule || null };
};
