/**
 * AiSync.js - the AI steps of an SMS sync (both optional, both best-effort).
 *
 *  1. parse: bank SMS the regex parser rejected → AI → validated scan items.
 *     Each SMS is sent at most once (body hashes remembered under AI_SEEN_KEY), newest first,
 *     at most MAX_AI_SMS_PER_RUN per run so a first sync does not burn the free-tier quota.
 *  2. categorize: new rows still in 'General' get an AI category.
 *
 * Any AI failure is swallowed: the regex-parsed rows are always saved.
 */
import { hashText } from '../DeduplicationEngine';
import { isAiReady } from './AiConfig';
import { aiParseSms, aiCategorize, DEFAULT_CATEGORIES } from './AiTasks';

export const AI_SEEN_KEY = 'ai_sms_seen';
export const MAX_AI_SMS_PER_RUN = 16;
const MAX_SEEN = 3000;

export const defaultAiDeps = () => ({
  ready: isAiReady,
  parseSms: aiParseSms,
  categorize: aiCategorize,
});

const loadCategories = async (storage) => {
  try {
    const saved = JSON.parse((await storage.getItem('user_categories')) || 'null');
    return Array.isArray(saved) && saved.length ? saved : DEFAULT_CATEGORIES;
  } catch {
    return DEFAULT_CATEGORIES;
  }
};

/** Returns scan-shaped items the AI read from `unparsed` SMS ([] when off / nothing new). */
export const aiParseUnparsed = async (unparsed = [], storage, ai = defaultAiDeps()) => {
  if (!unparsed.length) return [];
  try {
    if (!(await ai.ready('sms'))) return [];
    const seen = JSON.parse((await storage.getItem(AI_SEEN_KEY)) || '[]');
    const seenSet = new Set(seen);
    const todo = unparsed
      .filter((m) => !seenSet.has(hashText(m.body)))
      .sort((a, b) => b.date - a.date)
      .slice(0, MAX_AI_SMS_PER_RUN);
    if (!todo.length) return [];
    const items = await ai.parseSms(todo, { categories: await loadCategories(storage) });
    const nextSeen = [...seen, ...todo.map((m) => hashText(m.body))].slice(-MAX_SEEN);
    await storage.setItem(AI_SEEN_KEY, JSON.stringify(nextSeen));
    return items;
  } catch (e) {
    console.log('AI SMS step skipped:', e.message);
    return [];
  }
};

/** Returns txs with AI categories for rows still in 'General' (same array when off / failed). */
export const aiCategorizeNew = async (txs, storage, ai = defaultAiDeps()) => {
  const general = txs.filter((t) => t.type !== 'transfer' && (!t.category || t.category === 'General'));
  if (!general.length) return txs;
  try {
    if (!(await ai.ready('categorize'))) return txs;
    const cats = await ai.categorize(general, { categories: await loadCategories(storage) });
    if (!cats.size) return txs;
    return txs.map((t) => {
      if (!cats.has(t.id)) return t;
      const category = cats.get(t.id);
      // SMS rows without a merchant are titled with their category; keep that in step
      const title = t.title && t.title !== t.category ? t.title : category;
      return { ...t, category, categorySource: 'ai', title, tags: [...new Set([...(t.tags || []), 'ai'])] };
    });
  } catch (e) {
    console.log('AI categorize step skipped:', e.message);
    return txs;
  }
};
