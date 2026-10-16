const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const filename = path.resolve(__dirname, '../electron/subtitle-translator.cjs');
const source = fs.readFileSync(filename, 'utf8');
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function setup(t, fetch, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lilac-ai-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'translation.json'), JSON.stringify(settings));
  const module = { exports: {} }, requireReal = createRequire(filename);
  const sandbox = { module, exports: module.exports, fetch, AbortSignal, AbortController, setTimeout, clearTimeout,
    Buffer, console, require: name => name === './local-ai.cjs' ? { createLocalAi: () => ({ models: () => [] }), promptVersion: () => '' } : requireReal(name) };
  // Exercise the real request/retry functions without adding a production test API.
  vm.runInNewContext(source.replace('return { settings, saveSettings, translate, cancel, jump, ready, local, clouds: CLOUDS };',
    'return { settings, saveSettings, translate, cancel, generate, askOpenai, askQwen, askDeepl };'), sandbox, { filename });
  return { ai: module.exports.createTranslator(dir), dir };
}

for (const [model, thinking] of [['gemini-2.5-flash', { thinkingBudget: 0 }], ['gemini-2.5-pro', { thinkingBudget: 128 }], ['gemini-3-flash', { thinkingLevel: 'low' }]]) {
  test(`Gemini request and thought filtering: ${model}`, async t => {
    const { ai } = setup(t, async (url, init) => {
      assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
      assert.equal(init.headers['x-goog-api-key'], 'fake-key');
      const body = JSON.parse(init.body);
      assert.deepEqual(body.generationConfig.thinkingConfig, thinking);
      assert.equal(body.generationConfig.responseSchema.type, 'ARRAY');
      assert.equal(body.systemInstruction.parts[0].text, 'Translate');
      return response({ candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }, { text: '[{"i":0,"t":"안녕"}]' }] } }] });
    });
    assert.equal(await ai.generate('fake-key', model, 'Translate', '[]'), '[{"i":0,"t":"안녕"}]');
  });
}

test('OpenAI uses Responses structured outputs and keeps response storage off', async t => {
  const { ai } = setup(t, async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(init.headers.Authorization, 'Bearer fake-key');
    const body = JSON.parse(init.body);
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.equal(body.reasoning.effort, 'low');
    return response({ output: [{ type: 'reasoning', summary: [] }, { content: [{ type: 'output_text', text: '{"lines":[]}' }] }] });
  });
  assert.equal(await ai.askOpenai({ openaiKey: 'fake-key' }, 'gpt-5-mini', 'JSON', '{}'), '{"lines":[]}');
});

for (const [region, host] of [['international', 'dashscope-intl.aliyuncs.com'], ['china', 'dashscope.aliyuncs.com']]) {
  test(`Qwen region, JSON and thinking switch: ${region}`, async t => {
    const { ai } = setup(t, async (url, init) => {
      assert.equal(url, `https://${host}/compatible-mode/v1/chat/completions`);
      const body = JSON.parse(init.body);
      assert.equal(body.enable_thinking, false);
      assert.equal(body.response_format.type, 'json_object');
      assert.equal(body.messages[0].role, 'system');
      return response({ choices: [{ message: { content: '{"lines":[]}' } }] });
    });
    assert.equal(await ai.askQwen({ qwenKey: 'fake-key', qwenRegion: region }, 'qwen-plus', 'JSON', '{}'), '{"lines":[]}');
  });
}

for (const [key, host] of [['fake:fx', 'api-free.deepl.com'], ['fake', 'api.deepl.com']]) {
  test(`DeepL endpoint and ordered translations: ${host}`, async t => {
    const { ai } = setup(t, async (url, init) => {
      assert.equal(url, `https://${host}/v2/translate`);
      assert.equal(init.headers.Authorization, `DeepL-Auth-Key ${key}`);
      const body = JSON.parse(init.body);
      assert.deepEqual(body.text, ['hello', 'bye']);
      assert.equal(body.target_lang, 'KO');
      assert.equal(body.context, 'Anime subtitles: Example');
      return response({ translations: [{ text: '안녕' }, { text: '잘 가' }] });
    });
    assert.deepEqual(Array.from(await ai.askDeepl({ deeplKey: key }, ['hello', 'bye'], { title: 'Example' })), ['안녕', '잘 가']);
  });
}

test('Qwen connection failure, empty models and wrong region never replace saved credentials', async t => {
  for (const failure of [() => { throw new TypeError('fetch failed'); }, () => response({ error: { message: 'busy' } }, 503), () => response({ error: { message: 'invalid key' } }, 401), () => response({ data: [] })]) {
    const original = { qwenKey: 'old-fake', qwenRegion: 'international', qwenModel: 'qwen-plus', qwenModels: ['qwen-plus'] };
    const { ai, dir } = setup(t, failure, original);
    await assert.rejects(ai.saveSettings({ qwenKey: 'new-fake', qwenRegion: 'china' }));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'translation.json'), 'utf8')), original);
  }
});

test('Qwen valid model list is saved after validation', async t => {
  const { ai } = setup(t, async () => response({ data: [{ id: 'qwen-plus' }, { id: 'qwen-vl-plus' }] }));
  const saved = await ai.saveSettings({ qwenKey: 'fake-key' });
  assert.equal(saved.qwenModel, 'qwen-plus');
  assert.deepEqual(Array.from(saved.qwenModels), ['qwen-plus']);
});

test('Gemini daily quota fails immediately without repeated requests', async t => {
  let calls = 0;
  const { ai } = setup(t, async () => { calls++; return response({ error: { message: 'quota', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDay' }] }] } }, 429); });
  await assert.rejects(ai.generate('fake-key', 'gemini-2.5-flash', 'JSON', '[]'), error => error.status === 429 && error.daily);
  assert.equal(calls, 1);
});

test('OpenAI falls back from unsupported schema and remembers the accepted request', async t => {
  const formats = [];
  const { ai } = setup(t, async (url, init) => {
    const format = JSON.parse(init.body).text.format.type;
    formats.push(format);
    return format === 'json_schema' ? response({ error: { message: 'Unsupported format' } }, 400)
      : response({ output: [{ content: [{ type: 'output_text', text: '{"lines":[]}' }] }] });
  });
  for (let i = 0; i < 2; i++) await ai.askOpenai({ openaiKey: 'fake-key' }, 'gpt-5-mini', 'JSON', '{}');
  assert.deepEqual(formats, ['json_schema', 'json_object', 'json_object']);
});

test('Gemini daily quota hands unfinished subtitles to the next configured API', async t => {
  const hosts = [];
  const { ai, dir } = setup(t, async url => {
    hosts.push(new URL(url).hostname);
    if (url.includes('googleapis.com')) return response({ error: { message: 'quota', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDay' }] }] } }, 429);
    return response({ output: [{ content: [{ type: 'output_text', text: '{"lines":[{"i":0,"t":"안녕"}]}' }] }] });
  }, { cloud: 'gemini', key: 'fake-key', model: 'gemini-2.5-flash', openaiKey: 'fake-openai', openaiModel: 'gpt-5-mini' });
  const file = path.join(dir, 'source.vtt');
  fs.writeFileSync(file, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n');
  const result = await ai.translate({ file, provider: 'cloud' });
  assert.equal(result.failed, 0);
  assert.equal(result.engine, 'OpenAI');
  assert.match(result.fallbackNote, /OpenAI/);
  assert.deepEqual(hosts, ['generativelanguage.googleapis.com', 'api.openai.com']);
});

for (const api of ['gemini', 'openai', 'qwen', 'deepl']) {
  test(`${api} cancellation interrupts rate-limit wait and sends no further requests`, async t => {
    let calls = 0;
    const { ai } = setup(t, async () => { calls++; return response({ error: { message: 'Rate limit exceeded', details: [{ retryDelay: '60s' }] } }, 429); });
    const abort = new AbortController();
    const promise = api === 'gemini' ? ai.generate('fake-key', 'gemini-2.5-flash', 'JSON', '[]', abort.signal)
      : api === 'openai' ? ai.askOpenai({ openaiKey: 'fake-key' }, 'gpt-5-mini', 'JSON', '{}', abort.signal)
      : api === 'qwen' ? ai.askQwen({ qwenKey: 'fake-key', qwenRegion: 'international' }, 'qwen-plus', 'JSON', '{}', abort.signal)
      : ai.askDeepl({ deeplKey: 'fake-key' }, ['hello'], {}, abort.signal);
    // Let fetch parsing complete and enter the retry delay before cancelling.
    await new Promise(resolve => setImmediate(resolve));
    abort.abort();
    await assert.rejects(promise, { name: 'AbortError' });
    assert.equal(calls, 1);
  });
}

for (const api of ['gemini', 'openai', 'qwen', 'deepl']) {
  test(`${api} complete subtitle translation preserves timing and caches result`, async t => {
    let calls = 0;
    const keys = { gemini: { key: 'fake-key', model: 'gemini-2.5-flash' }, openai: { openaiKey: 'fake-key', openaiModel: 'gpt-5-mini' }, qwen: { qwenKey: 'fake-key', qwenModel: 'qwen-plus' }, deepl: { deeplKey: 'fake:fx' } };
    const { ai, dir } = setup(t, async (url, init) => {
      calls++;
      const body = JSON.parse(init.body), answer = '[{"i":0,"t":"안녕"}]';
      if (api === 'gemini') return response({ candidates: [{ content: { parts: [{ text: answer }] } }] });
      if (api === 'openai') return response({ output: [{ content: [{ type: 'output_text', text: `{"lines":${answer}}` }] }] });
      if (api === 'qwen') return response({ choices: [{ message: { content: `{"lines":${answer}}` } }] });
      assert.equal(body.text.length, 1);
      return response({ translations: [{ text: '안녕' }] });
    }, { cloud: api, ...keys[api] });
    const file = path.join(dir, 'source.vtt');
    fs.writeFileSync(file, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n');
    const translated = await ai.translate({ file, provider: 'cloud' });
    assert.equal(translated.failed, 0);
    assert.match(fs.readFileSync(translated.path, 'utf8'), /00:00:01.000 --> 00:00:02.000\n안녕/);
    assert.equal((await ai.translate({ file, provider: 'cloud' })).cached, true);
    assert.equal(calls, 1);
  });
}
