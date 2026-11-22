/** Phase 13 B4–B6: words for card rows, card detail and setup. */
import {
  shortDate,
  weekdayDate,
  owedSourceLine,
  overpaidLine,
  billBadge,
  cardRowText,
  cycleTag,
  setupOwedBox,
} from '../utils/CardView';
import { billReminderDate } from '../utils/CardReminders';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const at = (m, d, h = 12) => new Date(2026, m - 1, d, h).toISOString();
const NOW = new Date(2026, 10, 22, 12);
const card = {
  id: 'ac',
  type: 'Credit Card',
  creditLimit: 300000,
  statementDay: 15,
  due: { mode: 'afterStatement', days: 20 },
  statements: [{ date: at(11, 15, 0), totalDue: 3914, minDue: 200 }],
  balance: -4857.94,
};
const sms = {
  id: 's',
  type: 'expense',
  amount: 30,
  accountId: 'ac',
  fullDate: at(11, 17),
  availableLimit: 274919.19,
};

test('dates', () => {
  expect(shortDate(new Date(2026, 10, 15))).toBe('15 Nov');
  expect(weekdayDate(new Date(2026, 11, 5))).toBe('Sat, 5 Dec');
});

test('source line for each method; overpaid line only for a negative history estimate', () => {
  expect(owedSourceLine(card, { source: 'limit', available: { amount: 274919.19, at: at(11, 17) } })).toBe(
    'Limit ₹3,00,000 − available ₹2,74,919.19 (SMS, 17 Nov)'
  );
  expect(owedSourceLine(card, { source: 'statement', statement: { date: at(11, 15) } })).toBe(
    'From bill of 15 Nov'
  );
  expect(owedSourceLine(card, { source: 'history' })).toBe('Estimate from SMS history');
  expect(owedSourceLine(card, null)).toBe('');
  expect(overpaidLine({ source: 'history', owed: -4857.94 })).toBe(
    'Looks overpaid by ₹4,857.94. Set up the card to fix'
  );
  expect(overpaidLine({ source: 'history', owed: 5 })).toBeNull();
  expect(overpaidLine({ source: 'limit', owed: -5 })).toBeNull();
});

test('bill badge', () => {
  expect(billBadge(null)).toBeNull();
  expect(billBadge({ status: 'paid' })).toEqual({ label: 'Paid', tone: 'income' });
  expect(billBadge({ status: 'overdue' })).toEqual({ label: 'Overdue', tone: 'danger' });
  expect(billBadge({ status: 'due', daysLeft: 0 })).toEqual({ label: 'Due today', tone: 'warn' });
  expect(billBadge({ status: 'due', daysLeft: 1 }).label).toBe('Due in 1 day');
  expect(billBadge({ status: 'due', daysLeft: 13 }).label).toBe('Due in 13 days');
});

test('card row: set up → cycle, pay and owed; warn within 5 days; overdue; paid → no pay part', () => {
  const r = cardRowText(card, [sms], NOW);
  expect(r).toMatchObject({ setUp: true, cycle: 'This cycle ₹30', owed: 25080.81, source: 'limit' });
  expect(r.pay).toEqual({ text: 'Pay ₹3,914 by 5 Dec', warn: false, danger: false });
  expect(cardRowText(card, [sms], new Date(2026, 11, 1)).pay.warn).toBe(true);
  expect(cardRowText(card, [sms], new Date(2026, 11, 8)).pay).toEqual({
    text: 'Overdue ₹3,914',
    warn: true,
    danger: true,
  });
  const paid = {
    id: 'p',
    type: 'transfer',
    amount: 3914,
    accountId: 'axis',
    toAccountId: 'ac',
    fullDate: at(11, 20),
  };
  expect(cardRowText(card, [sms, paid], NOW).pay).toBeNull();
  expect(cardRowText({ ...card, statementDay: undefined }, [sms], NOW).cycle).toBe('');
});

test('card row: not set up → available limit, or a plain hint', () => {
  expect(cardRowText({ ...card, creditLimit: 0 }, [sms], NOW)).toEqual({
    setUp: false,
    sub: 'Available ₹2,74,919.19 · add limit',
  });
  expect(cardRowText({ id: 'x', type: 'Credit Card' }, [], NOW)).toEqual({
    setUp: false,
    sub: 'Add limit to see what you owe',
  });
});

test('cycle tag: this cycle vs on bill of <date>', () => {
  expect(cycleTag(card, { fullDate: at(11, 17) }, NOW)).toBe('this cycle');
  expect(cycleTag(card, { fullDate: at(11, 15) }, NOW)).toBe('on bill of 15 Nov');
  expect(cycleTag(card, { fullDate: at(10, 2) }, NOW)).toBe('on bill of 15 Oct');
  expect(cycleTag({ ...card, statementDay: null }, { fullDate: at(11, 17) }, NOW)).toBeNull();
  expect(cycleTag(card, null, NOW)).toBeNull();
});

test('setup box: limit − available; explains a history balance in credit; positive mismatch; no SMS', () => {
  const box = setupOwedBox(card, 300000, [sms], NOW);
  expect(box.owed).toBe(25080.81);
  expect(box.available.amount).toBe(274919.19);
  expect(box.note).toBe(
    'The app currently shows this card as ₹4,857.94 in credit, because it only saw your payments, not the older spends they paid for. Saving fixes it.'
  );
  expect(setupOwedBox({ ...card, balance: 100 }, 300000, [sms], NOW).note).toBe(
    'The app currently shows ₹100 owed, added up from SMS it saw. Saving sets it to ₹25,080.81.'
  );
  expect(setupOwedBox({ ...card, balance: 25080.5 }, 300000, [sms], NOW).note).toBeNull();
  expect(setupOwedBox(card, null, [sms], NOW)).toMatchObject({ owed: null, note: null });
  expect(setupOwedBox(card, 300000, [], NOW)).toEqual({ available: null, owed: null, note: null });
  expect(setupOwedBox({ ...card, balance: undefined }, 300000, [sms], NOW).note).toMatch(/shows ₹0 owed/);
});

test('bill reminder: 3 days before at 9 am, only while something is left', () => {
  const d = billReminderDate({ left: 10, dueDate: new Date(2026, 11, 5) }, NOW);
  expect([d.getDate(), d.getMonth(), d.getHours()]).toEqual([2, 11, 9]);
  expect(billReminderDate({ left: 0, dueDate: new Date(2026, 11, 5) }, NOW)).toBeNull();
  expect(billReminderDate({ left: 10, dueDate: new Date(2026, 10, 23) }, NOW)).toBeNull();
  expect(billReminderDate(null, NOW)).toBeNull();
});
