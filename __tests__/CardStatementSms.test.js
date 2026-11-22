/** Phase 13 B7: card statement SMS (the owner's real Axis and SBI wording) → the card's bill. */
import fs from 'fs';
import path from 'path';
import Storage from '../data/Storage';
import {
  parseCardStatement,
  isLenderEmiReceipt,
  isNonTransactionNotice,
  cardForStatement,
} from '../utils/CardStatementSms';
import { applyStatementSms, loadCard } from '../utils/CardService';
import { currentBill } from '../utils/CardMath';
import { isAiSmsCandidate } from '../utils/ai/AiTasks';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const { messages } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '__fixtures__', 'sms', 'owner_real_samples.json'), 'utf8')
);
const body = (id) => messages.find((m) => m.id === id).body;
const d = (y, m, day) => new Date(y, m - 1, day);

test('Axis statement: total, minimum, due date; no statement date in the SMS', () => {
  expect(parseCardStatement(body('axis-cc-statement-01'))).toEqual({
    bankName: 'Axis Bank',
    lastDigits: '9070',
    totalDue: 14480.89,
    minDue: 336,
    dueDate: d(2026, 8, 21),
    statementDate: null,
  });
  // UNVERIFIED-SAMPLE: a credit balance ("Cr.") is a bill of ₹0
  const cr = body('axis-cc-statement-01').replace('INR  Dr. 14480.89', 'INR  Cr. 120.00');
  expect(parseCardStatement(cr)).toMatchObject({ totalDue: 0, minDue: 0 });
  expect(parseCardStatement(body('axis-cc-statement-01').replace(/Due on:.*\n/, ''))).toBeNull();
});

test('SBI statement: 2 last digits, statement date, payable by', () => {
  expect(parseCardStatement(body('sbi-cc-statement-01'))).toEqual({
    bankName: 'SBI',
    lastDigits: '87',
    totalDue: 16229,
    minDue: 9363,
    dueDate: d(2026, 10, 26),
    statementDate: d(2026, 10, 6),
  });
  expect(parseCardStatement(body('sbi-cc-statement-01').replace(/Payable by [^.]*\./, ''))).toBeNull();
  expect(parseCardStatement('Rs.106.97 spent on your SBI Credit Card ending 1987')).toBeNull();
  expect(parseCardStatement()).toBeNull();
});

test('notices that are not transactions (and not sent to AI)', () => {
  expect(isLenderEmiReceipt(body('bajaj-emi-receipt-01'))).toBe(true);
  expect(isLenderEmiReceipt(body('axis-ach-bajaj-01'))).toBe(false);
  ['axis-cc-statement-01', 'sbi-cc-statement-01', 'bajaj-emi-receipt-01'].forEach((id) => {
    expect(isNonTransactionNotice(body(id))).toBe(true);
    expect(isAiSmsCandidate(body(id))).toBe(false);
  });
  expect(isNonTransactionNotice(body('axis-neft-credit-baja-02'))).toBe(false);
});

const cards = [
  {
    id: 'ac',
    type: 'Credit Card',
    name: 'Axis Bank Credit Card ••9070',
    last4: '9070',
    bankName: 'Axis Bank',
  },
  { id: 'sbi', type: 'Credit Card', name: 'SBI Card ••1987', last4: '1987' },
  { id: 'axis', type: 'Bank Account', name: 'Axis Bank ••0973', last4: '0973' },
];

test('which card: bank + last digits, exactly one', () => {
  expect(cardForStatement(parseCardStatement(body('axis-cc-statement-01')), cards).id).toBe('ac');
  expect(cardForStatement(parseCardStatement(body('sbi-cc-statement-01')), cards).id).toBe('sbi');
  expect(
    cardForStatement(parseCardStatement(body('sbi-cc-statement-01')), [
      ...cards,
      { ...cards[1], id: 'sbi2', last4: '4487' },
    ])
  ).toBeNull();
  expect(cardForStatement(null, cards)).toBeNull();
  expect(cardForStatement(parseCardStatement(body('axis-cc-statement-01')), [])).toBeNull();
});

test('saving: the bill lands on the card once; a hand-entered bill with the same due date is replaced', async () => {
  await Storage.setItem('user_transactions', '[]');
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify(
      [
        ...cards,
        {
          ...cards[0],
          statements: [
            {
              date: d(2026, 8, 1).toISOString(),
              totalDue: 14000,
              dueDate: d(2026, 8, 21).toISOString(),
              source: 'manual',
            },
          ],
        },
      ].slice(1)
    )
  );
  const smsDay = new Date(2026, 7, 1, 11, 43);
  await applyStatementSms(parseCardStatement(body('axis-cc-statement-01')), smsDay);
  await applyStatementSms(parseCardStatement(body('axis-cc-statement-01')), smsDay); // re-scan
  const { card } = await loadCard('ac');
  expect(card.statements).toHaveLength(1);
  expect(card.statements[0]).toMatchObject({ totalDue: 14480.89, minDue: 336, source: 'sms' });
  expect(new Date(card.statements[0].date).getDate()).toBe(1);
  const bill = currentBill({ ...card, creditLimit: 300000 }, [], new Date(2026, 7, 10));
  expect(bill).toMatchObject({ left: 14480.89, status: 'due' });
  await applyStatementSms(parseCardStatement(body('sbi-cc-statement-01')), new Date(2026, 9, 6));
  expect((await loadCard('sbi')).card.statements[0]).toMatchObject({ totalDue: 16229, minDue: 9363 });
  // no matching card: nothing saved
  expect(
    await applyStatementSms({ ...parseCardStatement(body('sbi-cc-statement-01')), lastDigits: '11' })
  ).toBeNull();
});

test('edges: no "Dr." marker, missing minimum, bad dates, defaults, accounts without names', () => {
  const axis = body('axis-cc-statement-01');
  expect(parseCardStatement(axis.replace('INR  Dr. 14480.89', 'INR 14480.89')).totalDue).toBe(14480.89);
  expect(parseCardStatement(axis.replace(/Min amt due:.*\n/, '')).minDue).toBe(0);
  expect(parseCardStatement(axis.replace('21-08-26', '31-02-26')).dueDate).toBeNull();
  const sbi = body('sbi-cc-statement-01');
  expect(parseCardStatement(sbi.replace(/Min Amt Due Rs \d+;/, '')).minDue).toBe(0);
  expect(parseCardStatement(sbi.replace('dated 06/10/2026', 'dated 31/09/2026')).statementDate).toBeNull();
  expect(isNonTransactionNotice()).toBe(false);
  expect(isNonTransactionNotice('Your e-statement of account is ready')).toBe(true);
  const st = parseCardStatement(axis);
  expect(cardForStatement(st)).toBeNull();
  expect(
    cardForStatement(st, [
      null,
      { type: 'Credit Card' },
      { type: 'Credit Card', name: 'Axis ••9070', last4: '9070' },
    ]).name
  ).toBe('Axis ••9070');
});
