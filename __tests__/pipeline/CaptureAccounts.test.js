/**
 * Capture pipeline (plan A3, B7, A7): owner's real SMS → parser → repo (real SQLite
 * adapter) → account resolution → balances.
 */
import Storage from '../../data/Storage';
import { addMany, getAll, remove } from '../../data/TransactionRepo';
import { rejectCapture } from '../../utils/FeatureService';
import { parseTransactionText } from '../../utils/TransactionParser';
import { capturedFields } from '../../utils/CaptureMapper';
import { computeNetWorth } from '../../utils/BalanceService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));

const SMS = {
  topup:
    'UPI LITE enabled on UPI App for A/c no. XX0973 with successful top-up of INR 500.00 on 07-11-26 09:46:28 IST. Ref no. 01007102616409005179402498474608827 - Axis Bank',
  imps178:
    'Debit INR 178.00\nAxis Bank A/c XX0973\n16-11-26 13:45:25\nIMPS/P2A/632013023016/baja\nWhatsApp BAL to 917036165000\nNot You? SMS BLOCKALL CustID to 919951860002',
  axisCard:
    'Spent INR 121 \nusing Axis Bank Credit Card no. XX9070 on 16-11-26 19:48:20 IST at \nSELVA KUMAR. \nAvl limit: INR 275541.19. Not you? SMS BLOCK 9070 to +919951860002.',
  sbiCard:
    'Rs.143.00 spent on your SBI Credit Card ending 1987 at PRADHANMANTRIBHARTIYAJ on 08/11/26. Trxn. not done by you? Report at https://sbicard.com/Dispute',
  sbiPay:
    'We have received payment of Rs.5,770.00 via BBPS & the same has been credited to your SBI Credit Card. Your available limit is Rs.178,307.37.',
  equitas:
    'INR 96.00 debited via UPI from Equitas A/c 1246 -Ref:061704889746 on 08-08-25 to HARISH. Avl Bal is INR 581.65.Not U?Call 18001031222/SMS BLOCK UPI/BLOCK ACT 1246 to 7045030000.',
  autopay:
    'Your A/c has been debited towards Google for INR 1998.19 on 18-11-26. s2bvuWCARzH6xideZ5l7UafD6Ojf1KFE@apl - Axis Bank',
  hdfc: 'Rs 25,000.00 credited to your A/c XX4321 on 01-Jan-24 by ACME Salary. Avl Bal Rs 30,000.00',
};

let seq = 0;
const capture = (body, extra = {}, sender = '') => {
  const p = parseTransactionText(body, { sender });
  seq += 1;
  return {
    id: `t${seq}`,
    smsId: `sms:TEST:${seq}`,
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
    ...extra,
  };
};
const OWNER = () => [
  { id: 'axis', name: 'Axis Bank', type: 'Bank Account', balance: 10000 },
  { id: 'axiscc', name: 'Axis Card', type: 'Credit Card', balance: 1000 },
  { id: 'sbicc', name: 'SBI Card', type: 'Credit Card', balance: 6000 },
  { id: 'equitas', name: 'Equitas', type: 'Bank Account', balance: 700 },
];
const accounts = async () => JSON.parse(await Storage.getItem('user_wealth_accounts'));
const byId = async (id) => (await accounts()).find((a) => a.id === id);
const save = (txs) => addMany(txs, { balanceMode: 'captured' });

beforeEach(async () => {
  await Storage.clear();
  await Storage.setItem('user_wealth_accounts', JSON.stringify(OWNER()));
});

describe('matching by type + bank + last-4', () => {
  test('Axis savings matched and learns 0973; card spends never touch savings', async () => {
    await save([capture(SMS.imps178), capture(SMS.axisCard), capture(SMS.sbiCard)]);
    expect(await byId('axis')).toMatchObject({ balance: 9822, last4: '0973' });
    expect(await byId('axiscc')).toMatchObject({ balance: 1121, last4: '9070' });
    expect(await byId('sbicc')).toMatchObject({ balance: 6143, last4: '1987' });
    const rows = await getAll();
    expect(rows.every((t) => t.accountId && !t.accountUnresolved)).toBe(true);
  });
  test('Equitas (owner account) balance is SET from the SMS', async () => {
    await save([capture(SMS.equitas)]);
    expect((await byId('equitas')).balance).toBe(581.65);
  });
  test('card payment lowers SBI card debt; no fake income', async () => {
    await save([capture(SMS.sbiPay)]);
    expect((await byId('sbicc')).balance).toBe(230);
    expect((await getAll())[0]).toMatchObject({
      type: 'transfer',
      transferKind: 'cc_payment',
      accountId: 'sbicc',
    });
  });
});

describe('B7: no junk accounts; ambiguity goes to review (A7.4)', () => {
  test('unknown bank → new_account review with a suggestion; nothing created or moved', async () => {
    await save([capture(SMS.hdfc, {}, 'AD-HDFCBK')]);
    expect(await accounts()).toEqual(OWNER());
    expect((await getAll())[0]).toMatchObject({
      accountUnresolved: true,
      reviewReason: 'new_account',
      reviewStatus: 'pending',
      suggestedAccount: { name: 'HDFC Bank ••4321', type: 'Bank Account', last4: '4321' },
    });
  });
  test('two Axis savings accounts and an SMS without digits → pick_account, no guess', async () => {
    await Storage.setItem(
      'user_wealth_accounts',
      JSON.stringify([...OWNER(), { id: 'axis2', name: 'Axis Salary', type: 'Bank Account', balance: 50 }])
    );
    await save([capture(SMS.autopay)]);
    const tx = (await getAll())[0];
    expect(tx).toMatchObject({ accountUnresolved: true, reviewReason: 'pick_account' });
    expect(tx.accountCandidates.sort()).toEqual(['axis', 'axis2']);
    expect((await byId('axis')).balance).toBe(10000);
    expect((await byId('axis2')).balance).toBe(50);
  });
  test('…but once Axis savings knows 0973, a digits SMS goes straight to it', async () => {
    await Storage.setItem(
      'user_wealth_accounts',
      JSON.stringify([
        ...OWNER().map((a) => (a.id === 'axis' ? { ...a, last4: '0973' } : a)),
        { id: 'axis2', name: 'Axis Salary', type: 'Bank Account', last4: '5555', balance: 50 },
      ])
    );
    await save([capture(SMS.imps178)]);
    expect((await byId('axis')).balance).toBe(9822);
  });
  test('a card SMS never matches a same-bank savings account', async () => {
    await Storage.setItem(
      'user_wealth_accounts',
      JSON.stringify([{ id: 'sbisav', name: 'SBI', type: 'Bank Account', balance: 100 }])
    );
    await save([capture(SMS.sbiCard)]);
    expect((await getAll())[0].reviewReason).toBe('new_account');
    expect((await byId('sbisav')).balance).toBe(100);
  });
});

describe('UPI Lite top-up (A3, A7)', () => {
  test('wallet created on first top-up, linked, both legs move, net worth unchanged (A7.1, A7.13)', async () => {
    const before = computeNetWorth(await accounts()).netWorth;
    await save([capture(SMS.topup)]);
    const all = await accounts();
    const wallet = all.find((a) => a.type === 'Wallet');
    expect(wallet).toMatchObject({
      name: 'UPI Lite',
      subType: 'UPI Lite',
      linkedBankId: 'axis',
      balance: 500,
    });
    expect((await byId('axis')).balance).toBe(9500);
    expect(computeNetWorth(all).netWorth).toBe(before);
    expect((await getAll())[0]).toMatchObject({
      type: 'transfer',
      transferKind: 'wallet_topup',
      accountId: 'axis',
      toAccountId: wallet.id,
      reviewReason: 'new_wallet',
      reviewStatus: 'pending',
    });
  });
  test('A5: "UPI LITE top-up … - Axis Bank" (no A/c word) moves BOTH Axis −500 and UPI Lite +500', async () => {
    const TOPUP_NO_AC =
      'UPI LITE top-up on UPI App amounting to INR 500.00 has been successful. Ref no. 100000000101 - Axis Bank';
    const lite = { id: 'lite', name: 'UPI Lite', type: 'Wallet', subType: 'UPI Lite', balance: 500 };
    await Storage.setItem('user_wealth_accounts', JSON.stringify([...OWNER(), lite]));
    const before = computeNetWorth(await accounts()).netWorth;
    await save([capture(TOPUP_NO_AC)]);
    expect((await byId('axis')).balance).toBe(9500);
    expect((await byId('lite')).balance).toBe(1000);
    expect(computeNetWorth(await accounts()).netWorth).toBe(before);
    expect((await getAll())[0]).toMatchObject({
      type: 'transfer',
      transferKind: 'wallet_topup',
      accountId: 'axis',
      toAccountId: 'lite',
    });
  });
  test('same SMS twice (listener + inbox scan) → one transfer (A7.2)', async () => {
    const tx = capture(SMS.topup);
    await save([tx]);
    await save([{ ...tx, id: 'other-id' }]);
    expect(await getAll()).toHaveLength(1);
    expect((await byId('axis')).balance).toBe(9500);
  });
  test('two same-amount top-ups on one day → two transfers, one wallet (A7.5)', async () => {
    await save([capture(SMS.topup), capture(SMS.topup.replace('09:46:28', '18:01:02'), { refNo: 'R2' })]);
    expect(await getAll()).toHaveLength(2);
    const wallets = (await accounts()).filter((a) => a.type === 'Wallet');
    expect(wallets).toHaveLength(1);
    expect(wallets[0].balance).toBe(1000);
    expect((await byId('axis')).balance).toBe(9000);
  });
  test('existing wallet is reused, not duplicated', async () => {
    await Storage.setItem(
      'user_wealth_accounts',
      JSON.stringify([
        ...OWNER(),
        {
          id: 'lite',
          name: 'PhonePe UPI Lite',
          type: 'Wallet',
          subType: 'UPI Lite',
          provider: 'PhonePe',
          balance: 20,
        },
      ])
    );
    await save([capture(SMS.topup)]);
    expect((await accounts()).filter((a) => a.type === 'Wallet')).toHaveLength(1);
    expect((await byId('lite')).balance).toBe(520);
  });
  test('deleting the transfer restores both balances (A7.11)', async () => {
    await save([capture(SMS.topup)]);
    await remove((await getAll())[0].id);
    expect((await byId('axis')).balance).toBe(10000);
    expect((await accounts()).find((a) => a.type === 'Wallet').balance).toBe(0);
  });
  test('rejecting the capture keeps it from coming back on re-scan', async () => {
    const tx = capture(SMS.topup);
    await save([tx]);
    await rejectCapture(tx.id);
    await save([{ ...tx, id: 'rescan' }]);
    expect(await getAll()).toHaveLength(0);
    expect((await byId('axis')).balance).toBe(10000);
  });
});

describe('review queue resolution', () => {
  const { resolveCaptureAccount, pickCaptureWallet } = require('../../utils/FeatureService');

  test('create the suggested account: all similar pending captures resolve, latest SMS balance wins', async () => {
    const a = capture(SMS.hdfc, {}, 'AD-HDFCBK');
    const b = capture(
      SMS.hdfc.replace('25,000.00', '1,000.00').replace('30,000.00', '31,000.00'),
      {},
      'AD-HDFCBK'
    );
    await save([a, b]);
    const r = await resolveCaptureAccount(a.id, { create: true });
    expect(r.resolved).toBe(2);
    const hdfc = (await accounts()).find((x) => x.id === r.accountId);
    expect(hdfc).toMatchObject({
      name: 'HDFC Bank ••4321',
      type: 'Bank Account',
      last4: '4321',
      balance: 31000,
    });
    expect((await getAll()).every((t) => !t.accountUnresolved && t.accountId === r.accountId)).toBe(true);
    // a later HDFC SMS now matches automatically
    await save([capture(SMS.hdfc.replace('30,000.00', '32,500.00'), {}, 'AD-HDFCBK')]);
    expect((await byId(r.accountId)).balance).toBe(32500);
  });

  test('pick one of two ambiguous accounts; delete afterwards restores it', async () => {
    await Storage.setItem(
      'user_wealth_accounts',
      JSON.stringify([...OWNER(), { id: 'axis2', name: 'Axis Salary', type: 'Bank Account', balance: 50 }])
    );
    const tx = capture(SMS.autopay);
    await save([tx]);
    await resolveCaptureAccount(tx.id, { accountId: 'axis' });
    expect((await byId('axis')).balance).toBeCloseTo(8001.81, 2);
    expect((await getAll())[0]).toMatchObject({ accountId: 'axis', reviewStatus: 'pending' });
    await remove(tx.id);
    expect((await byId('axis')).balance).toBe(10000);
  });

  test('pick a wallet for a top-up that matched two wallets; net worth unchanged', async () => {
    await Storage.setItem(
      'user_wealth_accounts',
      JSON.stringify([
        ...OWNER(),
        {
          id: 'w1',
          name: 'PhonePe UPI Lite',
          type: 'Wallet',
          subType: 'UPI Lite',
          provider: 'PhonePe',
          balance: 0,
        },
        {
          id: 'w2',
          name: 'Paytm UPI Lite',
          type: 'Wallet',
          subType: 'UPI Lite',
          provider: 'Paytm',
          balance: 0,
        },
      ])
    );
    const before = computeNetWorth(await accounts()).netWorth;
    const tx = capture(SMS.topup);
    await save([tx]);
    expect((await getAll())[0].reviewReason).toBe('pick_wallet');
    expect((await byId('axis')).balance).toBe(9500); // bank leg only so far
    await pickCaptureWallet(tx.id, 'w2');
    expect((await byId('w2')).balance).toBe(500);
    expect((await byId('axis')).balance).toBe(9500);
    expect(computeNetWorth(await accounts()).netWorth).toBe(before);
  });
});

describe('card bill payment seen twice → one transfer (UNVERIFIED-SAMPLE bank side)', () => {
  // Synthetic Axis-style debit for paying the SBI card; replace with a real one when available
  const AXIS_PAYS_SBI_CARD =
    'INR 5770.00 debited\nA/c no. XX0973\n10-11-26, 10:00:15\nUPI/P2M/631234567890/SBI CARD\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank';
  const netWorth = async () => computeNetWorth(await accounts()).netWorth;

  test('bank debit first, then card "payment received": one transfer, net worth unchanged', async () => {
    const before = await netWorth();
    await save([capture(AXIS_PAYS_SBI_CARD)]);
    await save([capture(SMS.sbiPay)]);
    const rows = await getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'transfer',
      transferKind: 'cc_payment',
      accountId: 'axis',
      toAccountId: 'sbicc',
    });
    expect((await byId('axis')).balance).toBe(4230);
    expect((await byId('sbicc')).balance).toBe(230);
    expect(await netWorth()).toBe(before);
  });

  test('card SMS first, then bank debit: the stored transfer is linked; re-scan adds nothing', async () => {
    const before = await netWorth();
    const pay = capture(SMS.sbiPay);
    const debit = capture(AXIS_PAYS_SBI_CARD);
    await save([pay]);
    await save([debit]);
    let rows = await getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: pay.id, accountId: 'axis', toAccountId: 'sbicc' });
    expect(rows[0].pairedSmsIds).toEqual([debit.smsId]);
    expect(await netWorth()).toBe(before);
    await save([
      { ...debit, id: 'rescan1' },
      { ...pay, id: 'rescan2' },
    ]);
    rows = await getAll();
    expect(rows).toHaveLength(1);
    expect((await byId('axis')).balance).toBe(4230);
  });

  test('both in one batch pair too', async () => {
    await save([capture(AXIS_PAYS_SBI_CARD), capture(SMS.sbiPay)]);
    expect(await getAll()).toHaveLength(1);
    expect((await byId('sbicc')).balance).toBe(230);
  });

  test('undo of the merged transfer restores both and blocks both SMS from returning', async () => {
    const debit = capture(AXIS_PAYS_SBI_CARD);
    const pay = capture(SMS.sbiPay);
    await save([debit, pay]);
    await rejectCapture((await getAll())[0].id);
    expect((await byId('axis')).balance).toBe(10000);
    expect((await byId('sbicc')).balance).toBe(6000);
    await save([
      { ...debit, id: 'x1' },
      { ...pay, id: 'x2' },
    ]);
    expect(await getAll()).toHaveLength(0);
  });

  test('no card-payment wording or > 3 days apart → not paired', async () => {
    await save([capture(SMS.sbiPay)]);
    await save([capture(SMS.imps178.replace('178.00', '5770.00').replace('baja', 'GROCERY'))]);
    expect(await getAll()).toHaveLength(2);
    await Storage.clear();
    await Storage.setItem('user_wealth_accounts', JSON.stringify(OWNER()));
    await save([capture(SMS.sbiPay, { fullDate: '2026-11-01T00:00:00Z' })]);
    await save([capture(AXIS_PAYS_SBI_CARD, { fullDate: '2026-11-05T00:00:01Z' })]);
    expect(await getAll()).toHaveLength(2);
  });
});

describe("A4: owner's real Axis card bill paid from Axis savings (cc_bill ↔ cc_payment)", () => {
  const BILL =
    'INR 9145.91 debited\nA/c no. XX0973\n05-07-26, 18:11:07\nUPI/P2M/600000000303/Amazon Pay Credit C\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank';
  const PAID =
    'Payment of INR 9145.91 has been received towards your Axis Bank Credit Card XX9070 on 06-07-26 - Axis Bank';
  const netWorth = async () => computeNetWorth(await accounts()).netWorth;

  test('bank side alone is a one-sided transfer out of savings, not an expense', async () => {
    await save([capture(BILL)]);
    const [row] = await getAll();
    expect(row).toMatchObject({ type: 'transfer', transferKind: 'cc_bill', flow: 'out', accountId: 'axis' });
    expect((await byId('axis')).balance).toBeCloseTo(10000 - 9145.91, 2);
  });

  test('then the card SMS: ONE transfer savings → card; net worth unchanged', async () => {
    const before = await netWorth();
    await save([capture(BILL)]);
    await save([capture(PAID)]);
    const rows = await getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'transfer', accountId: 'axis', toAccountId: 'axiscc' });
    expect((await byId('axis')).balance).toBeCloseTo(854.09, 2);
    expect((await byId('axiscc')).balance).toBeCloseTo(1000 - 9145.91, 2);
    expect(await netWorth()).toBeCloseTo(before, 2);
  });

  test('card SMS first, then the bank debit: also one transfer', async () => {
    await save([capture(PAID)]);
    await save([capture(BILL)]);
    const rows = await getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: 'axis', toAccountId: 'axiscc' });
  });
});

describe('cross-source: SMS top-up then bank statement import (A7.3, D7/D8)', () => {
  test('statement row for the same top-up adds nothing and moves no balance', async () => {
    await save([capture(SMS.topup)]);
    const before = await accounts();
    const statementRow = {
      id: 'stmt_topup',
      type: 'expense',
      amount: 500,
      account: 'Axis Bank',
      title: 'UPI LITE TOPUP 01007102616409005179',
      category: 'UPI Transfer',
      fullDate: '2026-11-01T12:00:00.000Z',
    };
    const r = await addMany([statementRow], { balanceMode: 'delta' });
    expect(r.added).toBe(0);
    expect(await accounts()).toEqual(before);
    const again = await addMany([{ ...statementRow, id: 'stmt_topup_2' }], { balanceMode: 'delta' });
    expect(again.added).toBe(0);
  });
});

describe('statement import with UPI Lite rows (A5, B8, C2)', () => {
  const { parseStatementRows } = require('../../utils/TransactionParser');
  const { prepareStatementWallets } = require('../../utils/AccountResolver');
  const file = () => [
    ['Tran Date', 'Particulars', 'Chq No', 'Debit', 'Credit', 'Balance'],
    ['07-11-2026', 'UPI LITE TOPUP/010071026164', '', '500.00', '', '9500.00'],
    ['08-11-2026', 'UPI/P2M/630969451444/GROWW INVEST TECH P', '', '5050.00', '', '4450.00'],
  ];

  test('no wallet yet → preview must ask; nothing is created silently', async () => {
    const r = prepareStatementWallets(parseStatementRows(file(), 'Axis Bank'), await accounts(), 'Axis Bank');
    expect(r.missingWallet).toMatchObject({ name: 'UPI Lite', type: 'Wallet', linkedBankId: 'axis' });
    expect((await accounts()).some((a) => a.type === 'Wallet')).toBe(false);
  });

  test('with a wallet: top-up linked bank → wallet; delta import keeps net worth; re-import adds 0', async () => {
    await Storage.setItem(
      'user_wealth_accounts',
      JSON.stringify([
        ...OWNER(),
        { id: 'lite', name: 'UPI Lite', type: 'Wallet', subType: 'UPI Lite', balance: 0 },
      ])
    );
    const before = computeNetWorth(await accounts()).netWorth;
    const { rows, missingWallet } = prepareStatementWallets(
      parseStatementRows(file(), 'Axis Bank'),
      await accounts(),
      'Axis Bank'
    );
    expect(missingWallet).toBeNull();
    expect(rows[0]).toMatchObject({ accountId: 'axis', toAccountId: 'lite' });
    expect((await addMany(rows, { balanceMode: 'delta' })).added).toBe(2);
    expect((await byId('lite')).balance).toBe(500);
    expect(computeNetWorth(await accounts()).netWorth).toBe(before - 5050); // only the real expense
    const again = prepareStatementWallets(
      parseStatementRows(file(), 'Axis Bank'),
      await accounts(),
      'Axis Bank'
    );
    expect((await addMany(again.rows, { balanceMode: 'delta' })).added).toBe(0);
  });

  test('statement after the SMS top-up: the Lite row dedupes against the SMS transfer (A7.3)', async () => {
    await save([capture(SMS.topup, { fullDate: '2026-11-07T04:16:28.000Z' })]);
    const prepared = prepareStatementWallets(
      parseStatementRows(file(), 'Axis Bank'),
      await accounts(),
      'Axis Bank'
    );
    const r = await addMany(prepared.rows, { balanceMode: 'delta' });
    expect(r.added).toBe(1); // only the Groww row
  });
});
