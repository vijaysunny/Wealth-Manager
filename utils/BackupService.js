/**
 * BackupService.js  (Phase 5)
 * Complete, versioned backup / restore.
 *
 * Backup fields (all optional on restore, so old 2.0 backups still load):
 *   transactions, categories, wealth, goals, budgets (per-category), savings (pots),
 *   recurring, monthlyBudget, savingsGoalPct, userName
 *
 * validateBackup() refuses anything that is not a plain object of the expected
 * shapes; summarizeBackup() gives the counts shown before overwriting.
 */
import AsyncStorage from '../data/Storage';
import { BACKUP_VERSION } from './appInfo';

// field -> { key: AsyncStorage key, kind: 'array' | 'object' | 'scalar' }
export const BACKUP_FIELDS = {
  transactions:   { key: 'user_transactions',      kind: 'array' },
  categories:     { key: 'user_categories',        kind: 'array' },
  wealth:         { key: 'user_wealth_accounts',   kind: 'array' },
  goals:          { key: 'user_goals',             kind: 'array' },
  budgets:        { key: 'user_category_budgets',  kind: 'object' },
  savings:        { key: 'user_savings_pots',      kind: 'array' },
  recurring:      { key: 'recurring_transactions', kind: 'array' },
  monthlyBudget:  { key: 'user_budget_limit',      kind: 'scalar' },
  savingsGoalPct: { key: 'savings_goal_pct',       kind: 'scalar' },
  rejectedSources: { key:'rejected_sources', kind:'array' },
  monthlyBudgets: { key:'monthly_budgets', kind:'object' },
  categoryRules: { key:'category_rules', kind:'array' },
  netWorthHistory: { key:'networth_history', kind:'array' },
  userName:       { key: 'user_name',              kind: 'scalar' },
};

const DEFAULTS = { array: [], object: {}, scalar: null };
const majorOf = (v) => parseInt(String(v || '0').split('.')[0], 10) || 0;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const parseStored = (raw, kind) => {
  if (raw === null || raw === undefined) return DEFAULTS[kind];
  if (kind === 'scalar') return raw;               // stored as plain strings
  try {
    const v = JSON.parse(raw);
    if (kind === 'array') return Array.isArray(v) ? v : [];
    return isPlainObject(v) ? v : {};
  } catch { return DEFAULTS[kind]; }
};

/** Read every field from storage into a backup object. */
export const buildBackup = async (storage = AsyncStorage) => {
  const data = { app: 'WealthManager', version: BACKUP_VERSION, date: new Date().toISOString() };
  const keys = Object.values(BACKUP_FIELDS).map(f => f.key);
  const values = storage.multiGet ? Object.fromEntries(await storage.multiGet(keys)) : null;
  for (const [field, { key, kind }] of Object.entries(BACKUP_FIELDS)) {
    data[field] = parseStored(values ? values[key] : await storage.getItem(key), kind);
  }
  return data;
};

/**
 * Check a parsed backup. Returns { ok, errors, warnings }.
 * Refuses: non-objects, newer major version, wrong field shapes, no known field at all,
 * transactions/accounts without the basic fields the app relies on.
 */
export const validateBackup = (data) => {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(data)) return { ok: false, errors: ['File is not a WealthManager backup.'], warnings };

  if (data.app && data.app !== 'WealthManager') errors.push('Backup was made by a different app.');
  if (data.version !== undefined && majorOf(data.version) > majorOf(BACKUP_VERSION)) {
    errors.push(`Backup version ${data.version} is newer than this app (${BACKUP_VERSION}). Update the app first.`);
  }

  let known = 0;
  for (const [field, { kind }] of Object.entries(BACKUP_FIELDS)) {
    if (data[field] === undefined || data[field] === null) continue;
    known++;
    const v = data[field];
    if (kind === 'array' && !Array.isArray(v)) errors.push(`"${field}" must be a list.`);
    if (kind === 'object' && !isPlainObject(v)) errors.push(`"${field}" must be an object.`);
    if (kind === 'scalar' && !['string', 'number'].includes(typeof v)) errors.push(`"${field}" must be text or a number.`);
  }
  if (known === 0) errors.push('No WealthManager data found in this file.');

  if (Array.isArray(data.transactions)) {
    const bad = data.transactions.filter(t => !isPlainObject(t) || (!Number.isFinite(Number(t.amount)) || Number(t.amount) <= 0) || t.id === undefined || !Number.isFinite(new Date(t.fullDate || t.date).getTime()) ||
      !['income', 'expense', 'transfer'].includes(t.type) || (t.type === 'transfer' && (!t.accountId || !t.toAccountId || String(t.accountId) === String(t.toAccountId)))).length;
    if (bad > 0) errors.push(`${bad} transaction(s) are malformed (missing amount or type).`);
  }
  if (Array.isArray(data.wealth)) {
    const bad = data.wealth.filter(a => !isPlainObject(a) || !a.type).length;
    if (bad > 0) errors.push(`${bad} account/asset record(s) are malformed.`);
  }
  if (Array.isArray(data.recurring)) {
    const bad = data.recurring.filter(r => !isPlainObject(r) || !Number.isFinite(Number(r.amount))).length;
    if (bad > 0) errors.push(`${bad} recurring entr${bad === 1 ? 'y is' : 'ies are'} malformed.`);
  }
  if (data.version !== undefined && majorOf(data.version) < majorOf(BACKUP_VERSION)) {
    warnings.push(`Older backup format (${data.version}); fields it does not have will be left as they are.`);
  }
  return { ok: errors.length === 0, errors, warnings };
};

/** Human summary of what a restore will replace: [{ label, count }]. */
export const summarizeBackup = (data) => {
  const out = [];
  const add = (label, v) => { if (v !== undefined && v !== null) out.push({ label, count: v }); };
  add('Transactions', Array.isArray(data.transactions) ? data.transactions.length : undefined);
  add('Accounts & assets', Array.isArray(data.wealth) ? data.wealth.length : undefined);
  add('Recurring entries', Array.isArray(data.recurring) ? data.recurring.length : undefined);
  add('Goals', Array.isArray(data.goals) ? data.goals.length : undefined);
  add('Categories', Array.isArray(data.categories) ? data.categories.length : undefined);
  add('Category budgets', isPlainObject(data.budgets) ? Object.keys(data.budgets).length : undefined);
  add('Savings pots', Array.isArray(data.savings) ? data.savings.length : undefined);
  if (data.monthlyBudget !== undefined && data.monthlyBudget !== null) out.push({ label: 'Monthly budget', count: `₹${data.monthlyBudget}` });
  if (data.userName) out.push({ label: 'Name', count: data.userName });
  return out;
};

export const formatSummary = (data) =>
  summarizeBackup(data).map(s => `• ${s.label}: ${s.count}`).join('\n');

/** Write every field present in the (already validated) backup. Returns the number of keys written. */
export const restoreBackup = async (data, storage = AsyncStorage) => {
  const check = validateBackup(data);
  if (!check.ok) throw new Error(check.errors.join("\n"));
  const pairs = [];
  for (const [field, { key, kind }] of Object.entries(BACKUP_FIELDS)) {
    if (data[field] === undefined || data[field] === null) continue;
    pairs.push([key, kind === 'scalar' ? String(data[field]) : JSON.stringify(data[field])]);
  }
  if (pairs.length) await storage.multiSet(pairs);
  return pairs.length;
};
