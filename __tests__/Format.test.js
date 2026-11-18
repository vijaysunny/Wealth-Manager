import { parseAmount, parseNonNegative, shiftMonth, isSameMonth, formatMoney, formatNumber, safePercent } from '../utils/Format';

describe('parseAmount', () => {
  test.each([
    ['1,200', 1200], ['₹1,20,000', 120000], ['Rs. 500', 500], ['  99.50 ', 99.5],
    ['1,23,456.78', 123456.78], ['.5', 0.5], [250, 250],
  ])('%p -> %p', (input, out) => expect(parseAmount(input)).toBe(out));

  test.each([[''], ['   '], ['abc'], ['12abc'], ['0'], ['-5'], ['1.2.3'], [null], [undefined], [NaN], [0], [-1], ['--5'], ['1e5']])(
    'rejects %p', (input) => expect(parseAmount(input)).toBeNull());
});

describe('parseNonNegative', () => {
  test('allows zero, rejects empty / negative / junk', () => {
    expect(parseNonNegative('0')).toBe(0);
    expect(parseNonNegative('12.5')).toBe(12.5);
    expect(parseNonNegative('')).toBeNull();
    expect(parseNonNegative('-1')).toBeNull();
    expect(parseNonNegative('x')).toBeNull();
  });
});

describe('shiftMonth', () => {
  test('Jan 31 + 1 is February, not March', () => {
    const d = shiftMonth(new Date(2026, 0, 31), 1);
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 1, 1]);
  });
  test('Mar 31 - 1 is February', () => {
    const d = shiftMonth(new Date(2026, 2, 31), -1);
    expect([d.getFullYear(), d.getMonth()]).toEqual([2026, 1]);
  });
  test('crosses year boundaries both ways', () => {
    expect(shiftMonth(new Date(2026, 11, 15), 1).getFullYear()).toBe(2027);
    expect(shiftMonth(new Date(2026, 0, 15), -1).getMonth()).toBe(11);
  });
  test('12 steps of -1 from Jan 31 visits every month once', () => {
    let d = new Date(2026, 0, 31); const seen = [];
    for (let i = 0; i < 12; i++) { d = shiftMonth(d, -1); seen.push(d.getMonth()); }
    expect(new Set(seen).size).toBe(12);
  });
  test('does not mutate input', () => {
    const d = new Date(2026, 0, 31); shiftMonth(d, 1); expect(d.getDate()).toBe(31);
  });
});

describe('isSameMonth', () => {
  test('compares month AND year', () => {
    expect(isSameMonth(new Date(2026, 4, 1), new Date(2026, 4, 30))).toBe(true);
    expect(isSameMonth(new Date(2025, 4, 1), new Date(2026, 4, 1))).toBe(false);
  });
});

describe('money formatting', () => {
  test('Indian grouping', () => {
    expect(formatMoney(1234567)).toBe('₹12,34,567');
    expect(formatNumber(100000)).toBe('1,00,000');
  });
  test('negative and invalid', () => {
    expect(formatMoney(-1200)).toBe('-₹1,200');
    expect(formatMoney(NaN)).toBe('₹0');
  });
  test('max two decimals', () => expect(formatMoney(10.456)).toBe('₹10.46'));
});

describe('safePercent', () => {
  test('no divide-by-zero', () => {
    expect(safePercent(500, 0)).toBe(0);
    expect(safePercent(500, null)).toBe(0);
    expect(safePercent(500, 1000)).toBe(0.5);
    expect(safePercent(1500, 1000)).toBe(1.5);
  });
});
