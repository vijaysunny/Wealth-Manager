import { syncSms, computeSyncStart, SMS_FLAG_KEY, LAST_SYNC_KEY } from '../utils/SmsSync';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../components/RealSmsReader', () => ({ scanBankSms: jest.fn() }));
jest.mock('../utils/NotificationService', () => ({ sendTransactionNotification: jest.fn() }));

const HOUR = 3600 * 1000;
const NOW = new Date('2026-10-11T10:00:00Z').getTime();

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
const sms = (o = {}) => ({
  smsId: `sms:AX-HDFCBK:${NOW - HOUR}:500`,
  bodyHash: 'h1',
  refNo: null,
  date: NOW - HOUR,
  amount: 500,
  type: 'expense',
  category: 'Food',
  bankName: 'HDFC Bank',
  currentBalance: 9000,
  ...o,
});
// Fake repo save: stores what it is given (the real one is covered by TransactionRepo tests)
const deps = (storage, scanResult) => ({
  scan: jest.fn().mockResolvedValue(scanResult),
  storage,
  notify: jest.fn().mockResolvedValue(),
  save: jest.fn(async (txs) => {
    const current = JSON.parse((await storage.getItem('user_transactions')) || '[]');
    await storage.setItem('user_transactions', JSON.stringify([...txs, ...current]));
    return { added: txs.length, skipped: 0, addedTxs: txs };
  }),
  now: () => NOW,
});

describe('computeSyncStart', () => {
  test('first run looks back 24h', () => expect(computeSyncStart(null, NOW)).toBe(NOW - 24 * HOUR));
  test('uses stored marker', () =>
    expect(computeSyncStart(String(NOW - 3 * HOUR), NOW)).toBe(NOW - 3 * HOUR));
  test('caps at 90 days', () => expect(computeSyncStart('1000', NOW)).toBe(NOW - 90 * 24 * HOUR));
  test('future / garbage markers are safe', () => {
    expect(computeSyncStart(String(NOW + HOUR), NOW)).toBe(NOW);
    expect(computeSyncStart('abc', NOW)).toBe(NOW - 24 * HOUR);
  });
});

describe('syncSms', () => {
  test('saves a new transaction once, moves balances, advances marker', async () => {
    const st = mem();
    const d = deps(st, { ok: true, items: [sms()] });
    const r = await syncSms(d);
    expect(r).toEqual({ status: 'ok', added: 1 });
    expect(JSON.parse(st.m.user_transactions)).toHaveLength(1);
    expect(d.save).toHaveBeenCalledTimes(1);
    expect(st.m[LAST_SYNC_KEY]).toBe(String(NOW));
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  test('marker advances even when nothing new is found', async () => {
    const st = mem({ [LAST_SYNC_KEY]: String(NOW - 5 * HOUR) });
    const d = deps(st, { ok: true, items: [] });
    const r = await syncSms(d);
    expect(r.added).toBe(0);
    expect(st.m[LAST_SYNC_KEY]).toBe(String(NOW));
    expect(d.scan).toHaveBeenCalledWith(NOW - 5 * HOUR);
    expect(d.save).not.toHaveBeenCalled();
  });

  test('marker advances when everything found was already stored', async () => {
    const existing = [
      {
        id: 1,
        smsId: sms().smsId,
        amount: 500,
        type: 'expense',
        fullDate: new Date(NOW - HOUR).toISOString(),
        category: 'Food',
        account: 'HDFC Bank',
      },
    ];
    const st = mem({ user_transactions: JSON.stringify(existing), [LAST_SYNC_KEY]: String(NOW - 5 * HOUR) });
    const r = await syncSms(deps(st, { ok: true, items: [sms()] }));
    expect(r.added).toBe(0);
    expect(JSON.parse(st.m.user_transactions)).toHaveLength(1);
    expect(st.m[LAST_SYNC_KEY]).toBe(String(NOW));
  });

  test('failed scan (e.g. no permission) does NOT advance the marker', async () => {
    const st = mem({ [LAST_SYNC_KEY]: String(NOW - 5 * HOUR) });
    const r = await syncSms(deps(st, { ok: false, reason: 'no_permission', items: [] }));
    expect(r.status).toBe('scan_failed');
    expect(st.m[LAST_SYNC_KEY]).toBe(String(NOW - 5 * HOUR));
  });

  test('Auto-Tracking off → nothing scanned or saved', async () => {
    const st = mem({ [SMS_FLAG_KEY]: 'false' });
    const d = deps(st, { ok: true, items: [sms()] });
    const r = await syncSms(d);
    expect(r.status).toBe('disabled');
    expect(d.scan).not.toHaveBeenCalled();
    expect(st.m.user_transactions).toBeUndefined();
  });

  test('two SMS with identical amount but different times are both kept', async () => {
    const st = mem();
    const a = sms({ smsId: 'sms:X:1:100', bodyHash: 'a', amount: 100, date: NOW - 2 * HOUR });
    const b = sms({ smsId: 'sms:X:2:100', bodyHash: 'b', amount: 100, date: NOW - HOUR });
    const r = await syncSms(deps(st, { ok: true, items: [a, b] }));
    expect(r.added).toBe(2);
  });

  test('more than 3 new → one summary notification', async () => {
    const st = mem();
    const items = [1, 2, 3, 4].map((i) =>
      sms({ smsId: `sms:X:${i}:${i}00`, bodyHash: `h${i}`, amount: i * 100, date: NOW - i * HOUR })
    );
    const d = deps(st, { ok: true, items });
    await syncSms(d);
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.notify.mock.calls[0][0]).toMatch(/New transactions/);
  });

  test('notification failure does not undo the saved sync', async () => {
    const st = mem();
    const d = deps(st, { ok: true, items: [sms()] });
    d.notify.mockRejectedValue(new Error('no channel'));
    const r = await syncSms(d);
    expect(r).toEqual({ status: 'ok', added: 1 });
    expect(st.m[LAST_SYNC_KEY]).toBe(String(NOW));
  });

  test('overlapping calls share one run (no double scan)', async () => {
    const st = mem();
    const d = deps(st, { ok: true, items: [sms()] });
    const [r1, r2] = await Promise.all([syncSms(d), syncSms(d)]);
    expect(r1).toBe(r2);
    expect(d.scan).toHaveBeenCalledTimes(1);
  });

  test('B6: always saves through the repo; only rows it stored count as added', async () => {
    const st = mem();
    const d = deps(st, { ok: true, items: [sms()] });
    d.save.mockResolvedValue({ added: 0, skipped: 1, addedTxs: [] }); // e.g. a rejected capture
    const r = await syncSms(d);
    expect(d.save).toHaveBeenCalledTimes(1);
    expect(d.save.mock.calls[0][0][0]).toMatchObject({ smsId: sms().smsId, amount: 500 });
    expect(r).toEqual({ status: 'ok', added: 0 });
    expect(d.notify).not.toHaveBeenCalled();
    expect(st.m[LAST_SYNC_KEY]).toBe(String(NOW));
  });

  test('captured parser fields (last4, transfer kind) reach the saved transaction', async () => {
    const st = mem();
    const d = deps(st, {
      ok: true,
      items: [
        sms({ type: 'transfer', captured: { last4: '0973', transferKind: 'wallet_topup', flow: 'out' } }),
      ],
    });
    await syncSms(d);
    expect(d.save.mock.calls[0][0][0]).toMatchObject({
      last4: '0973',
      transferKind: 'wallet_topup',
      flow: 'out',
    });
    expect(d.notify.mock.calls[0][0]).toBe('Transfer captured');
  });

  test('scan throwing is reported as error, not thrown', async () => {
    const st = mem();
    const d = deps(st, null);
    d.scan.mockRejectedValue(new Error('x'));
    const r = await syncSms(d);
    expect(r.status).toBe('error');
  });
});
