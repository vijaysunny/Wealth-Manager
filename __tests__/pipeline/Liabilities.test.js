/**
 * Phase 13 D2: the owner's real SMS → "Add all" → set up the Axis card → a card purchase tracked as
 * an EMI → the Bajaj ACH debit linked to a new loan. Checks what you owe, spending and net worth.
 * The design's ₹2,74,919.19 SMS is not in the fixtures, so "you owe" comes from the latest Axis
 * card SMS in them (available ₹2,78,518.58).
 */
import fs from 'fs';
import path from 'path';
import Storage from '../../data/Storage';
import { addMany, getAll } from '../../data/TransactionRepo';
import { addAllDiscoveredAccounts } from '../../utils/FeatureService';
import { parseTransactionText } from '../../utils/TransactionParser';
import { capturedFields } from '../../utils/CaptureMapper';
import { accountsOverview } from '../../utils/AccountsOverview';
import { monthSpending } from '../../utils/BudgetView';
import { cardOwed } from '../../utils/CardMath';
import { setupOwedBox } from '../../utils/CardView';
import { saveCardSetup } from '../../utils/CardService';
import { emiFor } from '../../utils/LoanCalculator';
import { parseDmy, trackAsEmiPrefill } from '../../utils/LoanForm';
import { emiSuggestions, loanFromDebits } from '../../utils/LoanLink';
import { linkDebitsToLoan, saveLoan } from '../../utils/LoanService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));

const NOW = new Date(2026, 10, 22, 12);
beforeAll(() =>
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask'],
  })
);
afterAll(() => jest.useRealTimers());

const { rules: OWNER_RULES } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '__fixtures__', 'category_rules.owner.json'), 'utf8')
);
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
    fullDate: new Date(2026, 10, 1, 10, 0, seq).toISOString(),
    extractedBalance: p.balance,
    ...capturedFields(p),
  };
};
const accounts = async () => JSON.parse(await Storage.getItem('user_wealth_accounts'));
const overview = async () => accountsOverview(await accounts(), { txs: await getAll(), asOf: NOW });

beforeEach(async () => {
  seq = 0;
  await Storage.clear();
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([
      { id: 'lite', name: 'UPI Lite', type: 'Wallet', subType: 'UPI Lite', balance: 0 },
      { id: 'cash', name: 'Cash', type: 'Cash', balance: 0 },
    ])
  );
  await Storage.setItem('category_rules', JSON.stringify(OWNER_RULES));
  await addMany(messages.map(capture).filter(Boolean), { balanceMode: 'captured' });
  await addAllDiscoveredAccounts();
});

test('D2: card setup, card EMI never counted twice, Bajaj linked to a loan', async () => {
  // 1. Set up the Axis card: what you owe = limit − latest available; stored balance only on Save
  const card = (await accounts()).find((a) => a.type === 'Credit Card' && a.last4 === '9070');
  const stored = card.balance;
  const box = setupOwedBox(card, 300000, await getAll(), NOW);
  expect(box.owed).toBe(21481.42);
  expect(box.available.amount).toBe(278518.58);
  expect(Math.abs(stored - box.owed) > 1 ? box.note : null).toBe(box.note);
  expect((await accounts()).find((a) => a.id === card.id).balance).toBe(stored); // not changed yet
  const before = await overview();
  expect(before.notCounted.map((a) => a.id)).toContain(card.id);
  await saveCardSetup(
    card.id,
    { creditLimit: 300000, statementDay: 15, due: { mode: 'afterStatement', days: 20 } },
    { now: NOW }
  );
  expect((await accounts()).find((a) => a.id === card.id).balance).toBe(21481.42);
  const afterSetup = await overview();
  expect(afterSetup.groups.liabilities.cards.find((c) => c.account.id === card.id)).toMatchObject({
    owed: 21481.42,
    counted: true,
  });

  // 2. A ₹25,000 card purchase, then "Track as EMI" (12 months, 15 %)
  const spentBefore = monthSpending(await getAll(), NOW).total;
  const buy = {
    id: 'phone',
    type: 'expense',
    amount: 25000,
    merchant: 'Croma',
    title: 'Croma',
    category: 'Shopping',
    accountId: card.id,
    account: card.name,
    fullDate: new Date(2026, 10, 2, 12).toISOString(),
  };
  await addMany([buy], { balanceMode: 'delta', dedup: false });
  expect(monthSpending(await getAll(), NOW).total).toBe(Math.round((spentBefore + 25000) * 100) / 100);
  const withPurchase = await overview();
  expect(withPurchase.liabilities).toBe(Math.round((afterSetup.liabilities + 25000) * 100) / 100);
  const prefill = trackAsEmiPrefill(
    buy,
    (await accounts()).find((a) => a.id === card.id)
  );
  expect(prefill.firstEmi).toBe('15/11/2026');
  await saveLoan({
    kind: 'cardEmi',
    name: 'Phone EMI',
    amount: 25000,
    months: 12,
    rate: 15,
    firstEmi: parseDmy(prefill.firstEmi),
    emi: emiFor(25000, 15, 12),
    payFromId: card.id,
    sourceTxId: buy.id,
  });
  const withEmi = await overview();
  expect(withEmi.liabilities).toBe(withPurchase.liabilities); // the EMI entry is not added again
  expect(withEmi.netWorth).toBe(withPurchase.netWorth);
  expect(monthSpending(await getAll(), NOW).total).toBe(Math.round((spentBefore + 25000) * 100) / 100); // once
  expect(withEmi.groups.liabilities.loans.find((l) => l.account.name === 'Phone EMI').inCard).toBe(true);

  // 3. The Bajaj ₹538 ACH debit → a new no-cost loan with 8 EMIs left
  const txs = await getAll();
  const byId = Object.fromEntries((await accounts()).map((a) => [String(a.id), a]));
  const bajajTx = txs.find((t) => t.id === 'axis-ach-bajaj-01');
  expect(bajajTx).toMatchObject({ amount: 538, channel: 'ACH', category: 'Loan/EMI' });
  expect(emiSuggestions(txs, byId)).toEqual([]); // both fixture debits carry the same capture date: not monthly yet
  const values = loanFromDebits(
    {
      payee: 'Bajaj Finance',
      emi: 538,
      left: 8,
      rate: 0,
      debitDay: 7,
      accountId: bajajTx.accountId,
      debits: [bajajTx],
    },
    NOW
  );
  const loan = await saveLoan(values);
  await linkDebitsToLoan(loan.id, {
    payee: 'bajaj finance',
    amount: 538,
    accountId: bajajTx.accountId,
    debits: [bajajTx],
  });
  const linked = (await getAll()).find((t) => t.id === 'axis-ach-bajaj-01');
  expect(linked).toMatchObject({
    type: 'expense',
    amount: 538,
    category: 'Loan/EMI',
    loanLink: { loanId: loan.id, kind: 'emi' },
  });
  expect(monthSpending(await getAll(), NOW).byCategory['Loan/EMI']).toBeGreaterThanOrEqual(538);
  const end = await overview();
  const cardNow = cardOwed(
    (await accounts()).find((a) => a.id === card.id),
    await getAll(),
    NOW
  ).owed;
  expect(end.liabilities).toBe(Math.round((cardNow + 4304) * 100) / 100);
  // net worth moved only by the new loan's outstanding (the ₹538 had already left the bank)
  expect(end.netWorth).toBe(Math.round((withEmi.netWorth - 4304) * 100) / 100);
});
