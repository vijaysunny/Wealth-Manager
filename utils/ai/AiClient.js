/**
 * AiClient.js - one call → first working provider.
 *
 * Providers are tried in the saved order (free first), skipping any without a key. A provider
 * that fails (no network, timeout, bad key, rate limit, 5xx, unusable reply) hands over to the
 * next one. A 404 on the model drops the cached model and re-picks once (models get retired).
 * All I/O is injectable so tests never touch the network.
 */
import { PROVIDERS, pickModel } from './AiProviders';
import { loadAiSettings, getApiKey, getCachedModel, setCachedModel } from './AiConfig';

export class AiError extends Error {
  constructor(message, attempts = []) {
    super(message);
    this.name = 'AiError';
    this.attempts = attempts;
  }
}

class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}${body ? `: ${String(body).slice(0, 160)}` : ''}`);
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 30000;

const defaultDeps = () => ({
  fetch: (...args) => globalThis.fetch(...args),
  loadSettings: loadAiSettings,
  getKey: getApiKey,
  getCachedModel,
  setCachedModel,
});

const request = async (deps, url, { method = 'GET', headers = {}, body, timeoutMs }) => {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await deps.fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller ? controller.signal : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, text);
    return text ? JSON.parse(text) : {};
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('timed out');
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const authHeaders = (p, key) =>
  p.api === 'gemini' ? { 'x-goog-api-key': key } : { Authorization: `Bearer ${key}` };

export const listModels = async (providerId, key, deps = defaultDeps(), timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const p = PROVIDERS[providerId];
  const headers = authHeaders(p, key);
  if (p.api === 'gemini') {
    const data = await request(deps, `${p.baseUrl}/models?pageSize=1000`, { headers, timeoutMs });
    return (data.models || [])
      .filter(
        (m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent')
      )
      .map((m) => String(m.name).replace(/^models\//, ''));
  }
  const data = await request(deps, `${p.baseUrl}/models`, { headers, timeoutMs });
  return (data.data || []).map((m) => m.id);
};

const resolveModel = async (providerId, key, settings, deps, timeoutMs, fresh = false) => {
  const manual = settings.models && settings.models[providerId];
  if (manual) return manual;
  if (!fresh) {
    const cached = await deps.getCachedModel(providerId);
    if (cached) return cached;
  }
  const model = pickModel(providerId, await listModels(providerId, key, deps, timeoutMs));
  if (!model) throw new Error('no suitable model available for this key');
  await deps.setCachedModel(providerId, model);
  return model;
};

const generate = async (providerId, key, model, { system, prompt, json, temperature }, deps, timeoutMs) => {
  const p = PROVIDERS[providerId];
  const headers = authHeaders(p, key);
  if (p.api === 'gemini') {
    const data = await request(deps, `${p.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers,
      timeoutMs,
      body: {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) },
      },
    });
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content?.parts) || [];
    return parts.map((x) => x.text || '').join('');
  }
  const data = await request(deps, `${p.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    timeoutMs,
    body: {
      model,
      temperature,
      messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    },
  });
  return (data.choices && data.choices[0] && data.choices[0].message?.content) || '';
};

/** Pull a JSON object out of a model reply (tolerates ```json fences and chatter around it). */
export const extractJson = (text) => {
  const s = String(text || '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('reply was not JSON');
    return JSON.parse(s.slice(start, end + 1));
  }
};

const describe = (e) => (e && e.message) || String(e);

/**
 * Ask the first working provider. Returns { text | data, provider, model }.
 * opts: { system, prompt, json=false, temperature=0.1, timeoutMs, validate(data) → throws if unusable }
 */
export const askAi = async (opts, overrides = {}) => {
  const deps = { ...defaultDeps(), ...overrides };
  const settings = await deps.loadSettings();
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const call = { temperature: 0.1, json: false, ...opts };
  const attempts = [];
  for (const providerId of settings.order) {
    const key = await deps.getKey(providerId);
    if (!key) continue;
    try {
      let model = await resolveModel(providerId, key, settings, deps, timeoutMs);
      let text;
      try {
        text = await generate(providerId, key, model, call, deps, timeoutMs);
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404) || settings.models?.[providerId]) throw e;
        model = await resolveModel(providerId, key, settings, deps, timeoutMs, true); // model retired
        text = await generate(providerId, key, model, call, deps, timeoutMs);
      }
      if (!text) throw new Error('empty reply');
      if (!call.json) return { text: text.trim(), provider: providerId, model };
      const data = extractJson(text);
      if (call.validate) call.validate(data);
      return { data, provider: providerId, model };
    } catch (e) {
      attempts.push({ provider: providerId, error: describe(e) });
    }
  }
  if (!attempts.length)
    throw new AiError('No AI provider has an API key. Add one in Settings → AI assistant.');
  throw new AiError(
    `All AI providers failed: ${attempts.map((a) => `${PROVIDERS[a.provider].label}: ${a.error}`).join('; ')}`,
    attempts
  );
};

/** Settings "Test" button: check one key and report the model it would use. */
export const testProvider = async (providerId, key, overrides = {}) => {
  const deps = { ...defaultDeps(), ...overrides };
  const settings = await deps.loadSettings();
  const model = await resolveModel(providerId, key, settings, deps, DEFAULT_TIMEOUT_MS, true);
  const text = await generate(
    providerId,
    key,
    model,
    { prompt: 'Reply with the single word OK.', temperature: 0 },
    deps,
    DEFAULT_TIMEOUT_MS
  );
  return { model, reply: String(text).trim().slice(0, 40) };
};
