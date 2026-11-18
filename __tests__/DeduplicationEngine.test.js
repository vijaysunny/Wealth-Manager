import AsyncStorage from '../data/Storage';
import {
  isDuplicate,
  filterNew,
  mergeTransactions,
  saveWithDedup,
  buildSmsId,
  hashText,
  createDedupIndex,
} from '../utils/DeduplicationEngine';
import { parseStatementRows, parseTransactionText, extractRefNo } from '../utils/TransactionParser';

// babel-jest hoists this above the imports
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const at = (iso, extra = {}) => ({
  id: Math.random(),
  amount: 100,
  type: 'expense',
  account: 'HDFC Bank',
  category: 'Food',
  title: 'Food',
  fullDate: new Date(iso).toISOString(),
  ...extra,
});
const sms = (iso, amount, address = 'VK-HDFCBK', extra = {}) => {
  const ms = new Date(iso).getTime();
  return at(iso, { amount, smsId: buildSmsId(address, ms, amount), ...extra });
};

beforeEach(() => AsyncStorage.clear());

describe('smsId (C6)', () => {
  test('same SMS gives the same ID regardless of path / casing / spacing', () => {
    const ms = 1704450000000;
    expect(buildSmsId('vk-hdfcbk', ms, 500)).toBe(buildSmsId(' VK-HDFCBK ', ms, '500.00'));
    expect(buildSmsId('VK-HDFCBK', ms, 500)).toBe('sms:VK-HDFCBK:1704450000000:500.00');
  });

  test('listener and inbox scan hit the hard ID match', () => {
    const a = sms('2024-01-05T10:00:00Z', 250);
    const b = sms('2024-01-05T10:00:00Z', 250);
    expect(isDuplicate(b, [a])).toBe(true);
  });

  test('same SMS with timestamps a few seconds apart is caught by body hash', () => {
    const body = 'Rs 250 debited from A/c XX11 on 05-Jan UPI Ref 401234567890. Avl Bal Rs 900';
    const stored = sms('2024-01-05T10:00:00Z', 250, 'VK-HDFCBK', { bodyHash: hashText(body) });
    const scanned = sms('2024-01-05T10:00:04Z', 250, 'VK-HDFCBK', { bodyHash: hashText(body.toUpperCase()) });
    expect(scanned.smsId).not.toBe(stored.smsId);
    expect(isDuplicate(scanned, [stored])).toBe(true);
  });
});

describe('never drop a real transaction (C5)', () => {
  test('two ₹100 UPI payments on one day are both kept (different SMS)', () => {
    const first = sms('2024-01-05T10:00:00Z', 100, 'VK-HDFCBK', {
      bodyHash: hashText('Rs 100 debited ... Bal 900'),
    });
    const second = sms('2024-01-05T10:02:00Z', 100, 'VK-HDFCBK', {
      bodyHash: hashText('Rs 100 debited ... Bal 800'),
    });
    expect(isDuplicate(second, [first])).toBe(false);
    expect(filterNew([first, second], [])).toHaveLength(2);
  });

  test('two ₹100 statement rows with different narrations are both kept', () => {
    const a = at('2024-01-05T12:00:00Z', { title: 'UPI/TEA STALL/401', source: 'statement' });
    const b = at('2024-01-05T12:00:00Z', { title: 'UPI/BUS FARE/402', source: 'statement' });
    expect(isDuplicate(b, [a])).toBe(false);
  });

  test('manual entry without any reference is not swallowed by a statement row', () => {
    const manual = at('2024-01-05T09:30:00Z', { title: 'Lunch' });
    const stmt = at('2024-01-05T12:00:00Z', { title: 'UPI/CAFE/9', source: 'statement' });
    expect(isDuplicate(stmt, [manual])).toBe(false);
  });

  test('two ₹499 subscriptions with different merchants both survive', () => {
    const netflix = at('2024-01-05T05:00:00Z', {
      amount: 499,
      title: 'Netflix',
      category: 'Bills',
      id: 'rec_1_1',
    });
    const hotstar = at('2024-01-05T05:00:00Z', {
      amount: 499,
      title: 'Hotstar',
      category: 'Bills',
      id: 'rec_2_1',
    });
    expect(filterNew([netflix, hotstar], [])).toHaveLength(2);
    expect(filterNew([hotstar], [netflix])).toHaveLength(1);
  });

  test('recurring entry is not re-created (hard ID)', () => {
    const r = at('2024-01-05T05:00:00Z', { id: 'rec_7_1704430800000', title: 'Rent' });
    expect(isDuplicate({ ...r }, [r])).toBe(true);
  });
});

describe('never double-count the same transaction', () => {
  test('SMS + Gmail for the same payment keep one', () => {
    const s = sms('2024-01-05T10:00:00Z', 750);
    const g = at('2024-01-05T10:03:00Z', { amount: 750, gmailMsgId: 'g123' });
    expect(isDuplicate(g, [s])).toBe(true);
  });

  test('SMS + delayed Gmail (>5 min) still match on the same reference', () => {
    const s = sms('2024-01-05T10:00:00Z', 750, 'VK-HDFCBK', { refNo: '401234567890' });
    const g = at('2024-01-05T10:40:00Z', { amount: 750, gmailMsgId: 'g9', refNo: '401234567890' });
    expect(isDuplicate(g, [s])).toBe(true);
  });

  test('SMS + Gmail with different references are different payments', () => {
    const s = sms('2024-01-05T10:00:00Z', 750, 'VK-HDFCBK', { refNo: '401234567890' });
    const g = at('2024-01-05T10:01:00Z', { amount: 750, gmailMsgId: 'g9', refNo: '999999999999' });
    expect(isDuplicate(g, [s])).toBe(false);
  });

  test('bank statement row matches an SMS by reference', () => {
    const s = sms('2024-01-05T10:00:00Z', 450, 'VK-HDFCBK', { refNo: '401234567890' });
    const stmt = at('2024-01-05T12:00:00Z', {
      amount: 450,
      title: 'UPI/401234567890/ZOMATO',
      source: 'statement',
      refNo: '401234567890',
    });
    expect(isDuplicate(stmt, [s])).toBe(true);
  });
});

describe('statement imports', () => {
  const rows = [
    ['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance'],
    ['05/01/24', 'UPI-CHAI POINT', '', '05/01/24', '100.00', '', '9,900.00'],
    ['05/01/24', 'UPI-CHAI POINT', '', '05/01/24', '100.00', '', '9,800.00'],
    ['06/01/24', 'SALARY', 'N0001XYZ', '06/01/24', '', '50,000.00', '59,800.00'],
  ];
  const parse = () => parseStatementRows(rows, 'HDFC Bank');

  test('same statement imported twice adds nothing the second time', () => {
    const first = mergeTransactions(parse(), []);
    expect(first.added).toBe(3);
    const second = mergeTransactions(parse(), first.merged);
    expect(second.added).toBe(0);
    expect(second.skipped).toBe(3);
    expect(second.merged).toHaveLength(3);
  });

  test('occurrence counting: two identical ₹100 rows vs one stored → import one more', () => {
    const [r1, r2] = parse();
    const identical = { ...r2, extractedBalance: null };
    const stored = [{ ...r1, extractedBalance: null }];
    const { added, merged } = mergeTransactions([{ ...r1, extractedBalance: null }, identical], stored);
    expect(added).toBe(1);
    expect(merged).toHaveLength(2);
  });

  test('two identical rows imported into an empty store are both kept', () => {
    const [r1, r2] = parse();
    const { added } = mergeTransactions(
      [
        { ...r1, extractedBalance: null },
        { ...r2, extractedBalance: null },
      ],
      []
    );
    expect(added).toBe(2);
  });
});

describe('saveWithDedup persistence + index', () => {
  test('persists once and ignores repeats', async () => {
    const tx = sms('2024-01-05T10:00:00Z', 321);
    const first = await saveWithDedup([tx]);
    expect(first).toMatchObject({ added: 1, skipped: 0 });
    expect(first.addedTxs).toHaveLength(1);
    expect(await saveWithDedup([{ ...tx }])).toMatchObject({ added: 0, skipped: 1, addedTxs: [] });
    expect(JSON.parse(await AsyncStorage.getItem('user_transactions'))).toHaveLength(1);
  });

  test('index handles a large store quickly (no O(n×m) scan)', () => {
    const existing = Array.from({ length: 5000 }, (_, i) =>
      at(new Date(2024, 0, 1 + (i % 28), 10, 0, 0).toISOString(), { amount: 10 + i, title: `T${i}` })
    );
    const t0 = Date.now();
    const idx = createDedupIndex(existing);
    for (let i = 0; i < 2000; i++) idx.check(at('2024-02-01T10:00:00Z', { amount: 9000 + i }));
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('ref extraction feeds dedup', () => {
  test('SMS parse exposes refNo', () => {
    const r = parseTransactionText(
      'ICICI Bank Acct XX123 debited for Rs 500.00; UPI:401234567890. Avl Bal Rs 12,345.67',
      { sender: 'VK-ICICIB' }
    );
    expect(r.refNo).toBe('401234567890');
    expect(extractRefNo('no reference here')).toBeNull();
  });
});
