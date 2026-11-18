import { collectPages } from '../utils/SmsScan';
import { isTransactionalSender } from '../utils/TransactionParser';

const makeSource = (n) => {
  const all = Array.from({ length: n }, (_, i) => ({ _id: i }));
  const calls = [];
  const fetchPage = async (from, count) => {
    calls.push([from, count]);
    return all.slice(from, from + count);
  };
  return { fetchPage, calls };
};

describe('collectPages (no 300-message cap)', () => {
  test('pages through 1,250 messages with page size 500', async () => {
    const s = makeSource(1250);
    const { messages, truncated } = await collectPages(s.fetchPage, { pageSize: 500, maxTotal: 10000 });
    expect(messages).toHaveLength(1250);
    expect(truncated).toBe(false);
    expect(s.calls).toEqual([
      [0, 500],
      [500, 500],
      [1000, 500],
    ]);
  });
  test('exact multiple of page size ends with one empty page', async () => {
    const s = makeSource(1000);
    const { messages } = await collectPages(s.fetchPage, { pageSize: 500 });
    expect(messages).toHaveLength(1000);
    expect(s.calls).toHaveLength(3);
  });
  test('empty inbox', async () => {
    const { messages, truncated } = await collectPages(makeSource(0).fetchPage);
    expect(messages).toEqual([]);
    expect(truncated).toBe(false);
  });
  test('safety ceiling reports truncated', async () => {
    const { messages, truncated } = await collectPages(makeSource(5000).fetchPage, {
      pageSize: 500,
      maxTotal: 1200,
    });
    expect(messages).toHaveLength(1200);
    expect(truncated).toBe(true);
  });
  test('a failing page rejects (caller can tell failure from empty)', async () => {
    await expect(
      collectPages(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });
  test('non-array page rejects', async () => {
    await expect(collectPages(async () => null)).rejects.toThrow();
  });
});

describe('isTransactionalSender', () => {
  test.each([
    'AX-HDFCBK',
    'VM-SBIUPI',
    'JD-ICICIT-S',
    'BP-AXISBK',
    'AD-KOTAKB',
    'VK-PAYTMB',
    'CP-CENTBK',
    'HDFCBK',
    'JKBANK',
    'ATMSBI',
    'AM-JIOPAY',
  ])('accepts %s', (s) => expect(isTransactionalSender(s)).toBe(true));
  test.each(['+919876543210', '9876543210', '56767', '+91 98765 43210', '', null, undefined])(
    'rejects personal / numeric %p',
    (s) => expect(isTransactionalSender(s)).toBe(false)
  );
});
