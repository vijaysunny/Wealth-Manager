import AsyncStorage from '../data/Storage';
import {
  advanceDue,
  firstDueOnOrAfter,
  dueDatesUpTo,
  migrateEntry,
  initialNextDue,
  toKey,
  fromKey,
  processRecurringTransactions,
} from '../utils/RecurringEngine';

// babel-jest hoists this above the imports
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const d = (s) => fromKey(s);
const keys = (arr) => arr.map(toKey);

describe('month-end clamping (C12)', () => {
  const entry = { frequency: 'Monthly', dayOfMonth: 31 };
  test('Jan 31 → Feb 28 → Mar 31 → Apr 30', () => {
    let due = d('2023-01-31');
    const seq = [];
    for (let i = 0; i < 3; i++) {
      due = advanceDue(entry, due);
      seq.push(toKey(due));
    }
    expect(seq).toEqual(['2023-02-28', '2023-03-31', '2023-04-30']);
  });
  test('leap year Feb 29, and Dec → Jan rollover', () => {
    expect(toKey(advanceDue(entry, d('2024-01-31')))).toBe('2024-02-29');
    expect(toKey(advanceDue(entry, d('2023-12-31')))).toBe('2024-01-31');
  });
  test('quarterly and yearly stay anchored to the day', () => {
    expect(toKey(advanceDue({ frequency: 'Quarterly', dayOfMonth: 31 }, d('2023-11-30')))).toBe('2024-02-29');
    expect(toKey(advanceDue({ frequency: 'Yearly', dayOfMonth: 29 }, d('2024-02-29')))).toBe('2025-02-28');
    expect(toKey(advanceDue({ frequency: 'Yearly', dayOfMonth: 29 }, d('2027-02-28')))).toBe('2028-02-29');
  });
  test('first due: day already passed this month rolls to next, clamped', () => {
    expect(toKey(firstDueOnOrAfter(entry, d('2023-02-10')))).toBe('2023-02-28');
    expect(toKey(firstDueOnOrAfter({ frequency: 'Monthly', dayOfMonth: 5 }, d('2023-02-10')))).toBe(
      '2023-03-05'
    );
  });
});

describe('catch-up', () => {
  test('rent on the 15th, app unopened for 20 days → missed instance generated, nextDue is the NEXT 15th', () => {
    const entry = { frequency: 'Monthly', dayOfMonth: 15, nextDue: '2024-01-15' };
    const { dates, nextDue } = dueDatesUpTo(entry, d('2024-02-04'));
    expect(keys(dates)).toEqual(['2024-01-15']);
    expect(nextDue).toBe('2024-02-15');
  });
  test('unopened for 3 months → every missed month', () => {
    const entry = { frequency: 'Monthly', dayOfMonth: 15, nextDue: '2024-01-15' };
    const { dates, nextDue } = dueDatesUpTo(entry, d('2024-04-20'));
    expect(keys(dates)).toEqual(['2024-01-15', '2024-02-15', '2024-03-15', '2024-04-15']);
    expect(nextDue).toBe('2024-05-15');
  });
  test('nothing due yet → no dates, nextDue unchanged', () => {
    const entry = { frequency: 'Monthly', dayOfMonth: 15, nextDue: '2024-02-15' };
    expect(dueDatesUpTo(entry, d('2024-02-14'))).toEqual({ dates: [], nextDue: '2024-02-15' });
  });
  test('daily catch-up', () => {
    const { dates } = dueDatesUpTo({ frequency: 'Daily', nextDue: '2024-03-01' }, d('2024-03-04'));
    expect(keys(dates)).toEqual(['2024-03-01', '2024-03-02', '2024-03-03', '2024-03-04']);
  });
});

describe('weekly weekday', () => {
  test('honours the chosen weekday (Friday=5)', () => {
    const entry = { frequency: 'Weekly', weekday: 5 };
    expect(toKey(firstDueOnOrAfter(entry, d('2024-03-06')))).toBe('2024-03-08'); // Wed → Fri
    expect(toKey(firstDueOnOrAfter(entry, d('2024-03-08')))).toBe('2024-03-08'); // already Fri
    const next = { ...entry, nextDue: '2024-03-08' };
    expect(keys(dueDatesUpTo(next, d('2024-03-25')).dates)).toEqual([
      '2024-03-08',
      '2024-03-15',
      '2024-03-22',
    ]);
  });
});

describe('migration of old entries', () => {
  const today = d('2024-03-20');
  test('derives nextDue from lastProcessed', () => {
    const e = migrateEntry(
      { id: 1, frequency: 'Monthly', dayOfMonth: 15, lastProcessed: '2024-02-15T10:00:00Z' },
      today
    );
    expect(e.nextDue).toBe('2024-03-15'); // after Feb 15 → March 15 is still owed
  });
  test('lastProcessed on the due day itself moves to next month', () => {
    const e = migrateEntry(
      { id: 1, frequency: 'Monthly', dayOfMonth: 15, lastProcessed: '2024-03-15T10:00:00Z' },
      today
    );
    expect(e.nextDue).toBe('2024-04-15');
  });
  test('weekly legacy entry keeps the weekday of its last run', () => {
    const e = migrateEntry({ id: 1, frequency: 'Weekly', lastProcessed: '2024-03-08T10:00:00Z' }, today); // Friday
    expect(e.weekday).toBe(5);
    expect(e.nextDue).toBe('2024-03-15');
  });
  test('never processed + new id → starts at the next scheduled date', () => {
    const e = migrateEntry({ id: 5, frequency: 'Monthly', dayOfMonth: 1 }, today);
    expect(e.nextDue).toBe('2024-04-01');
  });
  test('entries that already have nextDue are untouched', () => {
    const e = { id: 1, frequency: 'Monthly', dayOfMonth: 1, nextDue: '2024-05-01' };
    expect(migrateEntry(e, today)).toBe(e);
  });
  test('initialNextDue for the entry form', () => {
    expect(initialNextDue({ frequency: 'Monthly', dayOfMonth: 31 }, d('2024-02-10'))).toBe('2024-02-29');
  });
});

describe('processRecurringTransactions end to end', () => {
  beforeEach(() => AsyncStorage.clear());

  test('generates missed instances once, moves the balance, advances nextDue', async () => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth() - 2, 1, 12);
    await AsyncStorage.setItem(
      'user_wealth_accounts',
      JSON.stringify([{ id: 1, name: 'HDFC Bank', type: 'Bank Account', balance: 10000 }])
    );
    await AsyncStorage.setItem(
      'recurring_transactions',
      JSON.stringify([
        {
          id: 77,
          title: 'Rent',
          amount: 1000,
          type: 'expense',
          frequency: 'Monthly',
          dayOfMonth: 1,
          account: 'HDFC Bank',
          category: 'Bills',
          active: true,
          nextDue: toKey(start),
        },
      ])
    );

    const first = await processRecurringTransactions();
    expect(first.processed).toBe(3); // 2 months ago, last month, this month (day 1 has passed or is today)
    const txs = JSON.parse(await AsyncStorage.getItem('user_transactions'));
    expect(txs).toHaveLength(3);
    const acc = JSON.parse(await AsyncStorage.getItem('user_wealth_accounts'));
    expect(acc[0].balance).toBe(7000);

    const rec = JSON.parse(await AsyncStorage.getItem('recurring_transactions'))[0];
    expect(rec.nextDue > toKey(today)).toBe(true);

    const second = await processRecurringTransactions(); // running again must not double-post
    expect(second.processed).toBe(0);
    expect(JSON.parse(await AsyncStorage.getItem('user_wealth_accounts'))[0].balance).toBe(7000);
  });

  test('paused entries are skipped', async () => {
    await AsyncStorage.setItem(
      'recurring_transactions',
      JSON.stringify([
        {
          id: 1,
          title: 'X',
          amount: 5,
          type: 'expense',
          frequency: 'Daily',
          active: false,
          nextDue: '2020-01-01',
        },
      ])
    );
    expect((await processRecurringTransactions()).processed).toBe(0);
  });
});
