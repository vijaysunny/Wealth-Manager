/**
 * Statement / PDF rows: UPI Lite rows are transfers (A5, UNVERIFIED-SAMPLE narration),
 * deterministic IDs (B8). Synthetic layouts until the owner supplies real statements.
 */
import { parseStatementRows, parsePdfText, statementWalletFields } from '../../utils/TransactionParser';

const HEADER = ['Tran Date', 'Particulars', 'Chq No', 'Debit', 'Credit', 'Balance'];
const rows = () => [
  HEADER,
  ['07-11-2026', 'UPI LITE TOPUP/010071026164', '', '500.00', '', '9500.00'],
  ['07-11-2026', 'UPI/P2M/630969451444/GROWW INVEST TECH P', '', '5050.00', '', '4450.00'],
  ['09-11-2026', 'UPILITE WITHDRAW/0100710261649', '', '', '120.00', '4570.00'],
  ['10-11-2026', 'UPI/P2A/111111111111/CHAI', '', '20.00', '', '4550.00'],
  ['10-11-2026', 'UPI/P2A/111111111111/CHAI', '', '20.00', '', '4530.00'],
];

test('UPI Lite debit = top-up transfer out; credit = withdrawal in; others unchanged', () => {
  const txs = parseStatementRows(rows(), 'Axis Bank');
  expect(txs[0]).toMatchObject({
    type: 'transfer',
    transferKind: 'wallet_topup',
    flow: 'out',
    category: 'Wallet Top-up',
  });
  expect(txs[1]).toMatchObject({ type: 'expense', category: 'Investment' });
  expect(txs[2]).toMatchObject({ type: 'transfer', transferKind: 'wallet_withdraw', flow: 'in' });
  expect(statementWalletFields('NEFT SALARY', 'income')).toBeNull();
});

test('B8: IDs are deterministic across re-parses; identical rows stay distinct', () => {
  const a = parseStatementRows(rows(), 'Axis Bank').map((t) => t.id);
  const b = parseStatementRows(rows(), 'Axis Bank').map((t) => t.id);
  expect(a).toEqual(b);
  expect(new Set(a).size).toBe(a.length);
  expect(a.every((id) => /^stmt_20261\d{3}_[a-z0-9]+_\d+$/.test(id))).toBe(true);
  expect(parseStatementRows(rows(), 'Equitas')[0].id).not.toBe(a[0]); // account is part of the key
});

test('conservation: opening + credits − debits = closing (C2)', () => {
  const txs = parseStatementRows(rows(), 'Axis Bank');
  const debits = txs
    .filter((t) => t.type === 'expense' || t.flow === 'out')
    .reduce((s, t) => s + t.amount, 0);
  const credits = txs.filter((t) => t.type === 'income' || t.flow === 'in').reduce((s, t) => s + t.amount, 0);
  expect(10000 + credits - debits).toBeCloseTo(4530, 2);
});

test('PDF lines: Lite row is a transfer, IDs deterministic', () => {
  const text = ['07/11/2026 UPI LITE TOPUP 500.00 9,500.00', '08/11/2026 ZOMATO 200.00 9,300.00'].join('\n');
  const a = parsePdfText(text, 'Axis Bank');
  expect(a[0]).toMatchObject({ type: 'transfer', transferKind: 'wallet_topup' });
  expect(a[1].type).toBe('expense');
  expect(parsePdfText(text, 'Axis Bank').map((t) => t.id)).toEqual(a.map((t) => t.id));
});
