/**
 * AiClient.js - one call → first working provider.
 *
 * Providers are tried in the saved order (free first), skipping any without a key. A provider
 * that fails (no network, timeout, bad key, rate limit, 5xx, unusable reply) hands over to the
 * next one. A 404 on the model drops the cached model and re-picks once (models get retired).
 * All I/O is injectable so tests never touch the network.
 */
import { PROVIDERS, pickModel } from './AiProviders';
import {
  loadAiSettings,
  getApiKey,
  getCachedModel,
  setCachedModel,
  getCachedModelList,
  setCachedModelList,
} from './AiConfig';

export class AiError extends Error {
  constructor(message, attempts = []) {
    super(message);
    this.name = 'AiError';
    this.attempts = attempts;
  }
}

// The provider's own error text: Gemini/OpenAI-style {"error":{"message":"…"}}
const apiMessageOf = (body) => {
  try {
    const j = JSON.parse(body);
    const m = j?.error?.message || j?.message || (typeof j?.error === 'string' ? j.error : null);
    return m ? String(m) : null;
  } catch {
    return null;
  }
};

class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}${body ? `: ${String(body).slice(0, 160)}` : ''}`);
    this.status = status;
    this.apiMessage = apiMessageOf(body);
  }
}

/** Short, readable error for the Settings status line (A9): the API's text, first 120 chars. */
export const describeAiError = (e) => {
  const text = (e && (e.apiMessage || e.message)) || 'Unknown error';
  const withStatus = e && e.apiMessage && e.status ? `HTTP ${e.status}: ${text}` : text;
  return String(withStatus).slice(0, 120);
};

/**
 * A2: per-job settings. "fast" jobs prefer flash-lite with minimal thinking; chat questions use
 * flash with low thinking. Gemini 3 models otherwise think at "high" and can take far longer
 * than our timeout before the first token.
 */
export const JOBS = {
  test: { fast: true, thinking: 'minimal', timeoutMs: 20000 },
  sms: { fast: true, thinking: 'minimal', timeoutMs: 20000 },
  categorize: { fast: true, thinking: 'minimal', timeoutMs: 20000 },
  statement: { fast: true, thinking: 'minimal', timeoutMs: 20000 },
  chat: { fast: false, thinking: 'low', timeoutMs: 45000 },
};
export const LIST_TIMEOUT_MS = 10000;
export const RETRY_DELAY_MS = 2000;
export const MODEL_LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const jobOf = (name) => JOBS[name] || JOBS.chat;

/** Gemini 3+ (and the -latest aliases) take thinkingConfig.thinkingLevel. */
export const supportsThinkingLevel = (model) =>
  /^gemini-(?:[3-9]|\d{2})|flash-latest|flash-lite-latest/.test(String(model || ''));

class TimeoutError extends Error {
  constructor(ms) {
    super(`Timed out after ${Math.round(ms / 1000)} s`);
    this.name = 'TimeoutError';
    this.timeout = true;
  }
}
// "Timed out after 20 s · gemini-3.1-flash-lite · generating"
const withStep = (e, what, step) => {
  if (e && e.timeout && !e.step) {
    e.message = `${e.message} · ${what} · ${step}`;
    e.step = step;
  }
  return e;
};

const defaultDeps = () => ({
  fetch: (...args) => globalThis.fetch(...args),
  loadSettings: loadAiSettings,
  getKey: getApiKey,
  getCachedModel,
  setCachedModel,
  getCachedModelList,
  setCachedModelList,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

const request = async (deps, url, { method = 'GET', headers = {}, body, timeoutMs }) => {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      reject(new TimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    const call = (async () => {
      const res = await deps.fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller ? controller.signal : undefined,
      });
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, text);
      return text ? JSON.parse(text) : {};
    })();
    call.catch(() => {}); // the timeout may win the race
    return await Promise.race([call, timeout]);
  } catch (e) {
    if (e && e.name === 'AbortError') throw new TimeoutError(timeoutMs);
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const retryable = (e) => Boolean(e && (e.timeout || e.status === 429 || e.status === 503));
/** A2: on timeout, 429 or 503, one retry after 2 s; then the caller moves to the next provider. */
const withRetry = async (deps, fn) => {
  try {
    return await fn();
  } catch (e) {
    if (!retryable(e)) throw e;
    await deps.sleep(RETRY_DELAY_MS);
    return fn();
  }
};

const authHeaders = (p, key) =>
  p.api === 'gemini' ? { 'x-goog-api-key': key } : { Authorization: `Bearer ${key}` };

export const listModels = async (providerId, key, deps = defaultDeps(), timeoutMs = LIST_TIMEOUT_MS) => {
  const p = PROVIDERS[providerId];
  const headers = authHeaders(p, key);
  try {
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
  } catch (e) {
    throw withStep(e, providerId, 'listing models');
  }
};

/** A2.3: the model list is cached for 24 h, so a Test or a question makes one network call. */
const modelList = async (providerId, key, deps, { fresh = false } = {}) => {
  if (!fresh && deps.getCachedModelList) {
    const cached = await deps.getCachedModelList(providerId);
    if (cached && Array.isArray(cached.ids) && deps.now() - cached.at < MODEL_LIST_MAX_AGE_MS)
      return cached.ids;
  }
  const ids = await withRetry(deps, () => listModels(providerId, key, deps, LIST_TIMEOUT_MS));
  if (deps.setCachedModelList) await deps.setCachedModelList(providerId, { at: deps.now(), ids });
  return ids;
};

const resolveModel = async (
  providerId,
  key,
  settings,
  deps,
  { fast = false, fresh = false, repick = false } = {}
) => {
  const manual = settings.models && settings.models[providerId];
  if (manual) return manual;
  if (!fresh && !repick) {
    const cached = await deps.getCachedModel(providerId, fast);
    if (cached) return cached;
  }
  const model = pickModel(providerId, await modelList(providerId, key, deps, { fresh }), { fast });
  if (!model) throw new Error('no suitable model available for this key');
  await deps.setCachedModel(providerId, model, fast);
  return model;
};

const mentionsThinking = (e) =>
  e instanceof HttpError && e.status === 400 && /thinking/i.test(`${e.apiMessage || ''} ${e.message}`);

const generateOnce = async (providerId, key, model, call, deps, { thinking }) => {
  const { system, prompt, json, temperature, timeoutMs } = call;
  const p = PROVIDERS[providerId];
  const headers = authHeaders(p, key);
  if (p.api === 'gemini') {
    const generationConfig = {
      temperature,
      ...(json ? { responseMimeType: 'application/json' } : {}),
      // Never thinkingBudget as well: the API rejects both together.
      ...(thinking && supportsThinkingLevel(model) ? { thinkingConfig: { thinkingLevel: thinking } } : {}),
    };
    const data = await request(deps, `${p.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers,
      timeoutMs,
      body: {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      },
    });
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content?.parts) || [];
    return parts
      .filter((x) => !x.thought)
      .map((x) => x.text || '')
      .join('');
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

const generate = async (providerId, key, model, call, deps) => {
  const once = (thinking) =>
    withRetry(deps, () => generateOnce(providerId, key, model, call, deps, { thinking })).catch((e) => {
      throw withStep(e, model, 'generating');
    });
  try {
    return await once(call.thinking);
  } catch (e) {
    // A2.1: a model that refuses thinkingConfig gets one more try without it.
    if (call.thinking && mentionsThinking(e)) return once(null);
    throw e;
  }
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

/**
 * Ask the first working provider. Returns { text | data, provider, model }.
 * opts: { job='chat', system, prompt, json=false, temperature=0.1, timeoutMs, validate(data) }
 * job (A2): 'test' | 'sms' | 'categorize' | 'statement' | 'chat' sets the model, thinking level
 * and timeout.
 */
export const askAi = async (opts, overrides = {}) => {
  const deps = { ...defaultDeps(), ...overrides };
  const settings = await deps.loadSettings();
  const job = jobOf(opts.job);
  const call = {
    temperature: 0.1,
    json: false,
    ...opts,
    timeoutMs: opts.timeoutMs || job.timeoutMs,
    thinking: job.thinking,
  };
  const attempts = [];
  for (const providerId of settings.order) {
    const key = await deps.getKey(providerId);
    if (!key) continue;
    try {
      let model = await resolveModel(providerId, key, settings, deps, { fast: job.fast });
      let text;
      try {
        text = await generate(providerId, key, model, call, deps);
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404) || settings.models?.[providerId]) throw e;
        // model retired: fetch the list again and re-pick once
        model = await resolveModel(providerId, key, settings, deps, { fast: job.fast, fresh: true });
        text = await generate(providerId, key, model, call, deps);
      }
      if (!text) throw new Error('empty reply');
      if (!call.json) return { text: text.trim(), provider: providerId, model };
      const data = extractJson(text);
      if (call.validate) call.validate(data);
      return { data, provider: providerId, model };
    } catch (e) {
      attempts.push({ provider: providerId, error: describeAiError(e) });
    }
  }
  if (!attempts.length)
    throw new AiError('No AI provider has an API key. Add one in Settings → AI assistant.');
  throw new AiError(
    `All AI providers failed: ${attempts.map((a) => `${PROVIDERS[a.provider].label}: ${a.error}`).join('; ')}`,
    attempts
  );
};

/**
 * Settings "Test" button: check one key and report the model it would use. Uses the cached model
 * list (≤ 24 h) and re-picks from it, so a working key costs one network call.
 */
export const testProvider = async (providerId, key, overrides = {}) => {
  const deps = { ...defaultDeps(), ...overrides };
  const settings = await deps.loadSettings();
  const job = JOBS.test;
  const model = await resolveModel(providerId, key, settings, deps, { fast: job.fast, repick: true });
  const text = await generate(
    providerId,
    key,
    model,
    {
      prompt: 'Reply with the single word OK.',
      temperature: 0,
      timeoutMs: job.timeoutMs,
      thinking: job.thinking,
    },
    deps
  );
  return { model, reply: String(text).trim().slice(0, 40) };
};

/**
 * A9: run the Test for one provider and turn it into the status line Settings shows:
 * { ok: true, model, line: 'Working · <model>' } or { ok: false, line: <error, ≤120 chars> }.
 * Never throws.
 */
export const runProviderTest = async (providerId, key, overrides = {}) => {
  if (!key) return { ok: false, line: 'No key' };
  try {
    const { model } = await testProvider(providerId, key, overrides);
    return { ok: true, model, line: `Working · ${model}` };
  } catch (e) {
    return { ok: false, line: describeAiError(e) };
  }
};
