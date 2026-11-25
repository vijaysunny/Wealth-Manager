/**
 * PayeeRules (Phase 14 A3/A6) - pure.
 * A payee rule copies the owner's changes to future transactions from that payee:
 * { id, kind: 'payee', payeeKey, label, rename?, category?, tagsAdd?, tagsRemove?, createdAt, hits }.
 * Older 'contains' rules ({ pattern, category }) have no kind.
 */
import { payeeKey, payeeName, sourceOf, isLocked, matchRows } from './PayeeMatch';
import { normalizeTag } from './Tags';

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

const tagList = (tx) => (Array.isArray(tx.tags) ? tx.tags.map(normalizeTag).filter(Boolean) : []);

/**
 * A6: apply saved rules to a new transaction. Payee rules first (exact payee key, so later SMS
 * still reading "SWIGGY INST" are renamed), then 'contains' rules in order. A category or name the
 * owner chose is never changed; tagsRemove only removes tags a rule added, never the owner's.
 * Returns the same object when no rule applies; otherwise a copy with `ruleIds` of the rules used.
 */
export const applyRules = (tx, rules) => {
  const list = Array.isArray(rules) ? rules : [];
  if (!list.length) return tx;
  const key = payeeKey(tx);
  const payee = key ? list.find((r) => r.kind === 'payee' && r.payeeKey === key) : null;
  const text = [tx.title, tx.merchant, tx.vpa, tx.note].join(' ').toLowerCase();
  const contains = list.find(
    (r) =>
      (r.kind || 'contains') === 'contains' && r.pattern?.trim() && text.includes(r.pattern.toLowerCase())
  );
  const catFree = !isLocked(sourceOf(tx, 'category'));
  const nameFree = !isLocked(sourceOf(tx, 'name'));
  const out = { ...tx };
  let catSet = false;
  let nameSet = false;
  let tags = tagList(tx);
  const added = [];
  const used = [];
  for (const rule of [payee, contains].filter(Boolean)) {
    let hit = false;
    if (rule.category && catFree && !catSet) {
      out.category = rule.category;
      out.categorySource = 'rule';
      catSet = hit = true;
    }
    if (rule.rename && nameFree && !nameSet) {
      out.merchant = rule.rename;
      out.title = rule.rename;
      out.nameSource = 'rule';
      nameSet = hit = true;
    }
    for (const g of (rule.tagsAdd || []).map(normalizeTag).filter(Boolean)) {
      hit = true;
      if (!tags.includes(g)) {
        tags.push(g);
        added.push(g);
      }
    }
    const drop = (rule.tagsRemove || []).map(normalizeTag).filter((g) => added.includes(g));
    if (drop.length) {
      tags = tags.filter((g) => !drop.includes(g));
      hit = true;
    }
    if (hit) used.push(rule.id);
  }
  if (!used.length) return tx;
  // A merchant the owner has named is a known payee, not a possible self-transfer
  delete out.transferCandidate;
  // SMS rows without a payee are titled with their category: keep that in step
  if (catSet && !nameSet && tx.title && tx.title === tx.category) out.title = out.category;
  if (added.length || tags.length !== tagList(tx).length) out.tags = tags;
  const ids = used.filter(Boolean);
  if (ids.length) out.ruleIds = ids;
  return out;
};

/** A6: rules with `hits` raised for each stored transaction that used them. */
export const countHits = (rules, txs) => {
  const n = {};
  for (const tx of txs || []) for (const id of tx.ruleIds || []) n[id] = (n[id] || 0) + 1;
  if (!Object.keys(n).length) return rules;
  return (rules || []).map((r) => (r.id && n[r.id] ? { ...r, hits: (r.hits || 0) + n[r.id] } : r));
};

/** The changes a saved rule makes, in diffEdit's shape (tagsRemove is never applied to past rows). */
export const ruleChanges = (rule) => {
  const ch = {};
  if (rule.rename) ch.name = { from: rule.label || '', to: rule.rename };
  if (rule.category) ch.category = { from: '', to: rule.category };
  if (rule.tagsAdd?.length) ch.tags = { add: rule.tagsAdd.map(normalizeTag).filter(Boolean), remove: [] };
  return ch;
};

/** Does `rule` pick out this transaction? Payee rules by exact payee key, others by text. */
export const ruleMatches = (rule, tx) => {
  if (!tx) return false;
  if (rule.kind === 'payee') return !!rule.payeeKey && payeeKey(tx) === rule.payeeKey;
  const p = String(rule.pattern || '')
    .trim()
    .toLowerCase();
  return !!p && [tx.title, tx.merchant, tx.vpa, tx.note].join(' ').toLowerCase().includes(p);
};

/** A6 "Apply to past transactions now": the A3 sheet's result for a saved rule. */
export const rulePreview = (rule, all) => {
  const changes = ruleChanges(rule);
  const rows = (all || []).filter((r) => r && !r.deleted && ruleMatches(rule, r));
  return { ...matchRows(rows, changes), changes };
};

/** "SWIGGY INST → Swiggy Instamart · Food · #groceries · used 14 times" */
export const ruleLine = (rule) => {
  const who = rule.kind === 'payee' ? rule.label || rule.payeeKey : `Contains "${rule.pattern}"`;
  const what = [
    rule.rename || null,
    rule.category || null,
    ...(rule.tagsAdd || []).map((g) => `#${g}`),
    ...(rule.tagsRemove || []).map((g) => `no #${g}`),
  ].filter(Boolean);
  const hits = rule.hits || 0;
  return `${who} → ${what.join(' · ') || 'nothing'} · used ${hits} time${hits === 1 ? '' : 's'}`;
};

/** Recent distinct payees for the Add rule picker: [{ key, name }], newest first. */
export const recentPayees = (txs, n = 12) => {
  const seen = new Map();
  const sorted = (txs || [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => String(b.fullDate || '').localeCompare(String(a.fullDate || '')));
  for (const tx of sorted) {
    if (seen.size >= n) break;
    if (!tx || tx.type === 'transfer') continue;
    const key = payeeKey(tx);
    if (key && !seen.has(key))
      seen.set(key, { key, name: tx.merchant || tx.counterparty || (tx.vpa ? key : payeeName(tx)) || key });
  }
  return [...seen.values()];
};
