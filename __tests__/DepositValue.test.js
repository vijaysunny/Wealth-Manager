import { fdValue, rdValue, addMonths, depositValue, maturityOf } from '../utils/DepositValue';

const at = (s) => new Date(`${s}T12:00:00`);

test('addMonths keeps the day, clamps to month end', () => {
  expect(addMonths(at('2026-01-31'), 1).getDate()).toBe(28);
  expect(addMonths(at('2026-01-15'), 3).getMonth()).toBe(3);
});

test('FD quarterly: 1 lakh at 7% for one year = 107,185.90', () => {
  const fd = { principal: 100000, ratePct: 7, startDate: at('2025-01-01') };
  expect(fdValue(fd, at('2026-01-01'))).toBe(107185.9);
  // half a quarter after: simple interest on the compounded amount
  expect(fdValue(fd, at('2025-02-15'))).toBeCloseTo(100000 * (1 + (0.07 * 45) / 365), 1);
  expect(fdValue(fd, at('2024-12-01'))).toBe(100000);
});

test('FD monthly and simple; capped at maturity; bad input', () => {
  const base = { principal: 50000, ratePct: 6, startDate: at('2025-01-01') };
  expect(fdValue({ ...base, compounding: 'monthly' }, at('2026-01-01'))).toBeCloseTo(
    50000 * Math.pow(1.005, 12),
    1
  );
  expect(fdValue({ ...base, compounding: 'simple' }, at('2026-01-01'))).toBe(53000);
  const capped = fdValue({ ...base, maturityDate: at('2025-07-01') }, at('2030-01-01'));
  expect(capped).toBe(fdValue(base, at('2025-07-01')));
  expect(fdValue({ principal: 0 })).toBe(0);
  expect(fdValue({ principal: 100, ratePct: 0, startDate: at('2025-01-01') })).toBe(100);
  expect(fdValue({ principal: 100, ratePct: 5, startDate: 'junk' })).toBe(100);
});

test('FD value never goes down over time', () => {
  const fd = { principal: 25000, ratePct: 7.1, startDate: at('2025-03-10') };
  let prev = 0;
  for (let d = 0; d < 800; d += 7) {
    const v = fdValue(fd, new Date(at('2025-03-10').getTime() + d * 86400000));
    expect(v).toBeGreaterThanOrEqual(prev);
    prev = v;
  }
});

test('RD: 1,000 a month at 7% for 12 months ≈ 12,4xx at maturity; partial before', () => {
  const rd = { monthly: 1000, ratePct: 7, startDate: at('2025-01-05'), months: 12 };
  const end = rdValue(rd, at('2026-01-05'));
  expect(end).toBeGreaterThan(12400);
  expect(end).toBeLessThan(12500);
  expect(rdValue(rd, at('2027-06-01'))).toBe(end); // stops at maturity
  expect(rdValue(rd, at('2025-01-05'))).toBe(1000); // first instalment only
  expect(rdValue(rd, at('2025-03-06'))).toBeGreaterThan(3000);
  expect(rdValue(rd, at('2024-12-01'))).toBe(0);
  expect(rdValue({ monthly: 0 })).toBe(0);
});

test('depositValue and maturityOf read account fields', () => {
  const fd = {
    subType: 'Fixed Deposit',
    principal: 100000,
    interestRate: 7,
    startDate: '2025-01-01T12:00:00',
    maturityDate: '2027-01-01T12:00:00',
  };
  expect(depositValue(fd, at('2026-01-01'))).toBe(107185.9);
  expect(maturityOf(fd).getFullYear()).toBe(2027);
  const rd = {
    subType: 'Recurring Deposit',
    monthly: 1000,
    interestRate: 7,
    startDate: '2025-01-05T12:00:00',
    tenure: 12,
  };
  expect(depositValue(rd, at('2025-01-05'))).toBe(1000);
  expect(maturityOf(rd).getMonth()).toBe(0);
  expect(maturityOf(rd).getFullYear()).toBe(2026);
  expect(depositValue({ subType: 'Fixed Deposit', balance: 5 })).toBeNull();
  expect(depositValue({ subType: 'Provident Fund', interestRate: 8, startDate: '2025-01-01' })).toBeNull();
  expect(maturityOf({ subType: 'Fixed Deposit' })).toBeNull();
  expect(maturityOf(null)).toBeNull();
});
