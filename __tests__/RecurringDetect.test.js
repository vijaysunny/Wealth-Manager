import { detect, seriesOf, addMonths, nextAfter, billFromSeries } from '../utils/RecurringDetect';
import {
  parseMandate,
  mergeMandate,
  mandateMatches,
  mandateKey,
  smsDate,
  isPausedNow,
} from '../utils/Mandates';

const fs = require('fs');
const path = require('path');
const owner = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '__fixtures__', 'sms', 'owner_real_samples.json'), 'utf8')
);
const body = (id) => owner.messages.find((m) => m.id === id).body;

const d = (y, m, day) => new Date(y, m - 1, day, 10).toISOString();
const debit = (id, date, amount, over = {}) => ({
  id,
  type: 'expense',
  amount,
  merchant: 'Google',
  category: 'Subscriptions',
  accountId: 'axis',
  fullDate: date,
  ...over,
});
const asOf = new Date(2026, 10, 26, 12);
const ymd = (iso) => {
  const x = new Date(iso);
  return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;
};

test('monthly: three debits with a jittered day; next = the usual day next month; the last amount', () => {
  const txs = [
    debit(1, d(2026, 8, 18), 1998.19),
    debit(2, d(2026, 9, 20), 1998.19),
    debit(3, d(2026, 10, 17), 1998.19),
    debit(4, d(2026, 11, 18), 2050),
  ];
  const [s] = detect(txs, { asOf });
  expect(s).toMatchObject({
    key: 'google',
    name: 'Google',
    cadence: 'monthly',
    count: 4,
    amount: 2050,
    accountId: 'axis',
    anchorDay: 18,
    txIds: [1, 2, 3, 4],
  });
  expect(ymd(s.nextDate)).toBe('2026-12-18');
  expect(s.confidence).toBeGreaterThan(0.6);
});

test('weekly and yearly', () => {
  const weekly = [0, 7, 13, 20].map((n, i) =>
    debit(i, new Date(2026, 10, 1 + n, 9).toISOString(), 200, { merchant: 'Milk' })
  );
  const [w] = detect(weekly, { asOf });
  expect(w.cadence).toBe('weekly');
  expect(ymd(w.nextDate)).toBe('2026-11-28');
  const yearly = [2024, 2025, 2026].map((y, i) => debit(i, d(y, 3, 10), 1499, { merchant: 'Prime' }));
  const [y] = detect(yearly, { asOf });
  expect(y.cadence).toBe('yearly');
  expect(ymd(y.nextDate)).toBe('2027-3-10');
});

test('amounts: ±10 % drift is fine, 20 % is not; EMIs must be exact', () => {
  const at = [d(2026, 8, 5), d(2026, 9, 5), d(2026, 10, 5)];
  expect(
    detect(
      at.map((x, i) => debit(i, x, [100, 108, 95][i])),
      { asOf }
    )
  ).toHaveLength(1);
  expect(
    detect(
      at.map((x, i) => debit(i, x, [100, 120, 100][i])),
      { asOf }
    )
  ).toEqual([]);
  const emi = (a) => at.map((x, i) => debit(i, x, a[i], { merchant: 'Bajaj', category: 'EMI' }));
  expect(detect(emi([538, 538, 538]), { asOf })).toHaveLength(1);
  expect(detect(emi([538, 539, 538]), { asOf })).toEqual([]);
});

test('two debits are not enough without an autopay mandate', () => {
  const two = [
    debit(1, d(2026, 9, 4), 399, { merchant: 'OpenAI LLC' }),
    debit(2, d(2026, 10, 4), 399, { merchant: 'OpenAI LLC' }),
  ];
  expect(detect(two, { asOf })).toEqual([]);
  const mandate = { key: 'openai', payee: 'OpenAI LLC', status: 'active', amount: 399 };
  expect(detect(two, { asOf, mandates: [mandate] })[0]).toMatchObject({ cadence: 'monthly', mandated: true });
  expect(detect(two, { asOf, mandates: [{ ...mandate, status: 'cancelled' }] })).toEqual([]);
});

test('a dismissed payee stays dismissed; skipped keys and irregular gaps are left out', () => {
  const txs = [debit(1, d(2026, 8, 18), 10), debit(2, d(2026, 9, 18), 10), debit(3, d(2026, 10, 18), 10)];
  expect(detect(txs, { asOf, dismissed: ['google'] })).toEqual([]);
  expect(detect(txs, { asOf, skip: ['google'] })).toEqual([]);
  expect(
    detect([debit(1, d(2026, 8, 1), 10), debit(2, d(2026, 8, 20), 10), debit(3, d(2026, 10, 18), 10)], {
      asOf,
    })
  ).toEqual([]);
});

test('month-end dates: 31st → 30th / 28th, and the next one goes back to the 31st', () => {
  const txs = [
    debit(1, d(2026, 1, 31), 99),
    debit(2, d(2026, 2, 28), 99),
    debit(3, d(2026, 3, 31), 99),
    debit(4, d(2026, 4, 30), 99),
  ];
  const [s] = detect(txs, { asOf: new Date(2026, 4, 1) });
  expect(s.anchorDay).toBe(31);
  expect(ymd(s.nextDate)).toBe('2026-5-31');
  expect(ymd(addMonths(new Date(2026, 0, 31), 1).toISOString())).toBe('2026-2-28');
  expect(ymd(addMonths(new Date(2026, 3, 30), 1, 31).toISOString())).toBe('2026-5-31');
  expect(ymd(addMonths(new Date(2026, 10, 30), 2, 31).toISOString())).toBe('2027-1-31');
});

test('a series that stopped long ago is not suggested; loan, refund and paid-for-others rows never count', () => {
  const old = [debit(1, d(2026, 1, 5), 10), debit(2, d(2026, 2, 5), 10), debit(3, d(2026, 3, 5), 10)];
  expect(detect(old, { asOf })).toEqual([]);
  const at = [d(2026, 8, 5), d(2026, 9, 5), d(2026, 10, 5)];
  for (const over of [
    { loanLink: { loanId: 'x' } },
    { refundOf: 'x' },
    { splits: [{ personId: 'p', amount: 10 }] },
    { type: 'income' },
    { deleted: true },
  ])
    expect(
      detect(
        at.map((x, i) => debit(i, x, 10, over)),
        { asOf }
      )
    ).toEqual([]);
  expect(
    detect(
      at.map((x, i) => debit(i, x, 10, { merchant: null, title: null, category: null })),
      { asOf }
    )
  ).toEqual([]);
  expect(detect(undefined)).toEqual([]);
  expect(detect([null])).toEqual([]);
});

test('seriesOf edge cases and nextAfter', () => {
  expect(
    seriesOf('k', [debit(1, d(2026, 8, 5), 0), debit(2, d(2026, 9, 5), 0), debit(3, d(2026, 10, 5), 0)])
  ).toBeNull();
  expect(ymd(nextAfter(new Date(2026, 0, 1), 'weekly').toISOString())).toBe('2026-1-8');
  expect(ymd(nextAfter(new Date(2026, 0, 1), 'monthly').toISOString())).toBe('2026-2-1');
  // even count → median of the middle two
  const four = [0, 7, 14, 22].map((n, i) =>
    debit(i, new Date(2026, 10, 1 + n, 9).toISOString(), [10, 10, 11, 11][i])
  );
  expect(seriesOf('g', four).stepDays).toBe(7);
});

test('billFromSeries', () => {
  const [s] = detect(
    [debit(1, d(2026, 8, 18), 5), debit(2, d(2026, 9, 18), 5), debit(3, d(2026, 10, 18), 5)],
    { asOf }
  );
  expect(billFromSeries(s, 7)).toMatchObject({
    id: 'bill_7',
    key: 'google',
    name: 'Google',
    amount: 5,
    cadence: 'monthly',
    source: 'detected',
    count: 3,
    reminder: false,
  });
});

describe('Mandates', () => {
  test("the owner's OpenAI paused SMS", () => {
    const m = parseMandate(body('axis-autopay-paused-01'), new Date(2026, 10, 4, 9));
    expect(m).toMatchObject({ key: 'openai', payee: 'OpenAI LLC', amount: 399, status: 'paused' });
    expect(ymd(m.pausedFrom)).toBe('2026-11-4');
    expect(ymd(m.pausedUntil)).toBe('2026-12-31');
    expect(isPausedNow(m, asOf)).toBe(true);
    expect(isPausedNow(m, new Date(2027, 0, 2))).toBe(false);
    expect(isPausedNow({ status: 'paused' })).toBe(true);
    expect(isPausedNow(null)).toBe(false);
  });
  test('set up and cancelled (UNVERIFIED-SAMPLE wordings); a debit is not a mandate message', () => {
    expect(
      parseMandate('UPI AutoPay mandate created successfully for Netflix with amount Rs.649')
    ).toMatchObject({ key: 'netflix', amount: 649, status: 'active' });
    expect(parseMandate('Your e-mandate towards Spotify India for INR 119 has been cancelled')).toMatchObject(
      { key: 'spotify', status: 'cancelled' }
    );
    expect(parseMandate('Your mandate towards Zee5 with INR 99 is pending')).toBeNull();
    expect(parseMandate(body('axis-autopay-google-01'))).toBeNull();
    expect(parseMandate('mandate cancelled')).toBeNull();
    expect(parseMandate(undefined)).toBeNull();
    expect(parseMandate('Autopay mandate towards X Co is paused').amount).toBeNull();
  });
  test('merge keeps the newest per payee; matching names', () => {
    const a = { key: 'openai', payee: 'OpenAI LLC', status: 'active', date: '2026-10-01' };
    const b = { key: 'openai', payee: 'OpenAI LLC', status: 'paused', date: '2026-11-04' };
    expect(mergeMandate([a], b)).toEqual([b]);
    expect(mergeMandate([b], a)).toEqual([b]);
    expect(mergeMandate([a], null)).toEqual([a]);
    expect(mergeMandate(undefined, a)).toEqual([a]);
    expect(mandateMatches(a, 'OPENAI *CHATGPT SUBSCR')).toBe(true);
    expect(mandateMatches(a, 'Open Market')).toBe(false);
    expect(mandateMatches({ payee: '' }, 'x')).toBe(false);
    expect(mandateKey('Google India Pvt. Ltd.')).toBe('google');
  });
  test('smsDate', () => {
    expect(ymd(smsDate('31/12/2026').toISOString())).toBe('2026-12-31');
    expect(smsDate('31-02-26')).toBeNull();
    expect(smsDate('soon')).toBeNull();
    expect(smsDate()).toBeNull();
  });
});
