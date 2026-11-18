import Storage from '../data/Storage';
const memory = new Map();
const pending = new Map();
const TTL = 15 * 60 * 1000;
/**
 * Cached JSON fetch (15 min). B3: when the network/API fails and an older copy exists, that
 * copy is returned instead of failing; fetchCachedJsonMeta says how old it is.
 */
export const fetchCachedJson = async (url) => (await fetchCachedJsonMeta(url)).data;
export const fetchCachedJsonMeta = async (url) => {
  const now = Date.now();
  const key = 'price_cache_' + encodeURIComponent(url);
  let cached = memory.get(url);
  if (!cached) {
    try {
      cached = JSON.parse((await Storage.getItem(key)) || 'null');
    } catch {
      /* no cache */
    }
  }
  if (cached && now - cached.time < TTL) return { data: cached.data, time: cached.time, stale: false };
  if (pending.has(url)) return pending.get(url);
  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Price fetch ${response.status}`);
      const data = await response.json();
      const record = { time: Date.now(), data };
      memory.set(url, record);
      await Storage.setItem(key, JSON.stringify(record));
      return { data, time: record.time, stale: false };
    } catch (error) {
      if (cached) return { data: cached.data, time: cached.time, stale: true }; // last known value
      throw error;
    } finally {
      clearTimeout(timer);
      pending.delete(url);
    }
  })();
  pending.set(url, promise);
  return promise;
};
