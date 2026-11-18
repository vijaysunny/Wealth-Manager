/** PriceStatus.js (plan B3) - pure label for market-priced holdings. */
const HOUR = 3600000;
const age = (ms) =>
  ms < HOUR
    ? 'just now'
    : ms < 24 * HOUR
      ? `${Math.round(ms / HOUR)}h ago`
      : `${Math.round(ms / (24 * HOUR))}d ago`;

/** Text to show under a holding, or '' when the price is fresh. */
export const priceStatusLabel = (account, now = Date.now()) => {
  if (!account || !account.symbol) return '';
  if (account.priceOverride) return 'Manual value (live price paused)';
  const t = account.priceAsOf ? new Date(account.priceAsOf).getTime() : NaN;
  if (account.priceStale) return `Price may be stale · ${Number.isFinite(t) ? age(now - t) : 'unknown age'}`;
  if (Number.isFinite(t) && now - t > 24 * HOUR) return `Price may be stale · ${age(now - t)}`;
  return '';
};
