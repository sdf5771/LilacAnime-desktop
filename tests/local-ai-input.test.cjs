const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const file = path.resolve(__dirname, '../electron/local-ai.cjs'), original = fs.readFileSync(file, 'utf8');
const languageTemplate = '{{ source_lang_code }} {{ target_lang_code }}';
function setup(t, { template = languageTemplate, output = '안녕하세요' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lilac-local-input-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const module = { exports: {} }, calls = [], requireReal = createRequire(file);
  // Substitute model startup only. Exercise real request construction, HTTP serialization,
  // output acceptance, callbacks and saved custom-model options without downloading a multi-GB model.
  const code = original.replace('await start(model, status)', '({ port: 12345, template: testTemplate })')
    .replace('module.exports = { createLocalAi, LOCAL_AI_MODELS: MODELS, promptVersion };', 'module.exports = { createLocalAi, promptVersion, translationInput };');
  vm.runInNewContext(code, { module, require: requireReal, Buffer, console, process, URL, AbortSignal, testTemplate: template,
    setTimeout: () => ({ unref() {} }), clearTimeout() {}, fetch: async (url, init) => {
      const body = JSON.parse(init.body); calls.push({ url, body });
      return new Response(JSON.stringify({ choices: [{ message: { content: typeof output === 'function' ? output(body, calls.length) : output } }] }), { status: 200 });
    } }, { filename: file });
  const ai = module.exports.createLocalAi(dir), model = path.join(dir, 'renamed-model.gguf'); fs.writeFileSync(model, 'fixture');
  const id = ai.addFile(model);
  return { ai, id, model, calls, exports: module.exports };
}
test('a renamed custom file uses template language inputs, not model-name exceptions', async t => {
  const { ai, id, calls } = setup(t), translated = [];
  await ai.translateLines(['こんにちは', 'Hello'], { modelId: id, onLine: (i, text) => translated.push([i, text]) });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.messages, [{ role: 'user', content: 'こんにちは' }]);
  assert.deepEqual(calls[0].body.chat_template_kwargs, { type: 'text', source_lang_code: 'ja', target_lang_code: 'ko' });
  assert.equal(calls[1].body.chat_template_kwargs.source_lang_code, 'en');
  assert.equal(translated.length, 2);
});
test('English output is retried and never replaces the original as a successful Korean translation', async t => {
  const { ai, id, calls } = setup(t, { output: 'Hello, how are you?' }), shown = [];
  const result = await ai.translateLines(['こんにちは'], { modelId: id, onLine: (_, text) => shown.push(text) });
  assert.equal(calls.length, 3); assert.equal(result.translations.size, 0); assert.deepEqual(shown, []);
});
test('manual language mode handles missing template detection and survives re-adding the file', async t => {
  const { ai, id, model, calls } = setup(t, { template: '' });
  ai.setModelOptions(id, { inputMode: 'translation', sourceLanguage: 'zh', customPrompt: '' }); ai.addFile(model);
  await ai.translateLines(['你好'], { modelId: id });
  assert.equal(calls[0].body.chat_template_kwargs.source_lang_code, 'zh');
  assert.equal(ai.models().find(model => model.id === id).inputMode, 'translation');
});
test('custom prompts ask chat models without substituting placeholders inside source text', async t => {
  const { ai, id, calls } = setup(t, { template: '{{ messages }}' });
  ai.setModelOptions(id, { inputMode: 'auto', sourceLanguage: 'ja', customPrompt: '{source_lang} -> {target_lang}\n{text}' });
  await ai.translateLines(['こんにちは {target_lang}'], { modelId: id });
  assert.equal(calls[0].body.messages[0].content, 'ja -> ko\nこんにちは {target_lang}');
  assert.equal(calls[0].body.chat_template_kwargs, undefined);
});
test('a language template (TranslateGemma) gets the source alone: a saved prompt would be translated into the subtitle', async t => {
  const { ai, id, calls } = setup(t);
  ai.setModelOptions(id, { inputMode: 'auto', sourceLanguage: 'auto', customPrompt: 'Remove all sound effects.\n\n{text}' });
  await ai.translateLines(['（ため息）'], { modelId: id });
  assert.deepEqual(calls[0].body.messages, [{ role: 'user', content: '（ため息）' }]);
  assert.equal(calls[0].body.chat_template_kwargs.target_lang_code, 'ko');
  // Once it has run, the settings know it and a prompt is refused with the reason.
  assert.equal(ai.models().find(model => model.id === id).translationOnly, true);
  assert.throws(() => ai.setModelOptions(id, { inputMode: 'auto', sourceLanguage: 'auto', customPrompt: 'Rules\n{text}' }), /번역 전용/);
  ai.setModelOptions(id, { inputMode: 'auto', sourceLanguage: 'auto', customPrompt: '' });
});
test('ordinary chat models retain a Korean translation instruction and manual chat mode overrides language templates', async t => {
  const { ai, id, calls } = setup(t, { template: '{{ messages }}' });
  await ai.translateLines(['こんにちは'], { modelId: id });
  assert.match(calls[0].body.messages[0].content, /into Korean/);
  assert.equal(calls[0].body.chat_template_kwargs, undefined);
  const second = setup(t); second.ai.setModelOptions(second.id, { inputMode: 'chat', sourceLanguage: 'auto', customPrompt: '' });
  await second.ai.translateLines(['こんにちは'], { modelId: second.id });
  assert.match(second.calls[0].body.messages[0].content, /into Korean/);
});
test('input options change translation cache identity and reject invalid settings', t => {
  const { ai, id, exports: api } = setup(t), first = api.promptVersion(ai.models().find(model => model.id === id));
  ai.setModelOptions(id, { inputMode: 'translation', sourceLanguage: 'ja', customPrompt: '' });
  assert.notEqual(first, api.promptVersion(ai.models().find(model => model.id === id)));
  assert.throws(() => ai.setModelOptions(id, { inputMode: 'invalid', sourceLanguage: 'ja' }));
  assert.throws(() => ai.setModelOptions(id, { inputMode: 'chat', sourceLanguage: 'ja', customPrompt: 'No source placeholder' }));
});
test('번역 프롬프트 reaches the models that follow instructions, and not a language template', async t => {
  const rules = { custom: 'CUSTOM RULES', extra: 'EXTRA RULE' };
  const gemma = setup(t, { template: '<|turn>' });
  await gemma.ai.translateLines(['こんにちは'], { modelId: gemma.id, rules });
  const system = gemma.calls[0].body.messages[0].content;
  assert.match(system, /^CUSTOM RULES\nAdditional rules from the user[^\n]*\nEXTRA RULE\nAnswer with the Korean line only/);
  assert.doesNotMatch(system, /You translate Japanese anime subtitles/);
  const chat = setup(t, { template: '{{ messages }}' });
  await chat.ai.translateLines(['こんにちは'], { modelId: chat.id, rules });
  assert.match(chat.calls[0].body.messages[0].content, /^CUSTOM RULES\nAdditional rules from the user[^\n]*\nEXTRA RULE\n\nこんにちは$/);
  const language = setup(t);
  await language.ai.translateLines(['こんにちは'], { modelId: language.id, rules });
  assert.deepEqual(language.calls[0].body.messages, [{ role: 'user', content: 'こんにちは' }]);
});
