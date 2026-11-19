import { askAi, extractJson, testProvider, AiError } from '../../utils/ai/AiClient';
import { pickModel, parseOrder } from '../../utils/ai/AiProviders';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const geminiModels = {
  models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }],
};
const geminiText = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const openaiModels = (...ids) => ({ data: ids.map((id) => ({ id })) });
const openaiText = (text) => ({ choices: [{ message: { content: text } }] });

const setup = ({ keys = {}, routes, settings = {} }) => {
  const cache = {};
  const fetch = jest.fn(async (url, init) => {
    for (const [pattern, handler] of routes) if (url.includes(pattern)) return handler(url, init);
    throw new Error(`unexpected ${url}`);
  });
  return {
    fetch,
    cache,
    deps: {
      fetch,
      loadSettings: async () => ({ order: ['gemini', 'groq', 'xai'], models: {}, ...settings }),
      getKey: async (id) => keys[id] || null,
      getCachedModel: async (id) => cache[id] || null,
      setCachedModel: async (id, m) => {
        cache[id] = m;
      },
    },
  };
};

describe('pickModel / parseOrder', () => {
  test('prefers the newest plain flash model and skips image/tts/preview', () => {
    expect(
      pickModel('gemini', [
        'models/gemini-2.5-flash',
        'gemini-3.6-flash',
        'gemini-3.6-flash-image',
        'gemini-3.8-flash-preview-tts',
        'gemini-3.6-pro',
      ])
    ).toBe('gemini-3.6-flash');
    expect(pickModel('gemini', ['gemini-flash-latest', 'gemini-3.6-flash'])).toBe('gemini-flash-latest');
  });
  test('groq skips whisper/guard models', () => {
    expect(pickModel('groq', ['whisper-large-v3', 'llama-guard-4', 'llama-3.3-70b-versatile'])).toBe(
      'llama-3.3-70b-versatile'
    );
    expect(pickModel('groq', ['whisper-large-v3'])).toBeNull();
  });
  test('order from .env is validated and completed', () => {
    expect(parseOrder('groq, bogus,groq')).toEqual(['groq', 'gemini', 'xai']);
    expect(parseOrder('')).toEqual(['gemini', 'groq', 'xai']);
  });
});

describe('extractJson', () => {
  test('handles fences and chatter', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('askAi', () => {
  test('no keys → clear error', async () => {
    const { deps } = setup({ routes: [] });
    await expect(askAi({ prompt: 'hi' }, deps)).rejects.toThrow(/No AI provider has an API key/);
  });

  test('uses gemini with header auth and caches the picked model', async () => {
    const { deps, fetch, cache } = setup({
      keys: { gemini: 'g-key' },
      routes: [
        ['/models?', () => reply(200, geminiModels)],
        [':generateContent', () => reply(200, geminiText('{"ok":true}'))],
      ],
    });
    const out = await askAi({ prompt: 'hi', json: true }, deps);
    expect(out).toMatchObject({ data: { ok: true }, provider: 'gemini', model: 'gemini-2.5-flash' });
    expect(cache.gemini).toBe('gemini-2.5-flash');
    const [, init] = fetch.mock.calls[1];
    expect(init.headers['x-goog-api-key']).toBe('g-key');
    expect(fetch.mock.calls[1][0]).not.toContain('g-key'); // key never in the URL
    expect(JSON.parse(init.body).generationConfig.responseMimeType).toBe('application/json');
  });

  test('falls back to groq when gemini is rate-limited', async () => {
    const { deps } = setup({
      keys: { gemini: 'g', groq: 'q' },
      routes: [
        ['generativelanguage', () => reply(429, { error: 'quota' })],
        ['groq.com/openai/v1/models', () => reply(200, openaiModels('llama-3.3-70b-versatile'))],
        ['groq.com/openai/v1/chat', () => reply(200, openaiText('Hello'))],
      ],
    });
    const out = await askAi({ prompt: 'hi' }, deps);
    expect(out).toEqual({ text: 'Hello', provider: 'groq', model: 'llama-3.3-70b-versatile' });
  });

  test('a reply that fails validation also falls back', async () => {
    const { deps } = setup({
      keys: { groq: 'q', xai: 'x' },
      routes: [
        ['groq.com/openai/v1/models', () => reply(200, openaiModels('llama-3.3-70b-versatile'))],
        ['groq.com/openai/v1/chat', () => reply(200, openaiText('{"wrong":1}'))],
        ['x.ai/v1/models', () => reply(200, openaiModels('grok-4.7', 'grok-4.7-fast'))],
        ['x.ai/v1/chat', () => reply(200, openaiText('{"results":[]}'))],
      ],
    });
    const validate = (d) => {
      if (!d.results) throw new Error('missing results');
    };
    const out = await askAi({ prompt: 'p', json: true, validate }, deps);
    expect(out.provider).toBe('xai');
    expect(out.model).toBe('grok-4.7-fast');
  });

  test('a retired cached model (404) is re-picked once', async () => {
    let gen = 0;
    const { deps, cache } = setup({
      keys: { gemini: 'g' },
      routes: [
        ['/models?', () => reply(200, geminiModels)],
        [':generateContent', () => (++gen === 1 ? reply(404, {}) : reply(200, geminiText('fine')))],
      ],
    });
    cache.gemini = 'gemini-1.5-flash';
    const out = await askAi({ prompt: 'p' }, deps);
    expect(out).toMatchObject({ text: 'fine', model: 'gemini-2.5-flash' });
  });

  test('all failing → AiError listing each provider', async () => {
    const { deps } = setup({
      keys: { gemini: 'g', groq: 'q' },
      routes: [
        ['generativelanguage', () => reply(401, { error: 'bad key' })],
        ['groq.com', () => reply(500, {})],
      ],
    });
    const err = await askAi({ prompt: 'p' }, deps).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.attempts.map((a) => a.provider)).toEqual(['gemini', 'groq']);
    expect(err.message).toMatch(/HTTP 401/);
  });

  test('manual model from Settings is used without listing models', async () => {
    const { deps, fetch } = setup({
      keys: { groq: 'q' },
      settings: { models: { groq: 'my-model' } },
      routes: [['groq.com/openai/v1/chat', () => reply(200, openaiText('ok'))]],
    });
    await askAi({ prompt: 'p' }, deps);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('my-model');
  });
});

test('testProvider reports the model and reply', async () => {
  const { deps } = setup({
    routes: [
      ['/models?', () => reply(200, geminiModels)],
      [':generateContent', () => reply(200, geminiText('OK'))],
    ],
  });
  await expect(testProvider('gemini', 'k', deps)).resolves.toEqual({
    model: 'gemini-2.5-flash',
    reply: 'OK',
  });
});
