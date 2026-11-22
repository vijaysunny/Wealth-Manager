/** Phase 13 B3: what you owe on a card, the cycle and the bill (design figures, 12-credit-card.png). */
import {
  normalizeCard,
  isCardSetUp,
  cardDelta,
  isCardPayment,
  latestAvailableOf,
  cardOwed,
  cycleWindow,
  lastStatementDate,
  dueDateFor,
  cycleSpend,
  currentBill,
  owedParts,
  cardEmisIn,
  nextDueDate,
  latestStatement,
} from '../utils/CardMath';

const at = (m, d, h = 12) => new Date(2026, m - 1, d, h).toISOString();
const ymd = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];
const NOW = new Date(2026, 10, 22, 12);

const card = {
  id: 'ac',
  type: 'Credit Card',
  name: 'Axis Bank Credit Card ••9070',
  last4: '9070',
  creditLimit: 300000,
  statementDay: 15,
  due: { mode: 'afterStatement', days: 20 },
  statements: [{ date: at(11, 15, 0), totalDue: 3914, minDue: 200, source: 'manual' }],
  balance: -4857.94,
};
const spend = (id, m, d, amount, extra = {}) => ({
  id,
  type: 'expense',
  amount,
  accountId: 'ac',
  fullDate: at(m, d),
  ...extra,
});

describe('normalizeCard (B2 migration)', () => {
  test('dueDay → fixedDay; safe twice; other accounts untouched', () => {
    const once = normalizeCard({ type: 'Credit Card', dueDay: 5 });
    expect(once.due).toEqual({ mode: 'fixedDay', day: 5 });
    expect(normalizeCard(once)).toBe(once);
    expect(normalizeCard({ type: 'Credit Card' })).toEqual({ type: 'Credit Card' });
    const bank = { type: 'Bank Account', dueDay: 5 };
    expect(normalizeCard(bank)).toBe(bank);
    expect(normalizeCard(null)).toBeNull();
    expect(isCardSetUp(card)).toBe(true);
    expect(isCardSetUp({})).toBe(false);
  });
});

describe('cardDelta / isCardPayment', () => {
  test('spend +, refund −, payment in −, card → wallet +, one-sided flows, others 0', () => {
    expect(cardDelta(spend('a', 11, 1, 100), 'ac')).toBe(100);
    expect(cardDelta({ type: 'income', amount: 40, accountId: 'ac' }, 'ac')).toBe(-40);
    expect(cardDelta({ type: 'transfer', amount: 500, accountId: 'axis', toAccountId: 'ac' }, 'ac')).toBe(
      -500
    );
    expect(cardDelta({ type: 'transfer', amount: 70, accountId: 'ac', toAccountId: 'lite' }, 'ac')).toBe(70);
    expect(cardDelta({ type: 'transfer', amount: 90, accountId: 'ac', flow: 'in' }, 'ac')).toBe(-90);
    expect(cardDelta({ type: 'transfer', amount: 90, accountId: 'ac', flow: 'out' }, 'ac')).toBe(90);
    expect(cardDelta({ type: 'transfer', amount: 90, accountId: 'x', toAccountId: 'y' }, 'ac')).toBe(0);
    expect(cardDelta(spend('b', 11, 1, 100), 'other')).toBe(0);
    expect(cardDelta({ type: 'income', amount: 1, accountId: 'x' }, 'ac')).toBe(0);
    expect(cardDelta({ type: 'weird', amount: 1, accountId: 'ac' }, 'ac')).toBe(0);
    expect(
      cardDelta(
        { type: 'transfer', transferKind: 'emi_conversion', amount: 25000, accountId: 'ac', flow: 'in' },
        'ac'
      )
    ).toBe(0);
    expect(cardDelta(null, 'ac')).toBe(0);
    expect(isCardPayment({ type: 'transfer', accountId: 'ac', flow: 'in', amount: 1 }, 'ac')).toBe(true);
    expect(isCardPayment({ type: 'transfer', accountId: 'axis', toAccountId: 'ac' }, 'ac')).toBe(true);
    expect(isCardPayment({ type: 'income', accountId: 'ac' }, 'ac')).toBe(false);
    expect(isCardPayment(null, 'ac')).toBe(false);
  });
});

describe('cardOwed', () => {
  const sms = spend('s17', 11, 17, 30, { availableLimit: 274919.19 });
  test('from limit: 3,00,000 − 2,74,919.19 = 25,080.81', () => {
    const r = cardOwed(card, [sms], NOW);
    expect(r).toMatchObject({ owed: 25080.81, source: 'limit' });
    expect(r.available).toMatchObject({ amount: 274919.19, sourceId: 's17' });
  });
  test('spends after the SMS add, payments and refunds after it subtract; earlier ones are already in', () => {
    const txs = [
      spend('old', 11, 10, 999), // before the SMS: already in the available limit
      sms,
      spend('later', 11, 18, 200),
      { id: 'r', type: 'income', amount: 50, accountId: 'ac', fullDate: at(11, 19) },
      { id: 'p', type: 'transfer', amount: 1000, accountId: 'axis', toAccountId: 'ac', fullDate: at(11, 20) },
      spend('future', 11, 25, 5000), // after asOf
    ];
    expect(cardOwed(card, txs, NOW).owed).toBe(round(25080.81 + 200 - 50 - 1000));
  });
  test('the stored latestAvailable is used when newer than any SMS', () => {
    const c = { ...card, latestAvailable: { amount: 280000, at: at(11, 20), sourceId: 'x' } };
    expect(cardOwed(c, [sms], NOW)).toMatchObject({ owed: 20000, source: 'limit' });
    expect(latestAvailableOf(c, [], new Date(2026, 10, 19))).toBeNull(); // stored one is after asOf
  });
  test('statement fallback when the limit is unknown: total due + moves after the statement day', () => {
    const c = { ...card, creditLimit: undefined };
    const txs = [
      spend('on15', 11, 15, 10),
      spend('a', 11, 18, 100),
      { id: 'p', type: 'transfer', amount: 14, accountId: 'axis', toAccountId: 'ac', fullDate: at(11, 19) },
    ];
    expect(cardOwed(c, txs, NOW)).toMatchObject({ owed: 4000, source: 'statement' });
  });
  test('history fallback: the stored balance, negative when it only saw payments', () => {
    const c = { ...card, creditLimit: 0, statements: [] };
    expect(cardOwed(c, [sms], NOW)).toMatchObject({ owed: -4857.94, source: 'history' });
    expect(cardOwed({ id: 'z', type: 'Credit Card' }, [], NOW).owed).toBe(0);
  });
  test('no available limit in any SMS → falls through to statement', () => {
    expect(cardOwed(card, [spend('a', 11, 18, 100)], NOW).source).toBe('statement');
    expect(
      latestAvailableOf(card, [spend('a', 11, 18, 100, { availableLimit: 1 })], new Date(2026, 10, 1))
    ).toBeNull();
  });
});
const round = (n) => Math.round(n * 100) / 100;

describe('cycleWindow', () => {
  test('statement day 15, on 22 Nov → 16 Nov – 15 Dec', () => {
    const w = cycleWindow(15, NOW);
    expect(ymd(w.start)).toEqual([2026, 11, 16]);
    expect(ymd(w.end)).toEqual([2026, 12, 15]);
    expect(w.end.getHours()).toBe(23);
  });
  test('on the statement day itself the cycle ends today', () => {
    const w = cycleWindow(15, new Date(2026, 10, 15, 18));
    expect(ymd(w.start)).toEqual([2026, 10, 16]);
    expect(ymd(w.end)).toEqual([2026, 11, 15]);
  });
  test('day 31 in February ends on the 28th (29th in a leap year); 31 Jan → 1 Feb start', () => {
    const feb = cycleWindow(31, new Date(2027, 1, 10));
    expect(ymd(feb.start)).toEqual([2027, 2, 1]);
    expect(ymd(feb.end)).toEqual([2027, 2, 28]);
    const mar = cycleWindow(31, new Date(2027, 2, 5));
    expect(ymd(mar.start)).toEqual([2027, 3, 1]);
    expect(ymd(mar.end)).toEqual([2027, 3, 31]);
    expect(ymd(cycleWindow(31, new Date(2028, 1, 10)).end)).toEqual([2028, 2, 29]);
    expect(ymd(cycleWindow(30, new Date(2026, 11, 31)).end)).toEqual([2027, 1, 30]);
  });
  test('bad day falls back to 1; lastStatementDate', () => {
    expect(ymd(cycleWindow(undefined, NOW).end)).toEqual([2026, 12, 1]);
    expect(ymd(lastStatementDate(15, NOW))).toEqual([2026, 11, 15]);
    expect(lastStatementDate(null, NOW)).toBeNull();
  });
});

describe('due dates', () => {
  test('20 days after the 15 Nov statement → Sat 5 Dec; fixed day 5 → 5 Dec; old dueDay', () => {
    const st = new Date(2026, 10, 15);
    expect(ymd(dueDateFor(card, st))).toEqual([2026, 12, 5]);
    expect(dueDateFor(card, st).getDay()).toBe(6);
    expect(ymd(dueDateFor({ type: 'Credit Card', due: { mode: 'fixedDay', day: 5 } }, st))).toEqual([
      2026, 12, 5,
    ]);
    expect(ymd(dueDateFor({ type: 'Credit Card', due: { mode: 'fixedDay', day: 20 } }, st))).toEqual([
      2026, 11, 20,
    ]);
    expect(ymd(dueDateFor({ type: 'Credit Card', dueDay: 2 }, st))).toEqual([2026, 12, 2]);
    expect(ymd(dueDateFor({ type: 'Credit Card' }, st))).toEqual([2026, 12, 5]);
    expect(ymd(dueDateFor(null, st))).toEqual([2026, 12, 5]);
  });
  test('nextDueDate: the open bill, else the next one', () => {
    expect(ymd(nextDueDate(card, NOW))).toEqual([2026, 12, 5]);
    expect(ymd(nextDueDate(card, new Date(2026, 11, 8)))).toEqual([2027, 1, 4]);
    expect(nextDueDate({ type: 'Credit Card' }, NOW)).toBeNull();
  });
});

describe('cycleSpend', () => {
  const phoneEmi = {
    id: 'emi1',
    type: 'Loan',
    loanKind: 'cardEmi',
    onCardId: 'ac',
    name: 'Phone EMI',
    emiAmount: 2256.46,
    tenure: 12,
    firstEmiDate: new Date(2026, 8, 15, 12).toISOString(),
    includedInCard: true,
  };
  test('spends in the window, a refund, EMI lines; emi_conversion and other cards ignored', () => {
    const txs = [
      spend('before', 11, 15, 322),
      spend('a', 11, 16, 2000),
      spend('b', 11, 17, 71.89),
      { id: 'r', type: 'income', amount: 25, accountId: 'ac', fullDate: at(11, 18) },
      {
        id: 'c',
        type: 'transfer',
        transferKind: 'emi_conversion',
        amount: 25000,
        accountId: 'ac',
        flow: 'in',
        fullDate: at(11, 18),
      },
      spend('other', 11, 18, 5, { accountId: 'sbi' }),
      null,
    ];
    const r = cycleSpend(card, txs, NOW, [
      phoneEmi,
      { ...phoneEmi, id: 'closed', status: 'closed' },
      { ...phoneEmi, id: 'x', onCardId: 'sbi' },
    ]);
    expect(r).toMatchObject({ spent: 2071.89, refunds: 25, count: 2, emiDue: 2256.46 });
    expect(r.emis).toHaveLength(1);
    expect(r.emis[0]).toMatchObject({ name: 'Phone EMI', amount: 2256.46 });
    expect(ymd(r.emis[0].date)).toEqual([2026, 12, 15]);
    expect(cycleSpend(card, [], NOW).emiDue).toBe(0);
  });
  test('an EMI that has finished adds nothing', () => {
    const done = { ...phoneEmi, tenure: 2 };
    expect(cardEmisIn(card, [done], new Date(2026, 10, 16), new Date(2026, 11, 15, 23))).toEqual([]);
    expect(cardEmisIn(card, undefined, new Date(), new Date())).toEqual([]);
  });
});

describe('currentBill', () => {
  const pay = (id, d, amount) => ({
    id,
    type: 'transfer',
    transferKind: 'cc_payment',
    amount,
    accountId: 'axis',
    toAccountId: 'ac',
    fullDate: at(11, d),
  });
  test('unpaid: Due in 13 days on 22 Nov', () => {
    const b = currentBill(card, [], NOW);
    expect(b).toMatchObject({ paid: 0, left: 3914, daysLeft: 13, status: 'due' });
    expect(ymd(b.dueDate)).toEqual([2026, 12, 5]);
  });
  test('partial payment, then full payment; payments before the statement do not count', () => {
    expect(currentBill(card, [pay('old', 14, 3914), pay('p1', 20, 1000)], NOW)).toMatchObject({
      paid: 1000,
      left: 2914,
      status: 'due',
    });
    expect(currentBill(card, [pay('p1', 20, 1000), pay('p2', 21, 3000)], NOW)).toMatchObject({
      paid: 4000,
      left: 0,
      status: 'paid',
    });
  });
  test('overdue after the due date; a stored dueDate wins; no statement → null', () => {
    expect(currentBill(card, [], new Date(2026, 11, 7))).toMatchObject({ status: 'overdue', daysLeft: -2 });
    const c = {
      ...card,
      statements: [{ date: at(11, 15, 0), totalDue: 100, dueDate: at(12, 1, 0), paid: 40 }],
    };
    expect(currentBill(c, [], NOW)).toMatchObject({ left: 60, daysLeft: 9 });
    expect(currentBill({ ...card, statements: [] }, [], NOW)).toBeNull();
    expect(currentBill({ ...card, statements: undefined }, [], NOW)).toBeNull();
  });
  test('latestStatement picks the newest on or before asOf', () => {
    const c = {
      ...card,
      statements: [
        { date: at(10, 15, 0), totalDue: 1 },
        { date: at(11, 15, 0), totalDue: 2 },
        { date: at(12, 15, 0), totalDue: 3 },
        { date: 'bad' },
        null,
      ],
    };
    expect(latestStatement(c, NOW).totalDue).toBe(2);
  });
});

describe('owedParts', () => {
  test('billed + this cycle + EMIs & older = owed (design: 3,914 + 2,071.89 + 19,094.92 = 25,080.81)', () => {
    const txs = [spend('a', 11, 16, 2041.89), spend('s17', 11, 17, 30, { availableLimit: 274919.19 })];
    const parts = owedParts(card, txs, NOW);
    expect(parts).toEqual({ billed: 3914, thisCycle: 2071.89, other: 19094.92 });
    expect(round(parts.billed + parts.thisCycle + parts.other)).toBe(25080.81);
  });
  test('only for the limit method; no bill → billed 0', () => {
    expect(owedParts({ ...card, creditLimit: 0 }, [], NOW)).toBeNull();
    const txs = [spend('s17', 11, 17, 30, { availableLimit: 274919.19 })];
    expect(owedParts({ ...card, statements: [] }, txs, NOW)).toEqual({
      billed: 0,
      thisCycle: 30,
      other: 25050.81,
    });
  });
});

describe('defaults and odd input', () => {
  test('functions work with today as asOf and missing lists', () => {
    const c = { ...card, statements: [{ date: new Date(2000, 0, 15).toISOString(), totalDue: 5 }] };
    expect(cardOwed(c).source).toBe('statement');
    expect(cardOwed({ ...c, creditLimit: 0 }, undefined).source).toBe('statement');
    expect(cycleWindow(15).end).toBeInstanceOf(Date);
    expect(lastStatementDate(15)).toBeInstanceOf(Date);
    expect(cycleSpend({ ...c, statementDay: undefined }, undefined).count).toBe(0);
    expect(cycleSpend(c).spent).toBe(0);
    expect(currentBill(c, undefined).statement.totalDue).toBe(5);
    expect(currentBill(c).left).toBe(5);
    expect(owedParts(c)).toBeNull();
    expect(nextDueDate(c)).toBeInstanceOf(Date);
    expect(latestAvailableOf(c)).toBeNull();
    expect(latestStatement(c).totalDue).toBe(5);
    expect(cardEmisIn(c, [null], new Date(), new Date())).toEqual([]);
  });
  test('two SMS with limits: the newest wins; the SMS row itself is not counted twice', () => {
    const txs = [
      spend('s2', 11, 18, 100, { availableLimit: 274819.19 }),
      spend('s1', 11, 17, 30, { availableLimit: 274919.19 }),
    ];
    expect(cardOwed(card, txs, NOW).owed).toBe(25180.81);
  });
  test('a one-sided card transfer with toAccountId null and flow out is not a payment', () => {
    expect(isCardPayment({ type: 'transfer', accountId: 'ac', toAccountId: null, flow: 'out' }, 'ac')).toBe(
      false
    );
    expect(isCardPayment({ type: 'transfer', accountId: 'ac', toAccountId: 'lite', flow: 'in' }, 'ac')).toBe(
      false
    );
    expect(
      isCardPayment({ type: 'transfer', transferKind: 'emi_conversion', accountId: 'ac', flow: 'in' }, 'ac')
    ).toBe(false);
  });
  test('bad due rules fall back to sane values', () => {
    const st = new Date(2026, 10, 15);
    expect(ymd(dueDateFor({ type: 'Credit Card', due: { mode: 'fixedDay', day: 'x' } }, st))).toEqual([
      2026, 12, 1,
    ]);
    expect(ymd(dueDateFor({ type: 'Credit Card', due: { mode: 'afterStatement', days: 0 } }, st))).toEqual([
      2026, 12, 5,
    ]);
  });
});
