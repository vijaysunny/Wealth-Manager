/**
 * Format.js  (Phase 5)
 * Small shared helpers for input validation, month navigation and money display.
 * Pure functions: unit-tested in __tests__/Format.test.js.
 */

/**
 * Parse a user-typed amount: strips ₹, commas, spaces and "Rs".
 * Returns a finite number > 0, or null when the input is empty/invalid/≤0.
 */
export const parseAmount = (input) => {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? input : null;
  const cleaned = String(input).replace(/₹|rs\.?|inr/gi, '').replace(/[,\s]/g, '');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Like parseAmount but allows 0 (e.g. a 0% rate, an optional field). Null if invalid/negative. */
export const parseNonNegative = (input) => {
  if (input === null || input === undefined || String(input).trim() === '') return null;
  const cleaned = String(input).replace(/₹|rs\.?|inr/gi, '').replace(/[,\s]/g, '');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Move a date by whole months without day-of-month overflow
 * (Jan 31 + 1 month must be February, not March). Returns a new Date on day 1.
 */
export const shiftMonth = (date, delta) => {
  const d = new Date(date);
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  return d;
};

/** True when two dates fall in the same calendar month AND year. */
export const isSameMonth = (a, b) => {
  const x = new Date(a);
  const y = new Date(b);
  return x.getMonth() === y.getMonth() && x.getFullYear() === y.getFullYear();
};

const LOCALE = 'en-IN';

/** Indian digit grouping, no symbol: 1234567 -> "12,34,567". */
export const formatNumber = (n, opts = {}) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return v.toLocaleString(LOCALE, { maximumFractionDigits: 2, ...opts });
};

/** "₹12,34,567" (negative shown as "-₹1,200"). */
export const formatMoney = (n, opts = {}) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '₹0';
  const body = Math.abs(v).toLocaleString(LOCALE, { maximumFractionDigits: 2, ...opts });
  return `${v < 0 ? '-' : ''}₹${body}`;
};

/** Safe percentage used / limit, 0 when the limit is missing or ≤0. Not clamped. */
export const safePercent = (spent, limit) => {
  const l = Number(limit);
  const s = Number(spent);
  if (!Number.isFinite(l) || l <= 0 || !Number.isFinite(s)) return 0;
  return s / l;
};
