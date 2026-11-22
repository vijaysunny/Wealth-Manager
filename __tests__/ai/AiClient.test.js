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

const setup = ({ keys = {}, routes, settings = {}, lists = {}, now = () => 1e12 }) => {
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
      setCachedModel: async (id, m, fast) => {
        cache[fast ? `${id}_fast` : id] = m;
      },
      getCachedModelList: async (id) => lists[id] || null,
      setCachedModelList: async (id, v) => {
        lists[id] = v;
      },
      now,
      sleep: async () => {},
    },
    lists,
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

describe('A9: preview fallback and Test status line', () => {
  const { runProviderTest, describeAiError } = require('../../utils/ai/AiClient');
  const previewOnly = {
    models: [
      { name: 'models/gemini-3.5-flash-preview-09-2026', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.5-flash-image-preview', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-005', supportedGenerationMethods: ['embedContent'] },
    ],
  };

  test('pickModel: only -preview flash ids → picks the preview; never image/tts/audio/live/embed', () => {
    expect(
      pickModel('gemini', [
        'gemini-3.5-flash-preview-09-2026',
        'gemini-3.5-flash-image-preview',
        'gemini-3.5-flash-preview-tts',
        'gemini-3.5-flash-live-preview',
        'gemini-embedding-preview',
      ])
    ).toBe('gemini-3.5-flash-preview-09-2026');
    expect(
      pickModel('gemini', ['gemini-3.5-flash-image-preview', 'gemini-3.5-flash-preview-tts'])
    ).toBeNull();
    // a stable model still wins over a preview
    expect(pickModel('gemini', ['gemini-3.6-flash-preview', 'gemini-3.5-flash'])).toBe('gemini-3.5-flash');
    // providers without a fallback list do not relax
    expect(pickModel('groq', ['llama-guard-4'])).toBeNull();
  });

  test('Test works with a preview-only key → "Working · <model>"', async () => {
    const { deps } = setup({
      routes: [
        ['/models?', () => reply(200, previewOnly)],
        [':generateContent', () => reply(200, geminiText('OK'))],
      ],
    });
    await expect(runProviderTest('gemini', 'k', deps)).resolves.toEqual({
      ok: true,
      model: 'gemini-3.5-flash-preview-09-2026',
      line: 'Working · gemini-3.5-flash-preview-09-2026',
    });
  });

  test('Test surfaces the API error text (first 120 characters)', async () => {
    const msg = 'API key not valid. Please pass a valid API key. '.repeat(4);
    const { deps } = setup({
      routes: [
        ['/models?', () => reply(400, { error: { code: 400, message: msg, status: 'INVALID_ARGUMENT' } })],
      ],
    });
    const r = await runProviderTest('gemini', 'bad', deps);
    expect(r.ok).toBe(false);
    expect(r.line.startsWith('HTTP 400: API key not valid.')).toBe(true);
    expect(r.line.length).toBeLessThanOrEqual(120);
  });

  test('no suitable model and no key give clear messages', async () => {
    const { deps } = setup({
      routes: [['/models?', () => reply(200, { models: [{ name: 'models/gemini-3.5-flash-preview-tts' }] })]],
    });
    expect((await runProviderTest('gemini', 'k', deps)).line).toMatch(/no suitable model/);
    expect(await runProviderTest('gemini', '', deps)).toEqual({ ok: false, line: 'No key' });
  });

  test('describeAiError: plain errors and non-JSON bodies', () => {
    expect(describeAiError(new Error('timed out'))).toBe('timed out');
    expect(describeAiError(null)).toBe('Unknown error');
  });
});

describe('A2: Gemini thinking level, fast model, list cache, timeouts', () => {
  const { runProviderTest, JOBS, supportsThinkingLevel } = require('../../utils/ai/AiClient');
  const g3 = {
    models: [
      'gemini-3.1-flash',
      'gemini-3.1-flash-lite',
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
    ].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })),
  };
  const bodyOf = (fetch, i) => JSON.parse(fetch.mock.calls[i][1].body);
  const genCalls = (fetch) => fetch.mock.calls.filter(([u]) => u.includes(':generateContent'));

  test('supportsThinkingLevel: Gemini 3+ and -latest aliases only', () => {
    expect(supportsThinkingLevel('gemini-3.1-flash-lite')).toBe(true);
    expect(supportsThinkingLevel('gemini-12-flash')).toBe(true);
    expect(supportsThinkingLevel('gemini-flash-lite-latest')).toBe(true);
    expect(supportsThinkingLevel('gemini-2.5-flash')).toBe(false);
    expect(supportsThinkingLevel(undefined)).toBe(false);
  });

  test('pickModel fast prefers flash-lite; normal prefers flash', () => {
    const ids = g3.models.map((m) => m.name);
    expect(pickModel('gemini', ids, { fast: true })).toBe('gemini-flash-lite-latest');
    expect(pickModel('gemini', ['gemini-3.1-flash', 'gemini-3.1-flash-lite'], { fast: true })).toBe(
      'gemini-3.1-flash-lite'
    );
    expect(pickModel('gemini', ids)).toBe('gemini-flash-latest');
    expect(pickModel('gemini', ['gemini-3.1-flash'], { fast: true })).toBe('gemini-3.1-flash');
    expect(pickModel('groq', ['llama-3.3-70b-versatile'], { fast: true })).toBe('llama-3.3-70b-versatile');
  });

  test('Test sends thinkingLevel minimal on flash-lite; chat sends low on flash; never thinkingBudget', async () => {
    const { deps, fetch, cache } = setup({
      keys: { gemini: 'g' },
      routes: [
        ['/models?', () => reply(200, { models: g3.models.slice(0, 2) })],
        [':generateContent', () => reply(200, geminiText('OK'))],
      ],
    });
    const r = await runProviderTest('gemini', 'g', deps);
    expect(r).toMatchObject({ ok: true, model: 'gemini-3.1-flash-lite' });
    const testBody = bodyOf(fetch, 1);
    expect(testBody.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
    await askAi({ prompt: 'Where did my money go?', job: 'chat' }, deps);
    const chat = genCalls(fetch).pop();
    expect(chat[0]).toContain('gemini-3.1-flash:generateContent');
    expect(JSON.parse(chat[1].body).generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    expect(cache).toMatchObject({ gemini_fast: 'gemini-3.1-flash-lite', gemini: 'gemini-3.1-flash' });
    fetch.mock.calls
      .filter(([, init]) => init && init.body)
      .forEach(([, init]) => expect(init.body).not.toMatch(/thinkingBudget/));
    // SMS/categories/statements are fast jobs with minimal thinking
    expect(JOBS.sms).toMatchObject({ fast: true, thinking: 'minimal', timeoutMs: 20000 });
    expect(JOBS.chat).toMatchObject({ fast: false, thinking: 'low', timeoutMs: 45000 });
  });

  test('no thinkingConfig for Gemini 2.x', async () => {
    const { deps, fetch } = setup({
      keys: { gemini: 'g' },
      routes: [
        ['/models?', () => reply(200, geminiModels)],
        [':generateContent', () => reply(200, geminiText('hi'))],
      ],
    });
    await askAi({ prompt: 'p', job: 'sms' }, deps);
    expect(bodyOf(fetch, 1).generationConfig.thinkingConfig).toBeUndefined();
  });

  test('400 mentioning thinking → retried once without thinkingConfig → success', async () => {
    const { deps, fetch } = setup({
      keys: { gemini: 'g' },
      routes: [
        ['/models?', () => reply(200, g3)],
        [
          ':generateContent',
          (_, init) =>
            JSON.parse(init.body).generationConfig.thinkingConfig
              ? reply(400, { error: { message: 'thinking_level is not supported for this model.' } })
              : reply(200, geminiText('fine')),
        ],
      ],
    });
    const out = await askAi({ prompt: 'p', job: 'chat' }, deps);
    expect(out.text).toBe('fine');
    expect(genCalls(fetch)).toHaveLength(2);
  });

  test('a model list cached < 24 h ago → Test makes exactly one fetch; older → lists again', async () => {
    const lists = { gemini: { at: 1e12 - 60 * 60 * 1000, ids: ['gemini-3.1-flash-lite'] } };
    const { deps, fetch } = setup({
      lists,
      routes: [
        ['/models?', () => reply(200, g3)],
        [':generateContent', () => reply(200, geminiText('OK'))],
      ],
    });
    expect((await runProviderTest('gemini', 'k', deps)).line).toBe('Working · gemini-3.1-flash-lite');
    expect(fetch).toHaveBeenCalledTimes(1);
    lists.gemini.at = 1e12 - 25 * 60 * 60 * 1000;
    fetch.mockClear();
    expect((await runProviderTest('gemini', 'k', deps)).line).toBe('Working · gemini-flash-lite-latest');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(lists.gemini.at).toBe(1e12);
  });

  describe('timeouts (fake timers)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());
    const hang = (_, init) =>
      new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        })
      );
    const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

    test('first call hangs past 20 s → retried once after 2 s → success', async () => {
      let n = 0;
      const { deps, fetch } = setup({
        lists: { gemini: { at: 1e12, ids: ['gemini-3.1-flash-lite'] } },
        routes: [[':generateContent', (u, i) => (++n === 1 ? hang(u, i) : reply(200, geminiText('OK')))]],
      });
      deps.sleep = realSleep;
      const p = runProviderTest('gemini', 'k', deps);
      await jest.advanceTimersByTimeAsync(20000);
      expect(fetch).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(2000);
      await expect(p).resolves.toMatchObject({ ok: true, line: 'Working · gemini-3.1-flash-lite' });
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    test('Test timing out twice → "Timed out after 20 s · <model> · generating"', async () => {
      const { deps } = setup({
        lists: { gemini: { at: 1e12, ids: ['gemini-3.1-flash-lite'] } },
        routes: [[':generateContent', hang]],
      });
      deps.sleep = realSleep;
      const p = runProviderTest('gemini', 'k', deps);
      await jest.advanceTimersByTimeAsync(43000);
      await expect(p).resolves.toEqual({
        ok: false,
        line: 'Timed out after 20 s · gemini-3.1-flash-lite · generating',
      });
    });

    test('listing models times out at 10 s → "· listing models"', async () => {
      const { deps } = setup({ routes: [['/models?', hang]] });
      deps.sleep = realSleep;
      const p = runProviderTest('gemini', 'k', deps);
      await jest.advanceTimersByTimeAsync(23000);
      const r = await p;
      expect(r.line).toBe('Timed out after 10 s · gemini · listing models');
    });

    test('both Gemini tries hang → Groq answers; with no Groq key the error names both tries', async () => {
      const { deps } = setup({
        keys: { gemini: 'g', groq: 'q' },
        lists: {
          gemini: { at: 1e12, ids: ['gemini-3.1-flash'] },
          groq: { at: 1e12, ids: ['llama-3.3-70b-versatile'] },
        },
        routes: [
          [':generateContent', hang],
          ['groq.com/openai/v1/chat', () => reply(200, openaiText('Food, mostly.'))],
        ],
      });
      deps.sleep = realSleep;
      const p = askAi({ prompt: 'Where did my money go this month?', job: 'chat' }, deps);
      await jest.advanceTimersByTimeAsync(45000 * 2 + 2000);
      await expect(p).resolves.toMatchObject({ text: 'Food, mostly.', provider: 'groq' });

      const solo = setup({
        keys: { gemini: 'g' },
        lists: { gemini: { at: 1e12, ids: ['gemini-3.1-flash'] } },
        routes: [[':generateContent', hang]],
      });
      solo.deps.sleep = realSleep;
      const q = askAi({ prompt: 'p', job: 'chat' }, solo.deps).catch((e) => e);
      await jest.advanceTimersByTimeAsync(45000 * 2 + 2000);
      const err = await q;
      expect(err).toBeInstanceOf(AiError);
      expect(err.message).toMatch(
        /Google Gemini Flash: Timed out after 45 s · gemini-3.1-flash · generating/
      );
      expect(solo.fetch).toHaveBeenCalledTimes(2);
    });
  });

  test('HTTP 503 high demand is retried once, then passed through', async () => {
    const { deps, fetch } = setup({
      keys: { gemini: 'g' },
      lists: { gemini: { at: 1e12, ids: ['gemini-3.1-flash-lite'] } },
      routes: [
        [
          ':generateContent',
          () => reply(503, { error: { message: 'The model is overloaded: high demand' } }),
        ],
      ],
    });
    const r = await runProviderTest('gemini', 'g', deps);
    expect(r.line).toBe('HTTP 503: The model is overloaded: high demand');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
