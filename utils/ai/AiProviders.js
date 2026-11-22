/**
 * AiProviders.js - the LLM providers WealthManager can call (pure data + model picking).
 *
 * Free tiers first: Google Gemini Flash (AI Studio key) and Groq (free tier, OpenAI-style API).
 * xAI Grok has no lasting free tier, so it is only used as a last fallback when a key is saved.
 *
 * Model IDs change every few months, so none is hard-wired: each provider lists its models and
 * `pickModel` chooses the best match from `prefer` (a model saved in Settings always wins).
 */

export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini Flash',
    free: true,
    api: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyUrl: 'https://aistudio.google.com/apikey',
    prefer: [/^gemini-flash-latest$/, /^gemini-[\d.]+-flash$/, /^gemini-[\d.]+-flash-lite$/, /flash/],
    // A2: Test, SMS, categories and statements use flash-lite (fast, minimal thinking).
    preferFast: [/^gemini-flash-lite-latest$/, /flash-lite/],
    avoid: /image|tts|audio|live|embed|vision|thinking|exp|preview|8b/i,
    // A9: when a key lists only "-preview" Flash models (Gemini 2.5 was shut down in Oct 2026),
    // a preview model is better than "no suitable model". These are never acceptable.
    fallbackAvoid: /image|tts|audio|live|embed/i,
  },
  groq: {
    id: 'groq',
    label: 'Groq (free tier)',
    free: true,
    api: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    prefer: [/llama-3\.3-70b/, /gpt-oss-120b/, /llama-4/, /gpt-oss/, /llama/, /qwen/, /kimi/],
    avoid: /whisper|tts|guard|embed|vision|orpheus|playai|compound|distil|prompt-guard/i,
  },
  xai: {
    id: 'xai',
    label: 'xAI Grok (paid)',
    free: false,
    api: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    keyUrl: 'https://console.x.ai',
    prefer: [/^grok-[\d.]+-fast/, /fast/, /mini/, /^grok-[\d.]+$/, /grok/],
    avoid: /image|imagine|vision|video|code|build/i,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);
export const DEFAULT_ORDER = ['gemini', 'groq', 'xai'];

/** Parse "gemini,groq" (from .env) into a valid, de-duplicated provider order. */
export const parseOrder = (value) => {
  const wanted = String(value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((id) => PROVIDERS[id]);
  const order = [...new Set(wanted)];
  for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
  return order;
};

const versionDesc = (a, b) => b.localeCompare(a, 'en', { numeric: true });

/** Best model id for a provider from the ids its API listed; null when nothing suitable. */
const firstPreferred = (p, ids) => {
  for (const re of p.prefer) {
    const hits = ids.filter((id) => re.test(id)).sort(versionDesc);
    if (hits.length) return hits[0];
  }
  return null;
};

/** opts.fast (A2): try the provider's preferFast list first, then the usual order. */
export const pickModel = (providerId, ids = [], { fast = false } = {}) => {
  const p = PROVIDERS[providerId];
  if (!p) return null;
  const all = ids.map((id) => String(id).replace(/^models\//, '')).filter(Boolean);
  const usable = all.filter((id) => !p.avoid.test(id));
  if (fast && p.preferFast) {
    const quick = firstPreferred({ prefer: p.preferFast }, usable);
    if (quick) return quick;
  }
  const best = firstPreferred(p, usable);
  if (best || !p.fallbackAvoid) return best;
  return firstPreferred(
    p,
    all.filter((id) => !p.fallbackAvoid.test(id))
  );
};
