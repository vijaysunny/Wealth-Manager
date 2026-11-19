import {
  redact,
  amountInText,
  isAiSmsCandidate,
  validateSmsResult,
  aiParseSms,
  aiCategorize,
  validateStatementRows,
  aiParseStatement,
  buildSpendingSummary,
  aiInsights,
} from '../../utils/ai/AiTasks';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null) }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const SMS = {
  id: 1,
  sender: 'VM-NEWBNK',
  date: new Date('2026-11-10T10:00:00Z').getTime(),
  body: 'NewBank: Rs.1,250.50 paid from a/c XX4321 to SWIGGY on 10-11-26. Bal Rs 8,000.00. Ref 612345678901',
};

describe('guards', () => {
  test('redact masks long digit runs but keeps amounts and XX1234', () => {
    const out = redact('Call 9876543210 or 1800 123 4567. A/c 123456789012 XX4321 Rs.1,250.50');
    expect(out).not.toMatch(/9876543210|123456789012/);
    expect(out).toContain('XX4321');
    expect(out).toContain('1,250.50');
  });
  test('amountInText only accepts numbers actually written', () => {
    expect(amountInText(1250.5, SMS.body)).toBe(true);
    expect(amountInText(1250, SMS.body)).toBe(false);
    expect(amountInText(-5, SMS.body)).toBe(false);
  });
  test('isAiSmsCandidate rejects OTPs and offers', () => {
    expect(isAiSmsCandidate(SMS.body)).toBe(true);
    expect(isAiSmsCandidate('OTP 123456 for txn of Rs 500. Do not share')).toBe(false);
    expect(isAiSmsCandidate('Get cashback up to Rs 500 on payment!')).toBe(false);
    expect(isAiSmsCandidate('Hello there')).toBe(false);
  });
});

describe('validateSmsResult', () => {
  const base = { isTransaction: true, amount: 1250.5, type: 'expense', merchant: 'Swiggy', bank: 'NewBank' };
  test('accepts a grounded result and limits category to the list', () => {
    expect(
      validateSmsResult({ ...base, category: 'food', accountType: 'Bank Account' }, SMS, ['Food'])
    ).toEqual({
      amount: 1250.5,
      type: 'expense',
      category: 'Food',
      merchant: 'Swiggy',
      bankName: 'NewBank',
      accountType: 'Bank Account',
    });
    expect(validateSmsResult({ ...base, category: 'Crypto' }, SMS, ['Food']).category).toBe('General');
  });
  test('rejects invented amounts, non-transactions and bad types', () => {
    expect(validateSmsResult({ ...base, amount: 999 }, SMS)).toBeNull();
    expect(validateSmsResult({ ...base, isTransaction: false }, SMS)).toBeNull();
    expect(validateSmsResult({ ...base, type: 'refund?' }, SMS)).toBeNull();
  });
  test('transfer becomes an expense marked UPI Transfer', () => {
    expect(validateSmsResult({ ...base, type: 'transfer' }, SMS)).toMatchObject({
      type: 'expense',
      category: 'UPI Transfer',
      merchant: null,
    });
  });
});

test('aiParseSms builds scan items with locally extracted ref/last4/balance', async () => {
  const ask = jest.fn(async ({ prompt }) => {
    expect(prompt).not.toContain('612345678901'); // ref masked before sending
    return {
      data: {
        results: [
          {
            i: 0,
            isTransaction: true,
            amount: 1250.5,
            type: 'expense',
            merchant: 'SWIGGY',
            bank: 'NewBank',
            category: 'Food',
          },
        ],
      },
    };
  });
  const [item] = await aiParseSms([SMS], { ask, categories: ['Food'] });
  expect(item).toMatchObject({
    amount: 1250.5,
    type: 'expense',
    category: 'Food',
    merchant: 'SWIGGY',
    refNo: '612345678901',
    currentBalance: 8000,
    smsId: expect.stringContaining('VM-NEWBNK'),
  });
  expect(item.captured).toMatchObject({ last4: '4321', aiParsed: true, bankName: 'NewBank' });
});

test('aiParseSms survives a failing batch', async () => {
  const ask = jest.fn().mockRejectedValue(new Error('down'));
  await expect(aiParseSms([SMS], { ask })).resolves.toEqual([]);
});

test('aiCategorize returns only real changes within the allowed list', async () => {
  const ask = jest.fn(async () => ({
    data: {
      results: [
        { i: 0, category: 'Food' },
        { i: 1, category: 'Spaceships' },
        { i: 2, category: 'General' },
      ],
    },
  }));
  const map = await aiCategorize(
    [
      { id: 'a', title: 'ZOMATO', amount: 300, type: 'expense', category: 'General' },
      { id: 'b', title: 'X', amount: 1, type: 'expense', category: 'General' },
      { id: 'c', title: 'Y', amount: 1, type: 'expense', category: 'General' },
    ],
    { ask, categories: ['Food'] }
  );
  expect([...map.entries()]).toEqual([['a', 'Food']]);
});

describe('statements', () => {
  const chunk = '05/11/2026 AMAZON PAY 1,499.00 Dr 20,501.00\n06/11/2026 SALARY ACME 50,000.00 Cr 70,501.00';
  test('validateStatementRows keeps grounded rows only', () => {
    const rows = validateStatementRows(
      [
        {
          date: '2026-11-05',
          description: 'AMAZON PAY',
          amount: 1499,
          type: 'expense',
          balance: 20501,
          category: 'Shopping',
        },
        { date: '2026-11-06', description: 'SALARY ACME', amount: 50000, type: 'income', balance: 1 },
        { date: '2026-11-07', description: 'MADE UP', amount: 777, type: 'expense' },
        { date: 'not a date', description: 'X', amount: 1499, type: 'expense' },
      ],
      chunk,
      { bankHint: 'HDFC Bank', categories: ['Shopping', 'Salary'] }
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      amount: 1499,
      type: 'expense',
      category: 'Shopping',
      extractedBalance: 20501,
      account: 'HDFC Bank',
    });
    expect(rows[0].tags).toContain('AI');
    expect(rows[1]).toMatchObject({ type: 'income', category: 'General', extractedBalance: null });
    expect(rows[0].id).not.toBe(rows[1].id);
  });
  test('aiParseStatement sends redacted chunks and merges rows', async () => {
    const ask = jest.fn(async () => ({
      data: { rows: [{ date: '2026-11-05', description: 'AMAZON PAY', amount: 1499, type: 'expense' }] },
    }));
    const rows = await aiParseStatement(chunk, { ask });
    expect(rows).toHaveLength(1);
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe('insights', () => {
  test('summary aggregates by month, skips transfers and old rows', () => {
    const now = new Date('2026-11-19T10:00:00Z');
    const s = buildSpendingSummary(
      [
        {
          type: 'expense',
          amount: 300,
          category: 'Food',
          merchant: 'Swiggy',
          fullDate: '2026-11-02T10:00:00Z',
        },
        {
          type: 'expense',
          amount: 200,
          category: 'Food',
          merchant: 'Swiggy',
          fullDate: '2026-11-03T10:00:00Z',
        },
        { type: 'income', amount: 50000, fullDate: '2026-10-01T10:00:00Z' },
        { type: 'transfer', amount: 9999, fullDate: '2026-11-04T10:00:00Z' },
        { type: 'expense', amount: 1, category: 'Food', fullDate: '2025-01-01T10:00:00Z' },
      ],
      { now, budgets: { Food: 4000 } }
    );
    expect(s.months.map((m) => m.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(s.months[2]).toMatchObject({
      expense: 500,
      byCategory: { Food: 500 },
      topMerchants: { Swiggy: 500 },
    });
    expect(s.months[1].income).toBe(50000);
    expect(s.monthlyBudgets).toEqual({ Food: 4000 });
  });
  test('aiInsights passes the summary and question', async () => {
    const ask = jest.fn(async () => ({ text: '• Food is up', provider: 'groq' }));
    await expect(aiInsights('Where did I overspend?', { months: [] }, { ask })).resolves.toEqual({
      text: '• Food is up',
      provider: 'groq',
    });
    expect(ask.mock.calls[0][0].prompt).toContain('Where did I overspend?');
  });
});
