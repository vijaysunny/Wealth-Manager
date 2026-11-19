import { aiParseUnparsed, aiCategorizeNew, AI_SEEN_KEY, MAX_AI_SMS_PER_RUN } from '../../utils/ai/AiSync';
import { syncSms } from '../../utils/SmsSync';
import { hashText } from '../../utils/DeduplicationEngine';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null) }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../../components/RealSmsReader', () => ({ scanBankSms: jest.fn() }));
jest.mock('../../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));

const NOW = new Date('2026-11-19T10:00:00Z').getTime();
const mem = (init = {}) => {
  const m = { ...init };
  return {
    m,
    getItem: async (k) => (k in m ? m[k] : null),
    setItem: async (k, v) => {
      m[k] = v;
    },
  };
};
const raw = (n) => ({
  id: n,
  sender: 'VM-NEWBNK',
  date: NOW - n * 1000,
  body: `NewBank Rs ${100 + n} paid txn ${n}`,
});
const item = (o = {}) => ({
  smsId: 'sms:VM-NEWBNK:1:101',
  bodyHash: 'hx',
  date: NOW - 1000,
  amount: 101,
  type: 'expense',
  category: 'General',
  merchant: null,
  bankName: 'NewBank',
  captured: { aiParsed: true },
  ...o,
});

describe('aiParseUnparsed', () => {
  test('off → no AI call', async () => {
    const ai = { ready: async () => false, parseSms: jest.fn() };
    await expect(aiParseUnparsed([raw(1)], mem(), ai)).resolves.toEqual([]);
    expect(ai.parseSms).not.toHaveBeenCalled();
  });

  test('sends each SMS once, newest first, capped per run', async () => {
    const st = mem({ [AI_SEEN_KEY]: JSON.stringify([hashText(raw(1).body)]) });
    const ai = { ready: async () => true, parseSms: jest.fn(async () => [item()]) };
    const list = Array.from({ length: MAX_AI_SMS_PER_RUN + 5 }, (_, i) => raw(i + 1));
    await aiParseUnparsed(list, st, ai);
    const sent = ai.parseSms.mock.calls[0][0];
    expect(sent).toHaveLength(MAX_AI_SMS_PER_RUN);
    expect(sent.map((s) => s.id)).not.toContain(1); // already seen
    expect(sent[0].id).toBe(2); // newest first
    const seen = JSON.parse(st.m[AI_SEEN_KEY]);
    expect(seen).toHaveLength(MAX_AI_SMS_PER_RUN + 1);
    // second run: those are now skipped
    ai.parseSms.mockClear();
    await aiParseUnparsed(list.slice(1, 5), st, ai);
    expect(ai.parseSms).not.toHaveBeenCalled();
  });

  test('AI failure is swallowed', async () => {
    const ai = { ready: async () => true, parseSms: jest.fn().mockRejectedValue(new Error('x')) };
    await expect(aiParseUnparsed([raw(1)], mem(), ai)).resolves.toEqual([]);
  });
});

test('aiCategorizeNew only touches General rows and retitles category-titled rows', async () => {
  const ai = {
    ready: async () => true,
    categorize: jest.fn(async (txs) => new Map(txs.map((t) => [t.id, 'Food']))),
  };
  const out = await aiCategorizeNew(
    [
      { id: 1, title: 'General', category: 'General', type: 'expense', tags: ['Auto-Sync'] },
      { id: 2, title: 'Swiggy', merchant: 'Swiggy', category: 'General', type: 'expense' },
      { id: 3, title: 'Bills', category: 'Bills', type: 'expense' },
      { id: 4, title: 'General', category: 'General', type: 'transfer' },
    ],
    mem(),
    ai
  );
  expect(ai.categorize.mock.calls[0][0].map((t) => t.id)).toEqual([1, 2]);
  expect(out[0]).toMatchObject({ category: 'Food', title: 'Food', tags: ['Auto-Sync', 'AI'] });
  expect(out[1]).toMatchObject({ category: 'Food', title: 'Swiggy' });
  expect(out[2].category).toBe('Bills');
  expect(out[3].category).toBe('General');
});

test('syncSms saves AI-read SMS alongside parsed ones, tagged AI', async () => {
  const st = mem();
  const save = jest.fn(async (txs) => ({ addedTxs: txs }));
  const ai = {
    ready: async () => true,
    parseSms: jest.fn(async () => [item()]),
    categorize: jest.fn(async () => new Map()),
  };
  const res = await syncSms({
    scan: async () => ({ ok: true, items: [], unparsed: [raw(1)] }),
    storage: st,
    notify: jest.fn(),
    save,
    now: () => NOW,
    ai,
  });
  expect(res).toEqual({ status: 'ok', added: 1 });
  expect(save.mock.calls[0][0][0]).toMatchObject({ amount: 101, tags: ['Auto-Sync', 'AI'], aiParsed: true });
});
