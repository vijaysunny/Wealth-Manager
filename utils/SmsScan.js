/**
 * SmsScan.js  (Phase 6)
 * Pure helper that pages through an SMS source so a scan is no longer capped at 300 messages.
 * Kept free of React Native imports so it can be unit-tested.
 */

/**
 * @param {(indexFrom:number, count:number) => Promise<Array>} fetchPage  returns one page (newest first)
 * @param {{pageSize?:number, maxTotal?:number}} opts
 * @returns {Promise<{messages:Array, truncated:boolean}>}
 *   truncated = true when stopped by maxTotal while more pages may exist.
 * Rejects if a page fails, so callers can tell "no messages" from "scan failed".
 */
export const collectPages = async (fetchPage, { pageSize = 500, maxTotal = 10000 } = {}) => {
  const messages = [];
  let index = 0;
  while (messages.length < maxTotal) {
    const want = Math.min(pageSize, maxTotal - messages.length);
    const page = await fetchPage(index, want);
    if (!Array.isArray(page)) throw new Error('Invalid SMS page');
    messages.push(...page);
    if (page.length < want) return { messages, truncated: false };   // last page
    index += page.length;
  }
  return { messages, truncated: true };
};
