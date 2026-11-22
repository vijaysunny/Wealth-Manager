/**
 * A2 / D2: the owner's real SMS → parser → store (only UPI Lite + Cash exist) → discovered
 * accounts → "Add all" → every capture has an account and the balances are right.
 */
import fs from 'fs';
import path from 'path';
import Storage from '../../data/Storage';
import { addMany, getAll, monthlyAggregates } from '../../data/TransactionRepo';
import {
  discoveredAccounts,
  addAllDiscoveredAccounts,
  resolveCaptureAccount,
} from '../../utils/FeatureService';
import { parseTransactionText } from '../../utils/TransactionParser';
import { capturedFields } from '../../utils/CaptureMapper';
import { computeNetWorth } from '../../utils/BalanceService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));

const { messages } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '__fixtures__', 'sms', 'owner_real_samples.json'), 'utf8')
);

let seq = 0;
const capture = (m) => {
  const p = parseTransactionText(m.body, { sender: m.sender || '' });
  if (!p) return null;
  seq += 1;
  return {
    id: m.id,
    smsId: `sms:OWNER:${m.id}`,
    amount: p.amount,
    type: p.type,
    title: p.merchant || p.category,
    merchant: p.merchant,
    category: p.category,
    account: p.bankName,
    refNo: p.refNo,
    fullDate: new Date(Date.UTC(2026, 10, 1, 4, 0, seq)).toISOString(),
    extractedBalance: p.balance,
    ...capturedFields(p),
  };
};
const START = () => [
  { id: 'lite', name: 'UPI Lite', type: 'Wallet', subType: 'UPI Lite', balance: 0 },
  { id: 'cash', name: 'Cash', type: 'Cash', balance: 0 },
];
const accounts = async () => JSON.parse(await Storage.getItem('user_wealth_accounts'));
const find = async (re, type) => (await accounts()).find((a) => a.type === type && re.test(a.name));

beforeEach(async () => {
  seq = 0;
  await Storage.clear();
  await Storage.setItem('user_wealth_accounts', JSON.stringify(START()));
  await addMany(messages.map(capture).filter(Boolean), { balanceMode: 'captured' });
});

test("discovers the owner's accounts from SMS; no balances moved yet", async () => {
  const groups = await discoveredAccounts();
  expect(groups.map((g) => g.suggested.name).sort()).toEqual([
    'Axis Bank Credit Card ••9070',
    'Axis Bank ••0973',
    'Equitas Small Finance Bank ••1246',
    'SBI Credit Card ••1987',
  ]);
  const axis = groups.find((g) => g.suggested.name === 'Axis Bank ••0973');
  // the Google autopay ("Your A/c has been debited", no digits) is folded into Axis savings
  expect(axis.txIds).toContain('axis-autopay-google-01');
  expect((await accounts()).every((a) => a.balance === 0)).toBe(true);
});

test('Add all: every capture gets an account; top-ups move both legs; card bill is not spending', async () => {
  const before = await discoveredAccounts();
  const r = await addAllDiscoveredAccounts();
  expect(r.accounts).toBe(before.length);
  expect(await discoveredAccounts()).toEqual([]);

  const rows = await getAll();
  const unresolved = rows.filter((t) => t.accountUnresolved);
  expect(unresolved).toEqual([]);

  const axis = await find(/Axis Bank ••0973/, 'Bank Account');
  const axisCard = await find(/9070/, 'Credit Card');
  const sbiCard = await find(/1987/, 'Credit Card');
  expect(axis && axisCard && sbiCard).toBeTruthy();

  // Bank debits are on Axis savings, card spends on the cards
  const onAxis = rows.filter((t) => t.accountId === axis.id).map((t) => t.id);
  expect(onAxis).toEqual(expect.arrayContaining(['axis-debit-irctc-01', 'axis-autopay-google-01']));
  expect(rows.find((t) => t.id === 'axis-cc-spend-adyar-01').accountId).toBe(axisCard.id);
  expect(rows.find((t) => t.id === 'sbi-cc-recharge-01').accountId).toBe(sbiCard.id);

  // Both UPI Lite top-ups (with and without the A/c word) are linked Axis → UPI Lite
  const topups = rows.filter((t) => t.transferKind === 'wallet_topup');
  expect(topups).toHaveLength(2);
  topups.forEach((t) => expect(t).toMatchObject({ accountId: axis.id, toAccountId: 'lite' }));
  expect((await find(/UPI Lite/, 'Wallet')).balance).toBe(1000);

  // The Amazon Pay card bill is a transfer, never an expense
  const bill = rows.find((t) => t.id === 'axis-debit-ccbill-amazon-01');
  expect(bill).toMatchObject({ type: 'transfer', transferKind: 'cc_bill', accountId: axis.id });
  expect(rows.filter((t) => t.type === 'expense').map((t) => t.id)).not.toContain(bill.id);
});

test('D2: November totals from the fixtures; transfers are not spending', async () => {
  await addAllDiscoveredAccounts();
  const rows = await monthlyAggregates('2026-10-01T00:00:00Z', '2026-12-31T00:00:00Z');
  const total = (type) => rows.filter((r) => r.type === type).reduce((s, r) => s + r.total, 0);
  // Written out by hand from the fixture list (not computed by app code):
  // 26 expenses: 121 + 1998.19 + 178 + 5050 + 42000 + 96 + 25 + 143 + 86 + 600 + 353 + 67.90
  //   + 281 + 30 + 322 + 50 + 1020.58 + 607.55 + 106.97 + 309 + 75 + 350 + 16 + 250 + 538 + 160
  // (the Groww SIP stays an expense: no investment account on Groww exists)
  expect(total('expense')).toBeCloseTo(54834.19, 2);
  // 4 credits: 136193 + 40000 + 30000 + 50000
  expect(total('income')).toBeCloseTo(256193, 2);
  // top-ups 500 + 500, card bill 12511.38 and card payments 9145.91 + 5770 + 23618.82 are transfers
  expect(rows.some((r) => r.type === 'transfer')).toBe(false);
});

test('card bill paired after Add account: one transfer, net worth unchanged by the pair', async () => {
  // bank side and card side of the same payment, both waiting for their accounts
  const bill = {
    id: 'bill',
    smsId: 'sms:X:bill',
    amount: 777,
    type: 'transfer',
    transferKind: 'cc_bill',
    flow: 'out',
    accountType: 'Bank Account',
    bankName: 'Axis Bank',
    last4: '0973',
    fullDate: '2026-11-20T10:00:00Z',
  };
  const pay = {
    id: 'pay',
    smsId: 'sms:X:pay',
    amount: 777,
    type: 'transfer',
    transferKind: 'cc_payment',
    flow: 'in',
    accountType: 'Credit Card',
    bankName: 'Axis Bank',
    last4: '9070',
    fullDate: '2026-11-21T10:00:00Z',
  };
  await addMany([bill, pay], { balanceMode: 'captured' });
  await addAllDiscoveredAccounts();
  const rows = await getAll();
  expect(rows.find((t) => t.id === 'bill')).toBeUndefined();
  const merged = rows.find((t) => t.id === 'pay');
  const axis = await find(/Axis Bank ••0973/, 'Bank Account');
  const card = await find(/9070/, 'Credit Card');
  expect(merged).toMatchObject({ type: 'transfer', accountId: axis.id, toAccountId: card.id });
  expect(merged.pairedSmsIds).toEqual(['sms:X:bill']);
});

test('Link to existing: a group goes to the account the owner picked', async () => {
  const mine = { id: 'mysbi', name: 'My SBI card', type: 'Credit Card', balance: 0 };
  await Storage.setItem('user_wealth_accounts', JSON.stringify([...(await accounts()), mine]));
  const g = (await discoveredAccounts()).find((x) => /1987/.test(x.suggested.name));
  const r = await resolveCaptureAccount(g.firstTxId, { accountId: 'mysbi' });
  expect(r.resolved).toBe(g.count);
  const rows = await getAll();
  g.txIds.forEach((id) => expect(rows.find((t) => t.id === id).accountId).toBe('mysbi'));
  // SBI spends 143 + 86 + 600 + 353 + 1020.58 + 607.55 + 106.97 = 2917.10;
  // BBPS payments 5770 + 23618.82 = 29388.82 → the card is 26471.72 in credit
  const sbi = (await accounts()).find((a) => a.id === 'mysbi');
  expect(sbi.balance).toBeCloseTo(2917.1 - 29388.82, 2);
  expect(computeNetWorth(await accounts()).netWorth).toBeCloseTo(26471.72, 2);
});

describe('A11: debit-card spends (synthetic samples)', () => {
  const { parseTransactionText: parse } = require('../../utils/TransactionParser');
  const DC = [
    'INR 450.00 spent on Axis Bank Debit Card XX4821 at SWIGGY on 17-11-26 10:15:22. Avl Bal INR 12345.67. Not you? SMS BLOCK 4821 to 919951860002',
    'INR 2000.00 withdrawn at ATM using Axis Bank Debit Card XX4821 on 17-11-26 18:02:11. Avl Bal INR 10345.67 - Axis Bank',
    'Spent\nCard no. XX4821\nINR 120.00\n18-11-26 09:10:05\nCHAI POINT\nAvl Bal INR 10225.67\nSMS BLOCK 4821 to 919951860002, if not you - Axis Bank',
  ];
  const dcCapture = (body, i) => {
    const p = parse(body);
    return {
      id: `dc${i}`,
      smsId: `sms:DC:${i}`,
      amount: p.amount,
      type: p.type,
      title: p.merchant || p.category,
      category: p.category,
      account: p.bankName,
      fullDate: new Date(Date.UTC(2026, 10, 25, 0, 0, i)).toISOString(),
      extractedBalance: p.balance,
      ...capturedFields(p),
    };
  };

  test('after Add all, the card asks once; "Yes" moves all 3 captures to Axis ••0973', async () => {
    await addMany(DC.map(dcCapture), { balanceMode: 'captured' });
    // the card is its own group while Axis savings does not exist
    expect((await discoveredAccounts()).some((g) => g.cardLast4 === '4821')).toBe(true);
    // add Axis savings (and the others) - the card captures turn into a link question
    const axisGroup = (await discoveredAccounts()).find((g) => g.suggested.name === 'Axis Bank ••0973');
    await resolveCaptureAccount(axisGroup.firstTxId, { create: true });
    let rows = await getAll();
    const pending = rows.filter((t) => /^dc/.test(t.id));
    expect(pending.map((t) => t.reviewReason)).toEqual([
      'link_debit_card',
      'link_debit_card',
      'link_debit_card',
    ]);
    const axis = await find(/Axis Bank ••0973/, 'Bank Account');
    const before = axis.balance;

    const r = await resolveCaptureAccount('dc0', { accountId: axis.id });
    expect(r.resolved).toBe(3);
    rows = await getAll();
    rows.filter((t) => /^dc/.test(t.id)).forEach((t) => expect(t.accountId).toBe(axis.id));
    const after = await find(/Axis Bank ••0973/, 'Bank Account');
    expect(after.debitCards).toEqual(['4821']);
    // the latest SMS balance (Avl Bal 10225.67) wins
    expect(after.balance).not.toBe(before);
    expect(after.balance).toBeCloseTo(10225.67, 2);

    // the next spend with that card goes straight to savings
    await addMany([dcCapture(DC[0].replace('450.00', '99.00'), 9)], { balanceMode: 'captured' });
    expect((await getAll()).find((t) => t.id === 'dc9').accountId).toBe(axis.id);
  });
});
