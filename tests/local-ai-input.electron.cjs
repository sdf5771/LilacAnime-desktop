// Real DOM check for custom-file input settings, with the app's actual renderer function.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'lilac-local-settings-'))); app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  const source = fs.readFileSync(path.resolve(__dirname, '../src/app.js'), 'utf8');
  const render = source.slice(source.indexOf('function renderLocalAi('), source.indexOf('\nasync function installLocalModel('));
  const fixture = { localModel: 'file:custom.gguf', localModels: [{ id: 'file:custom.gguf', label: 'custom.gguf', path: 'custom.gguf', installed: true, inputMode: 'auto', sourceLanguage: 'auto', customPrompt: '' }] };
  await win.webContents.executeJavaScript(`
    document.body.innerHTML = '<div id="localModelList"></div>';
    const $ = selector => document.querySelector(selector), localModelProgress = {}, escapeHtml = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    let settings = ${JSON.stringify(fixture)}, calls = [], notices = [];
    const toast = text => notices.push(text), ipcMessage = error => error.message;
    window.lilac = { setLocalModelOptions: async (id, options) => { calls.push({ id, options }); Object.assign(settings.localModels[0], options); return settings; } };
    const renderTranslationSettings = value => renderLocalAi(value);
    ${render}
    renderLocalAi(settings);
  `);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.local-model-options').length`), 1);
  await win.webContents.executeJavaScript(`
    document.querySelector('.local-model-options').open = true;
    const mode = document.querySelector('.local-input-mode'); mode.value = 'translation'; mode.dispatchEvent(new Event('change'));
    document.querySelector('.local-source-language').value = 'ja';
  `);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.local-prompt-field').hidden`), true);
  await win.webContents.executeJavaScript(`document.querySelector('.local-options-save').click();`);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(await win.webContents.executeJavaScript(`calls[0]`), { id: 'file:custom.gguf', options: { inputMode: 'translation', sourceLanguage: 'ja', customPrompt: '' } });
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.local-input-mode').value`), 'translation');
  await win.webContents.executeJavaScript(`
    const mode2 = document.querySelector('.local-input-mode'); mode2.value = 'chat'; mode2.dispatchEvent(new Event('change'));
    document.querySelector('textarea').value = '{source_lang} -> {target_lang}: {text}'; document.querySelector('.local-options-save').click();
  `);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await win.webContents.executeJavaScript(`calls[1].options.customPrompt`), '{source_lang} -> {target_lang}: {text}');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.local-prompt-field').hidden`), false);
  // A translation-only model (TranslateGemma) in 자동: no prompt field, the reason instead, and its old prompt is cleared.
  await win.webContents.executeJavaScript(`
    Object.assign(settings.localModels[0], { translationOnly: true, inputMode: 'auto', customPrompt: 'Rules\\n{text}' }); renderLocalAi(settings);
    document.querySelector('.local-model-options').open = true; document.querySelector('.local-options-save').click();
  `);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.local-prompt-field').hidden`), true);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.local-prompt-note').hidden`), false);
  assert.equal(await win.webContents.executeJavaScript(`calls[2].options.customPrompt`), '');
  console.log('Custom GGUF input settings: mode, language, prompt, save and re-render passed.');
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
