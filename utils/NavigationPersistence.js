/**
 * Phase 13 A6.5: Android may kill the app while it is in the background. The navigation state
 * is saved (debounced) and restored on the next start when it is fresh and from the same app
 * version, so the owner comes back to the screen they left.
 */
export const NAV_STATE_KEY = 'nav_state';
export const NAV_MAX_AGE_MS = 30 * 60 * 1000;
export const NAV_SAVE_DEBOUNCE_MS = 500;

/** Returns save(state): writes { at, version, state } at most once per debounce window. */
export const makeNavSaver = (storage, version, { delay = NAV_SAVE_DEBOUNCE_MS, now = Date.now } = {}) => {
  let timer = null;
  let pending = null;
  const save = (state) => {
    pending = state;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const value = JSON.stringify({ at: now(), version, state: pending });
      Promise.resolve(storage.setItem(NAV_STATE_KEY, value)).catch(() => {});
    }, delay);
  };
  return save;
};

/** Restorable state, or undefined (start on Home) when missing, stale, another version or corrupt. */
export const loadNavState = async (storage, version, now = Date.now()) => {
  try {
    const raw = await storage.getItem(NAV_STATE_KEY);
    if (!raw) return undefined;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || !saved.state || typeof saved.state !== 'object')
      return undefined;
    if (saved.version !== version) return undefined;
    if (!(now - saved.at >= 0 && now - saved.at <= NAV_MAX_AGE_MS)) return undefined;
    return saved.state;
  } catch {
    return undefined;
  }
};

// Route params that carry a whole record: the record is refreshed from storage, and the route
// (with everything above it) is dropped when the record no longer exists.
const RECORD_PARAMS = {
  transaction: 'tx',
  asset: 'account',
  account: 'account',
  card: 'account',
  loan: 'account',
};

/**
 * Pure: replaces stored records in params with their current version. A route whose record was
 * deleted is removed together with the routes above it in that stack.
 * lookup = { tx: Map(id → tx), account: Map(id → account) }
 */
export const refreshNavState = (state, lookup) => {
  if (!state || !Array.isArray(state.routes)) return state;
  const routes = [];
  for (const route of state.routes) {
    let params = route.params;
    let gone = false;
    if (params && typeof params === 'object') {
      params = { ...params };
      for (const [key, kind] of Object.entries(RECORD_PARAMS)) {
        const rec = params[key];
        if (!rec || typeof rec !== 'object' || rec.id === undefined || rec.id === null) continue;
        const current = lookup[kind] && lookup[kind].get(String(rec.id));
        if (!current) gone = true;
        else params[key] = current;
      }
    }
    if (gone) break;
    const next = { ...route, ...(params !== undefined ? { params } : {}) };
    if (route.state) next.state = refreshNavState(route.state, lookup);
    routes.push(next);
  }
  if (!routes.length) return undefined;
  const index = Math.min(state.index ?? routes.length - 1, routes.length - 1);
  const { stale: _stale, ...rest } = state;
  return { ...rest, routes, index };
};

/** Runs fn at most once per `ms`; calls inside the window are dropped. */
export const throttleAsync = (fn, ms, now = Date.now) => {
  let last = -Infinity;
  return (...args) => {
    const t = now();
    if (t - last < ms) return Promise.resolve(false);
    last = t;
    return Promise.resolve(fn(...args)).then(() => true);
  };
};
