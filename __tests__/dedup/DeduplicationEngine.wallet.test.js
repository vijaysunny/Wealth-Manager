import { filterNew } from '../../utils/DeduplicationEngine';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const DAY = '2026-11-07T04:16:28.000Z';
const smsTopup = (o = {}) => ({
  id: 's1',
  smsId: 'sms:AX-AXISBK:1:500.00',
  type: 'transfer',
  transferKind: 'wallet_topup',
  flow: 'out',
  amount: 500,
  account: 'Axis Bank',
  accountId: 'axis',
  refNo: '01007102616409005179402498474608827',
  title: 'Wallet Top-up',
  fullDate: DAY,
  ...o,
});
const linked = (o = {}) => smsTopup({ toAccountId: 'lite', toAccount: 'UPI Lite', ...o });
const stmt = (o = {}) => ({
  id: `stmt_${Math.random()}`,
  type: 'expense',
  amount: 500,
  account: 'Axis Bank',
  title: 'UPI LITE TOPUP',
  note: '',
  fullDate: '2026-11-07T12:00:00.000Z',
  ...o,
});

describe('statement row vs SMS wallet transfer (A3, A7.3)', () => {
  test('bank statement debit with UPI Lite narration dedupes against the one-sided SMS top-up', () => {
    expect(filterNew([stmt()], [smsTopup()])).toHaveLength(0);
  });
  test('…and against the linked transfer; the wallet-side credit dedupes against the other leg', () => {
    expect(filterNew([stmt()], [linked()])).toHaveLength(0);
    expect(
      filterNew([stmt({ type: 'income', account: 'UPI Lite', title: 'Added to UPI Lite' })], [linked()])
    ).toHaveLength(0);
  });
  test('shortened reference on the statement still matches', () => {
    expect(
      filterNew([stmt({ title: 'UPI/0100710261640900', refNo: '0100710261640900' })], [smsTopup()])
    ).toHaveLength(0);
  });
  test('two top-ups same day: two statement rows dedupe, a third identical row is new (A7.5)', () => {
    const existing = [
      smsTopup(),
      smsTopup({ id: 's2', smsId: 'sms:AX-AXISBK:2:500.00', refNo: 'R2XXXXXXXX' }),
    ];
    const rows = [
      stmt({ title: 'UPI LITE TOPUP' }),
      stmt({ title: 'UPI LITE TOPUP' }),
      stmt({ title: 'UPI LITE TOPUP' }),
    ];
    expect(filterNew(rows, existing)).toHaveLength(1);
  });
  test('unrelated same-amount debit the same day is NOT swallowed', () => {
    expect(filterNew([stmt({ title: 'ZOMATO ORDER' })], [smsTopup()])).toHaveLength(1);
  });
  test('different references are different payments', () => {
    expect(filterNew([stmt({ refNo: '999999999999' })], [smsTopup({ refNo: '111111111111' })])).toHaveLength(
      1
    );
  });
  test('statement row already classified as a transfer still matches (A5)', () => {
    expect(
      filterNew([stmt({ type: 'transfer', flow: 'out', transferKind: 'wallet_topup' })], [smsTopup()])
    ).toHaveLength(0);
  });
  test('two different SMS (expense vs transfer) same amount/day stay two', () => {
    const smsExpense = {
      id: 'e',
      smsId: 'sms:X:9:500.00',
      type: 'expense',
      amount: 500,
      account: 'Axis Bank',
      fullDate: DAY,
    };
    expect(filterNew([smsExpense], [smsTopup()])).toHaveLength(1);
  });
});
