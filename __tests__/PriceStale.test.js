import { priceStatusLabel } from '../utils/PriceStatus';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const NOW = new Date('2026-11-18T10:00:00Z').getTime();

test('labels: fresh, stale flag, old price, manual override, non-market', () => {
  expect(priceStatusLabel({ symbol: 'X', priceAsOf: '2026-11-18T09:30:00Z' }, NOW)).toBe('');
  expect(priceStatusLabel({ symbol: 'X', priceStale: true, priceAsOf: '2026-11-16T10:00:00Z' }, NOW)).toBe(
    'Price may be stale · 2d ago'
  );
  expect(priceStatusLabel({ symbol: 'X', priceAsOf: '2026-11-17T04:00:00Z' }, NOW)).toMatch(
    /stale · 1d ago/
  );
  expect(priceStatusLabel({ symbol: 'X', priceOverride: true }, NOW)).toMatch(/Manual value/);
  expect(priceStatusLabel({ name: 'Axis' }, NOW)).toBe('');
});

test('API failure returns the last cached price marked stale (no crash)', async () => {
  const { fetchStockPrice } = require('../utils/InvestmentApi');
  const body = {
    chart: { result: [{ meta: { symbol: 'RELIANCE.NS', regularMarketPrice: 2500, previousClose: 2400 } }] },
  };
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => body });
  const fresh = await fetchStockPrice('RELIANCE.NS');
  expect(fresh).toMatchObject({ price: 2500, stale: false });
  const realNow = Date.now;
  Date.now = () => realNow() + 60 * 60 * 1000; // past the 15-min TTL
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  const stale = await fetchStockPrice('RELIANCE.NS');
  Date.now = realNow;
  expect(stale).toMatchObject({ price: 2500, stale: true });
  expect(await fetchStockPrice('NEVERSEEN.NS')).toBeNull();
});
