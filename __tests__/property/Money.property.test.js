/**
 * C3 property tests: invariants of the money/balance logic over random inputs.
 * Fixed seed so a CI failure is reproducible; bump numRuns locally when hunting.
 */
import fc from 'fast-check';
import { applyToAccounts, reverseOnAccounts, computeNetWorth } from '../../utils/BalanceService';
import { computeReconcile } from '../../utils/WalletReconcile';
import { filterNew } from '../../utils/DeduplicationEngine';
import { makeRowIdFactory, parseTransactionText, parseStatementRows } from '../../utils/TransactionParser';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const OPTS = { seed: 20261118, numRuns: 200 };
const paise = fc.integer({ min: 1, max: 10_000_000 }).map((p) => p / 100); // ₹0.01 … ₹1,00,000
const ACCOUNTS = [
  { id: 'bank', name: 'Axis Bank', type: 'Bank Account', balance: 50000 },
  { id: 'eq', name: 'Equitas', type: 'Bank Account', balance: 1000 },
  { id: 'card', name: 'SBI Card', type: 'Credit Card', balance: 3000 },
  { id: 'cash', name: 'Cash', type: 'Cash', balance: 200 },
  { id: 'lite', name: 'UPI Lite', type: 'Wallet', subType: 'UPI Lite', balance: 0 },
];
const ids = ACCOUNTS.map((a) => a.id);
const txArb = fc.record({
  amount: paise,
  type: fc.constantFrom('expense', 'income'),
  accountId: fc.constantFrom(...ids),
});
const transferArb = fc
  .record({ amount: paise, from: fc.constantFrom(...ids), to: fc.constantFrom(...ids) })
  .filter((t) => t.from !== t.to)
  .map((t) => ({ type: 'transfer', amount: t.amount, accountId: t.from, toAccountId: t.to }));
const withIds = (txs) => txs.map((t, i) => ({ id: `t${i}`, ...t }));
const balancesOf = (accs) => Object.fromEntries(accs.map((a) => [a.id, a.balance]));

test('apply all, then reverse all (any order) returns the exact starting balances', () => {
  fc.assert(
    fc.property(
      fc.array(fc.oneof(txArb, transferArb), { maxLength: 40 }),
      fc.boolean(),
      (raw, reverseForward) => {
        const txs = withIds(raw);
        const applied = txs.reduce(applyToAccounts, ACCOUNTS);
        const order = reverseForward ? txs : [...txs].reverse();
        const back = order.reduce(reverseOnAccounts, applied);
        expect(balancesOf(back)).toEqual(balancesOf(ACCOUNTS)); // exact: round2 means no float drift
      }
    ),
    OPTS
  );
});

test('transfers between own accounts never change net worth', () => {
  fc.assert(
    fc.property(fc.array(transferArb, { minLength: 1, maxLength: 30 }), (raw) => {
      const after = withIds(raw).reduce(applyToAccounts, ACCOUNTS);
      expect(computeNetWorth(after).netWorth).toBeCloseTo(computeNetWorth(ACCOUNTS).netWorth, 2);
    }),
    OPTS
  );
});

test('balances always have at most 2 decimals', () => {
  fc.assert(
    fc.property(fc.array(fc.oneof(txArb, transferArb), { maxLength: 40 }), (raw) => {
      for (const a of withIds(raw).reduce(applyToAccounts, ACCOUNTS))
        expect(Math.round(a.balance * 100) / 100).toBe(a.balance);
    }),
    OPTS
  );
});

test('reconcile: tracked − diff = entered, action matches the sign', () => {
  fc.assert(
    fc.property(
      paise,
      fc.integer({ min: 0, max: 10_000_000 }).map((p) => p / 100),
      (tracked, entered) => {
        const { diff, action } = computeReconcile({ type: 'Wallet', balance: tracked }, entered);
        expect(tracked - diff).toBeCloseTo(entered, 2);
        expect(action).toBe(diff > 0 ? 'expense' : diff < 0 ? 'income' : 'none');
      }
    ),
    OPTS
  );
});

test('dedup is idempotent: importing the same rows twice adds nothing the 2nd time', () => {
  const rowArb = fc.record({
    day: fc.integer({ min: 1, max: 28 }),
    amount: paise,
    narration: fc.constantFrom(
      'UPI/P2M/1234/ZOMATO',
      'NEFT SALARY',
      'UPI LITE TOPUP',
      'ATM WDL',
      'IMPS/baja'
    ),
    debit: fc.boolean(),
  });
  fc.assert(
    fc.property(fc.array(rowArb, { maxLength: 25 }), (rows) => {
      const file = [
        ['Tran Date', 'Particulars', 'Debit', 'Credit'],
        ...rows.map((r) => [
          `${String(r.day).padStart(2, '0')}-10-2026`,
          r.narration,
          r.debit ? r.amount.toFixed(2) : '',
          r.debit ? '' : r.amount.toFixed(2),
        ]),
      ];
      const first = parseStatementRows(file, 'Axis Bank');
      const stored = filterNew(first, []);
      expect(filterNew(parseStatementRows(file, 'Axis Bank'), stored)).toEqual([]);
    }),
    OPTS
  );
});

test('row IDs: deterministic and unique within a file, even with identical rows', () => {
  const rowArb = fc.record({
    date: fc.integer({ min: 0, max: 400 }).map((d) => new Date(Date.UTC(2026, 0, 1 + d))),
    amount: fc.constantFrom(10, 20, 99.5),
    refNo: fc.constantFrom('', '123', 'ABC'),
    narration: fc.constantFrom('A', 'B'),
  });
  fc.assert(
    fc.property(fc.array(rowArb, { maxLength: 50 }), (rows) => {
      const a = rows.map(makeRowIdFactory('stmt', 'Axis'));
      const b = rows.map(makeRowIdFactory('stmt', 'Axis'));
      expect(a).toEqual(b);
      expect(new Set(a).size).toBe(a.length);
    }),
    OPTS
  );
});

test('the SMS parser never throws and never returns a negative or non-finite amount', () => {
  const smsish = fc.oneof(
    fc.string({ maxLength: 300 }),
    fc
      .tuple(
        fc.constantFrom('INR', 'Rs.', 'Rs', '₹', ''),
        fc.float({ min: -1e9, max: 1e9, noNaN: true }),
        fc.constantFrom('debited', 'credited', 'spent', 'top-up', 'UPI LITE', 'Avl Bal'),
        fc.string({ maxLength: 60 })
      )
      .map(([cur, n, verb, tail]) => `${cur} ${n} ${verb} A/c XX1234 ${tail}`)
  );
  fc.assert(
    fc.property(smsish, fc.constantFrom('', 'AX-AXISBK-S', 'JD-SBICRD', 'VM-EQUTAS'), (body, sender) => {
      const out = parseTransactionText(body, { sender });
      if (out && out.amount !== undefined) {
        expect(Number.isFinite(out.amount)).toBe(true);
        expect(out.amount).toBeGreaterThan(0);
      }
    }),
    { ...OPTS, numRuns: 500 }
  );
});

test('D1: net worth = assets − liabilities, investments included', () => {
  const TYPES = [
    'Bank Account',
    'Cash',
    'Wallet',
    'Mutual Fund',
    'Investment',
    'Fixed Deposit',
    'Provident Fund',
    'Credit Card',
    'Loan',
  ];
  const LIAB = ['Credit Card', 'Loan'];
  fc.assert(
    fc.property(
      fc.array(fc.record({ type: fc.constantFrom(...TYPES), balance: paise }), { maxLength: 15 }),
      (accs) => {
        const assets = accs
          .filter((a) => !LIAB.includes(a.type))
          .reduce((s, a) => s + Math.round(a.balance * 100), 0);
        const liab = accs
          .filter((a) => LIAB.includes(a.type))
          .reduce((s, a) => s + Math.round(a.balance * 100), 0);
        expect(computeNetWorth(accs).netWorth).toBeCloseTo((assets - liab) / 100, 2);
      }
    )
  );
});
