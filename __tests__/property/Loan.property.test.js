/** Phase 13 D1: outstanding never rises month by month, never goes below 0, and is 0 at the end. */
import fc from 'fast-check';
import { emiFor, emiDate, calculateOutstandingBalance } from '../../utils/LoanCalculator';

test('reducing loans: non-increasing, ≥ 0, 0 after the last EMI', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1000, max: 10000000 }),
      fc.double({ min: 0, max: 36, noNaN: true }),
      fc.integer({ min: 1, max: 360 }),
      (amount, rate, months) => {
        const loan = {
          originalAmount: amount,
          interestRate: rate,
          tenure: months,
          emiAmount: emiFor(amount, rate, months),
          firstEmiDate: new Date(2026, 0, 31, 12),
          loanType: rate === 0 ? 'No Cost EMI' : 'Reducing',
        };
        let prev = Infinity;
        const step = Math.max(1, Math.floor(months / 24));
        for (let k = 0; k <= months; k += step) {
          const at = k === 0 ? new Date(2026, 0, 1) : emiDate(loan, k);
          const owed = calculateOutstandingBalance(loan, at);
          expect(owed).toBeGreaterThanOrEqual(0);
          expect(owed).toBeLessThanOrEqual(prev + 0.001);
          prev = owed;
        }
        expect(calculateOutstandingBalance(loan, emiDate(loan, months))).toBe(0);
      }
    ),
    { numRuns: 150 }
  );
});
