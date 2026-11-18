import {
  buildBackup,
  validateBackup,
  summarizeBackup,
  restoreBackup,
  BACKUP_FIELDS,
} from '../utils/BackupService';
import { BACKUP_VERSION } from '../utils/appInfo';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const memStorage = (init = {}) => {
  const m = { ...init };
  return {
    m,
    getItem: async (k) => (k in m ? m[k] : null),
    setItem: async (k, v) => {
      m[k] = v;
    },
    multiSet: async (pairs) => {
      pairs.forEach(([k, v]) => {
        m[k] = v;
      });
    },
  };
};

const full = () => ({
  user_transactions: JSON.stringify([
    { id: 1, amount: 100, type: 'expense', category: 'Food', fullDate: '2026-10-10T12:00:00Z' },
  ]),
  user_categories: JSON.stringify(['Food']),
  user_wealth_accounts: JSON.stringify([{ id: 1, type: 'Bank Account', name: 'HDFC', balance: 5000 }]),
  user_goals: JSON.stringify([{ id: 1, name: 'Car', targetAmount: 500000 }]),
  user_category_budgets: JSON.stringify({ Food: 3000 }),
  user_savings_pots: JSON.stringify([{ name: 'Trip' }]),
  recurring_transactions: JSON.stringify([{ id: 9, amount: 499, type: 'expense', nextDue: '2026-11-01' }]),
  user_budget_limit: '40000',
  savings_goal_pct: '25',
  user_name: 'Vijay',
  rejected_sources: JSON.stringify([]),
  monthly_budgets: JSON.stringify({ '2026-10': { limit: 40000 } }),
  category_rules: JSON.stringify([{ id: 1, pattern: 'swiggy', category: 'Food' }]),
  networth_history: JSON.stringify([{ date: '2026-10-11', netWorth: 5000 }]),
});

describe('backup round trip', () => {
  test('exports every field incl. recurring, budget limit, goal %, name, pots', async () => {
    const b = await buildBackup(memStorage(full()));
    expect(b.version).toBe(BACKUP_VERSION);
    expect(b.recurring).toHaveLength(1);
    expect(b.monthlyBudget).toBe('40000');
    expect(b.savingsGoalPct).toBe('25');
    expect(b.userName).toBe('Vijay');
    expect(b.savings).toEqual([{ name: 'Trip' }]);
    expect(b.budgets).toEqual({ Food: 3000 });
  });

  test('export → wipe → restore returns identical storage', async () => {
    const src = memStorage(full());
    const b = JSON.parse(JSON.stringify(await buildBackup(src)));
    expect(validateBackup(b).ok).toBe(true);
    const fresh = memStorage();
    await restoreBackup(b, fresh);
    Object.keys(BACKUP_FIELDS).forEach((f) => {
      const { key, kind } = BACKUP_FIELDS[f];
      if (kind === 'scalar') expect(fresh.m[key]).toBe(src.m[key]);
      else expect(JSON.parse(fresh.m[key])).toEqual(JSON.parse(src.m[key]));
    });
  });

  test('empty storage exports empty shapes and still validates', async () => {
    const b = await buildBackup(memStorage());
    expect(b.transactions).toEqual([]);
    expect(b.budgets).toEqual({});
    expect(b.monthlyBudget).toBeNull();
    expect(validateBackup(b).ok).toBe(true);
  });

  test('corrupt stored JSON falls back to empty shape', async () => {
    const b = await buildBackup(memStorage({ user_transactions: '{oops', user_category_budgets: '[1]' }));
    expect(b.transactions).toEqual([]);
    expect(b.budgets).toEqual({});
  });
});

describe('validateBackup refuses unknown shapes', () => {
  test.each([[null], ['text'], [[1, 2]], [42]])('non-object %p', (d) =>
    expect(validateBackup(d).ok).toBe(false)
  );
  test('object with no known fields', () => expect(validateBackup({ hello: 1 }).ok).toBe(false));
  test('wrong field types', () => {
    expect(validateBackup({ transactions: {} }).ok).toBe(false);
    expect(validateBackup({ budgets: [] }).ok).toBe(false);
    expect(validateBackup({ userName: {} }).ok).toBe(false);
  });
  test('malformed transactions / accounts / recurring', () => {
    expect(validateBackup({ transactions: [{ amount: 'x', type: 'expense' }] }).ok).toBe(false);
    expect(validateBackup({ transactions: [{ amount: 5, type: 'transfer' }] }).ok).toBe(false);
    expect(validateBackup({ wealth: [{ name: 'no type' }] }).ok).toBe(false);
    expect(validateBackup({ recurring: [{ amount: 'abc' }] }).ok).toBe(false);
  });
  test('newer major version refused; older gives a warning', () => {
    expect(validateBackup({ version: '99.0', transactions: [] }).ok).toBe(false);
    const old = validateBackup({ version: '2.0', transactions: [] });
    expect(old.ok).toBe(true);
    expect(old.warnings.length).toBe(1);
  });
  test('other app refused', () => expect(validateBackup({ app: 'Other', transactions: [] }).ok).toBe(false));
});

describe('summary + partial restore', () => {
  test('summary counts', () => {
    const s = summarizeBackup({
      transactions: [1, 2, 3],
      budgets: { a: 1 },
      monthlyBudget: '5000',
      userName: 'V',
    });
    expect(s).toEqual(
      expect.arrayContaining([
        { label: 'Transactions', count: 3 },
        { label: 'Category budgets', count: 1 },
        { label: 'Monthly budget', count: '₹5000' },
        { label: 'Name', count: 'V' },
      ])
    );
  });
  test('old backup only overwrites what it contains', async () => {
    const st = memStorage({ user_budget_limit: '1000', user_name: 'Keep' });
    const n = await restoreBackup(
      {
        version: '2.0',
        transactions: [{ id: 1, amount: 1, type: 'income', fullDate: '2026-10-10T12:00:00Z' }],
      },
      st
    );
    expect(n).toBe(1);
    expect(st.m.user_budget_limit).toBe('1000');
    expect(st.m.user_name).toBe('Keep');
  });
});
