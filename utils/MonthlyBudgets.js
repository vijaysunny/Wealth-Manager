import Storage, { readValue, writeValue } from '../data/Storage';
import { atomic } from '../data/Database';
import { monthSpend } from './Report';
import { sendTransactionNotification } from './NotificationService';
export const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
export const computeMonthlyBudget = (date, config, transactions, fallback = { limit: 0, categories: {} }) => {
  const target = monthKey(date);
  const keys = Object.keys(config)
    .filter((k) => k <= target)
    .sort();
  if (!keys.length) return { ...fallback, rollover: 0, effectiveLimit: Number(fallback.limit) || 0 };
  const [year, month] = keys[0].split('-').map(Number);
  const cursor = new Date(year, month - 1, 1);
  let carry = 0,
    base = fallback;
  while (monthKey(cursor) <= target) {
    const key = monthKey(cursor);
    base = config[key] || base;
    const limit = Number(base.limit) || 0;
    const effectiveLimit = limit + (base.rollover ? carry : 0);
    if (key === target) return { ...base, limit, carry: base.rollover ? carry : 0, effectiveLimit };
    const spent = monthSpend(transactions, cursor).total;
    carry = Math.max(0, effectiveLimit - spent);
    cursor.setMonth(cursor.getMonth() + 1);
  }
};
export const getMonthlyBudget = async (date, txs) => {
  const pairs = Object.fromEntries(
    await Storage.multiGet(['monthly_budgets', 'user_budget_limit', 'user_category_budgets'])
  );
  return computeMonthlyBudget(date, JSON.parse(pairs.monthly_budgets || '{}'), txs, {
    limit: Number(pairs.user_budget_limit) || 0,
    categories: JSON.parse(pairs.user_category_budgets || '{}'),
  });
};
export const saveMonthlyBudget = (date, changes) =>
  atomic(async (db) => {
    const configs = JSON.parse((await readValue(db, 'monthly_budgets')) || '{}');
    const key = monthKey(date);
    const previous = configs[key] || {
      limit: Number(await readValue(db, 'user_budget_limit')) || 0,
      categories: JSON.parse((await readValue(db, 'user_category_budgets')) || '{}'),
    };
    configs[key] = { ...previous, ...changes };
    await writeValue(db, 'monthly_budgets', JSON.stringify(configs));
  });
let checking = Promise.resolve();
export const checkBudgetAlerts = () => {
  const result = checking.then(async () => {
    const txs = JSON.parse((await Storage.getItem('user_transactions')) || '[]');
    const date = new Date();
    const config = await getMonthlyBudget(date, txs);
    const month = monthSpend(txs, date);
    for (const [category, limit] of Object.entries({
      Overall: config.effectiveLimit,
      ...config.categories,
    })) {
      const spent = category === 'Overall' ? month.total : month.byCategory[category] || 0;
      if (!(limit > 0)) continue;
      for (const threshold of [80, 100]) {
        const key = `budget_alert_${monthKey(date)}_${category}_${threshold}`;
        if ((spent / limit) * 100 >= threshold && !(await Storage.getItem(key))) {
          await sendTransactionNotification(
            `${category} budget ${threshold}%`,
            `Spent ₹${spent.toLocaleString('en-IN')} of ₹${Number(limit).toLocaleString('en-IN')}`
          );
          await Storage.setItem(key, 'sent');
        }
      }
    }
  });
  checking = result.catch(() => {});
  return result;
};
