/**
 * PayeeRules (Phase 14 A3/A6) - pure.
 * A payee rule copies the owner's changes to future transactions from that payee:
 * { id, kind: 'payee', payeeKey, label, rename?, category?, tagsAdd?, tagsRemove?, createdAt, hits }.
 * Older 'contains' rules ({ pattern, category }) have no kind.
 */

/** A rule for `key` from the changes the owner ticked (null when nothing would be copied). */
export const ruleFromChanges = (key, changes, label = '') => {
  if (!key) return null;
  const rule = { kind: 'payee', payeeKey: key, label: label || key };
  if (changes.name) rule.rename = changes.name.to;
  if (changes.category) rule.category = changes.category.to;
  if (changes.tags?.add?.length) rule.tagsAdd = [...changes.tags.add];
  if (changes.tags?.remove?.length) rule.tagsRemove = [...changes.tags.remove];
  return rule.rename || rule.category || rule.tagsAdd || rule.tagsRemove ? rule : null;
};

const uniq = (a) => [...new Set(a)];

/**
 * Saves `rule`, merging it into an existing rule for the same payee (newest value wins per field;
 * tag lists are unioned, and a tag now added is no longer removed, and the other way round).
 * Returns { rules, id, previous } where previous is the rule before the merge (null when new).
 */
export const mergeRule = (rules, rule, now = Date.now()) => {
  const list = Array.isArray(rules) ? rules : [];
  const i = list.findIndex((r) => r.kind === 'payee' && r.payeeKey === rule.payeeKey);
  if (i < 0) {
    const id = `rule_${now}_${Math.random().toString(36).slice(2, 7)}`;
    return {
      rules: [...list, { ...rule, id, createdAt: new Date(now).toISOString(), hits: 0 }],
      id,
      previous: null,
    };
  }
  const old = list[i];
  const add = uniq([
    ...(old.tagsAdd || []).filter((g) => !(rule.tagsRemove || []).includes(g)),
    ...(rule.tagsAdd || []),
  ]);
  const remove = uniq([
    ...(old.tagsRemove || []).filter((g) => !(rule.tagsAdd || []).includes(g)),
    ...(rule.tagsRemove || []),
  ]);
  const merged = { ...old, ...rule, id: old.id, createdAt: old.createdAt, hits: old.hits || 0 };
  delete merged.tagsAdd;
  delete merged.tagsRemove;
  if (add.length) merged.tagsAdd = add;
  if (remove.length) merged.tagsRemove = remove;
  const next = list.slice();
  next[i] = merged;
  return { rules: next, id: old.id, previous: old };
};

/** Undo of a rule save: remove a new rule, or put the old one back. */
export const restoreRule = (rules, { id, previous }) =>
  previous
    ? (rules || []).map((r) => (r.id === id ? previous : r))
    : (rules || []).filter((r) => r.id !== id);
