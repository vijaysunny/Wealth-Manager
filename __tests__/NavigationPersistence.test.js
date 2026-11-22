/** Phase 13 A6.5/A6.7: navigation state survives the app being killed; catch-up is throttled. */
import {
  NAV_STATE_KEY,
  NAV_MAX_AGE_MS,
  makeNavSaver,
  loadNavState,
  refreshNavState,
  throttleAsync,
} from '../utils/NavigationPersistence';

const memStorage = () => {
  const m = new Map();
  return {
    m,
    getItem: jest.fn(async (k) => (m.has(k) ? m.get(k) : null)),
    setItem: jest.fn(async (k, v) => m.set(k, v)),
  };
};
const navState = { index: 1, routes: [{ name: 'Main' }, { name: 'Transactions' }] };

describe('save', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('debounced: three quick changes → one write of the last state', () => {
    const s = memStorage();
    const save = makeNavSaver(s, '3.0.0', { now: () => 1000 });
    save({ a: 1 });
    jest.advanceTimersByTime(200);
    save({ a: 2 });
    save(navState);
    jest.advanceTimersByTime(499);
    expect(s.setItem).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(s.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(s.m.get(NAV_STATE_KEY))).toEqual({ at: 1000, version: '3.0.0', state: navState });
  });
  test('a failing storage write is swallowed', async () => {
    const save = makeNavSaver({ setItem: () => Promise.reject(new Error('x')) }, '1');
    save(navState);
    jest.runAllTimers();
  });
});

describe('load', () => {
  const put = (s, v) => s.m.set(NAV_STATE_KEY, typeof v === 'string' ? v : JSON.stringify(v));
  test('restored when fresh and the version matches', async () => {
    const s = memStorage();
    put(s, { at: 1000, version: '3.0.0', state: navState });
    expect(await loadNavState(s, '3.0.0', 1000 + 60 * 1000)).toEqual(navState);
  });
  test('ignored when older than 30 min, another version, corrupt, missing or from the future', async () => {
    const s = memStorage();
    expect(await loadNavState(s, '3.0.0', 5)).toBeUndefined();
    put(s, { at: 0, version: '3.0.0', state: navState });
    expect(await loadNavState(s, '3.0.0', NAV_MAX_AGE_MS + 1)).toBeUndefined();
    expect(await loadNavState(s, '3.1.0', 10)).toBeUndefined();
    expect(await loadNavState(s, '3.0.0', -10)).toBeUndefined();
    put(s, '{not json');
    expect(await loadNavState(s, '3.0.0', 10)).toBeUndefined();
    put(s, { at: 0, version: '3.0.0' });
    expect(await loadNavState(s, '3.0.0', 10)).toBeUndefined();
    put(s, 'null');
    expect(await loadNavState(s, '3.0.0', 10)).toBeUndefined();
  });
});

describe('refreshNavState', () => {
  const lookup = {
    tx: new Map([['t1', { id: 't1', amount: 99 }]]),
    account: new Map([['a1', { id: 'a1', name: 'Axis' }]]),
  };
  test('records in params are replaced by their current version', () => {
    const state = {
      index: 1,
      stale: false,
      routes: [
        { name: 'Main', state: { index: 0, routes: [{ name: 'HomeTab' }] } },
        { name: 'TransactionDetail', params: { transaction: { id: 't1', amount: 5 } } },
      ],
    };
    const out = refreshNavState(state, lookup);
    expect(out.routes[1].params.transaction.amount).toBe(99);
    expect(out.routes[0].state.routes[0].name).toBe('HomeTab');
    expect(out.stale).toBeUndefined();
  });
  test('a deleted record drops its route and those above it', () => {
    const state = {
      index: 2,
      routes: [
        { name: 'Main' },
        { name: 'TransactionDetail', params: { transaction: { id: 'gone' } } },
        { name: 'EditAsset', params: { asset: { id: 'a1' } } },
      ],
    };
    const out = refreshNavState(state, lookup);
    expect(out.routes.map((r) => r.name)).toEqual(['Main']);
    expect(out.index).toBe(0);
  });
  test('first route gone → undefined; non-record params kept; bad input returned as is', () => {
    expect(refreshNavState({ routes: [{ name: 'X', params: { asset: { id: 'nope' } } }] }, lookup)).toBe(
      undefined
    );
    const keep = refreshNavState(
      { routes: [{ name: 'Transactions', params: { filter: 'card', asset: 'x' } }] },
      lookup
    );
    expect(keep.routes[0].params).toEqual({ filter: 'card', asset: 'x' });
    expect(keep.index).toBe(0);
    expect(refreshNavState(null, lookup)).toBeNull();
    expect(refreshNavState({ routes: [{ name: 'A', params: { asset: { id: 'a1' } } }] }, {})).toBeUndefined();
  });
});

test('catch-up throttle: 3 active events within 5 min → 1 run; a later one runs again', async () => {
  let t = 0;
  const fn = jest.fn(async () => {});
  const run = throttleAsync(fn, 5 * 60 * 1000, () => t);
  await run();
  t = 60 * 1000;
  await run();
  t = 4 * 60 * 1000;
  expect(await run()).toBe(false);
  expect(fn).toHaveBeenCalledTimes(1);
  t = 5 * 60 * 1000 + 1;
  expect(await run()).toBe(true);
  expect(fn).toHaveBeenCalledTimes(2);
});
