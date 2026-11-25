import {
  refundWords,
  isRefundLike,
  markRefundCandidates,
  refundedAmount,
  candidates,
  refundCategoryOf,
  linkChanges,
  UNLINK_CHANGES,
} from '../utils/RefundMatch';
import { monthSpend, monthIncome } from '../utils/Report';

const d = (m, day) => new Date(2026, m - 1, day, 12).toISOString();
const buy = (id, over) => ({
  id,
  type: 'expense',
  amount: 1499,
  merchant: 'Amazon',
  category: 'Shopping',
  accountId: 'card',
  fullDate: d(11, 10),
  ...over,
});
const refund = {
  id: 'r',
  type: 'income',
  amount: 1499,
  merchant: 'Amazon',
  accountId: 'card',
  accountType: 'Credit Card',
  category: 'Refund',
  fullDate: d(11, 23),
};

test('refund words; cashback is never a refund', () => {
  expect(refundWords('Refund of Rs 1499 credited')).toBe(true);
  expect(refundWords('txn REVERSED')).toBe(true);
  expect(refundWords('Cashback of Rs 50 credited as refund')).toBe(false);
  expect(refundWords(undefined)).toBe(false);
  expect(isRefundLike({ type: 'income', refundWords: true, category: 'Cashback' })).toBe(false);
  expect(isRefundLike({ type: 'income', refundWords: true, merchant: 'Cashback offer' })).toBe(false);
  expect(isRefundLike({ type: 'income', refundWords: true })).toBe(true);
  expect(isRefundLike({ type: 'expense', refundWords: true })).toBe(false);
  expect(isRefundLike({ type: 'income', refundWords: true, refundDismissed: true })).toBe(false);
  expect(isRefundLike(null)).toBe(false);
});

test('a card credit from a merchant paid before is a candidate; others are not', () => {
  expect(isRefundLike(refund, [buy('a')])).toBe(true);
  expect(isRefundLike(refund, [buy('a', { merchant: 'Flipkart' })])).toBe(false);
  expect(isRefundLike({ ...refund, accountType: 'Bank Account' }, [buy('a')])).toBe(false);
  expect(isRefundLike({ ...refund, merchant: null, title: null, category: null }, [buy('a')])).toBe(false);
  expect(
    markRefundCandidates([refund, { ...refund, id: 'x', accountType: 'Wallet' }], [buy('a')]).map(
      (t) => !!t.refundCandidate
    )
  ).toEqual([true, false]);
  expect(markRefundCandidates(undefined)).toEqual([]);
});

test('candidate ordering: exact+card+payee, then payee, then card', () => {
  const txs = [
    buy('cardOnly', { merchant: 'Other shop', amount: 2000, fullDate: d(11, 20) }),
    buy('payeeOnly', { accountId: 'bank', amount: 3000, fullDate: d(11, 15) }),
    buy('best'),
    buy('split', {
      amount: 2840,
      fullDate: d(11, 12),
      splits: [
        { id: 1, amount: 1240, category: 'Groceries' },
        { id: 2, amount: 1600, category: 'Electronics' },
      ],
    }),
  ];
  const c = candidates(refund, txs);
  expect(c.map((x) => x.tx.id)).toEqual(['best', 'split', 'payeeOnly', 'cardOnly']);
  expect(c[0]).toMatchObject({
    best: true,
    partRefund: false,
    reasons: ['same amount', 'same card', 'same payee'],
  });
  expect(c[1]).toMatchObject({ best: false, partRefund: true });
  expect(candidates(null, txs)).toEqual([]);
});

test('the 120-day window and only purchases before the refund', () => {
  const txs = [
    buy('old', { fullDate: new Date(2026, 6, 20, 12).toISOString() }),
    buy('in', { fullDate: new Date(2026, 6, 27, 12).toISOString() }),
    buy('after', { fullDate: d(11, 24) }),
    { ...refund, id: 'inc' },
  ];
  expect(candidates(refund, txs).map((c) => c.tx.id)).toEqual(['in']);
});

test('partial refunds cannot exceed the original', () => {
  const p = buy('p', { amount: 1000 });
  const r1 = { ...refund, id: 'r1', amount: 600, refundOf: 'p' };
  const r2 = { ...refund, id: 'r2', amount: 500 };
  expect(refundedAmount('p', [p, r1])).toBe(600);
  expect(candidates(r2, [p, r1])).toEqual([]);
  expect(() => linkChanges(r2, p, [p, r1])).toThrow(/Only 400/);
  const r3 = { ...r2, amount: 400 };
  expect(candidates(r3, [p, r1])[0].left).toBe(400);
  expect(linkChanges(r3, p, [p, r1])).toEqual({
    refundOf: 'p',
    refundCategory: 'Shopping',
    refundDate: p.fullDate,
    refundCandidate: false,
  });
});

test('a split original: the refund lowers its biggest category', () => {
  const s = buy('s', {
    amount: 2840,
    splits: [
      { amount: 1240, category: 'Groceries' },
      { amount: 500, personId: 'ravi' },
      { amount: 1100, category: 'Electronics' },
    ],
  });
  expect(refundCategoryOf(s)).toBe('Groceries');
  expect(refundCategoryOf({ splits: [{ amount: 1, personId: 'x' }], category: 'X' })).toBe('X');
  expect(refundCategoryOf({ splits: [{ amount: 1, personId: 'x' }] })).toBe('Other');
  expect(refundCategoryOf({})).toBe('Other');
});

test('report totals: the original month goes down; income does not go up; unlink restores', () => {
  const p = buy('p', { fullDate: d(10, 28) });
  const linked = { ...refund, ...linkChanges(refund, p, [p]) };
  const oct = new Date(2026, 9, 1);
  const nov = new Date(2026, 10, 1);
  expect(monthSpend([p, linked], oct)).toEqual({ total: 0, byCategory: { Shopping: 0 } });
  expect(monthIncome([p, linked], nov)).toBe(0);
  const unlinked = { ...linked, ...UNLINK_CHANGES };
  expect(monthSpend([p, unlinked], oct).total).toBe(1499);
  expect(monthIncome([p, unlinked], nov)).toBe(1499);
});

test('cashback is never a candidate', () => {
  expect(isRefundLike({ ...refund, category: 'Cashback' }, [buy('a')])).toBe(false);
});
