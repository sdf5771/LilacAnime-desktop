const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');

function boot(t, { brokenVideos = false, invalidRoot = false, brokenStore = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lilac-startup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const userData = path.join(dir, 'profile'); fs.mkdirSync(userData);
  if (invalidRoot) {
    const root = path.join(dir, 'not-a-folder'); fs.writeFileSync(root, 'file');
    fs.writeFileSync(path.join(userData, 'download-settings.json'), JSON.stringify({ root }));
  }
  if (brokenStore) fs.mkdirSync(path.join(userData, 'downloads.json'));
  const handlers = new Map(), windows = [], errors = [];
  const app = new EventEmitter();
  let initialize, startup;
  Object.assign(app, {
    commandLine: { appendSwitch() {} }, setAppUserModelId() {}, requestSingleInstanceLock: () => true,
    isReady: () => true, isPackaged: false, getVersion: () => 'test', quit() { this.quitted = true; },
    getPath: name => { if (name === 'videos' && brokenVideos) throw new Error("Failed to get 'videos' path"); return name === 'userData' ? userData : path.join(dir, name); },
    whenReady: () => ({ then: fn => { initialize = () => startup = Promise.resolve().then(fn); return { catch: fn => { app.onFailure = fn; } }; } })
  });
  class Window extends EventEmitter {
    constructor() { super(); windows.push(this); this.webContents = { send() {}, id: windows.length }; }
    loadFile() {} isDestroyed() { return false; } isMinimized() { return false; } show() {} focus() {}
    static getAllWindows() { return windows; }
  }
  const electron = { app, BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    session: { defaultSession: { webRequest: { onBeforeSendHeaders() {}, onHeadersReceived() {} } } },
    screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    dialog: { showErrorBox: (...args) => errors.push(args) }, shell: {} };
  const filename = path.resolve(__dirname, '../electron/main.cjs'), realRequire = createRequire(filename);
  const load = file => {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, require: name => name === 'electron' ? electron : createRequire(file)(name), process, console, Buffer, URL, setTimeout, clearTimeout, __dirname: path.dirname(file) }, { filename: file });
    return module.exports;
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => name === 'electron' ? electron : name === './updater.cjs' ? load(path.resolve(__dirname, '../electron/updater.cjs')) : realRequire(name),
    process: { ...process, env: { ...process.env, LILAC_SMOKE_REANIME: '' } }, console, Buffer, URL, AbortSignal,
    __dirname: path.dirname(filename), setTimeout: () => ({ unref() {} }), clearTimeout() {}, setInterval: () => ({ unref() {} })
  }, { filename });
  const start = async () => { try { await initialize(); } catch (error) { if (app.onFailure) await app.onFailure(error); else throw error; } };
  t.after(() => { try { app.emit('before-quit'); } catch {} });
  return { app, start, handlers, windows, errors, userData };
}

test('startup registers catalog and TMDB handlers before opening the main window', async t => {
  const run = boot(t); await run.start();
  assert.equal(run.handlers.has('provider:catalog'), true);
  assert.equal(run.handlers.has('tmdb:set'), true);
  assert.equal(run.windows.length, 1);
});

test('an unavailable Windows Videos path cannot prevent catalog and settings registration', async t => {
  const run = boot(t, { brokenVideos: true }); await run.start();
  assert.equal(run.handlers.has('provider:catalog'), true);
  assert.equal(run.handlers.has('tmdb:set'), true);
  assert.equal(run.windows.length, 1);
});

test('a saved download path that is a file cannot stop application startup', async t => {
  const run = boot(t, { invalidRoot: true }); await run.start();
  assert.equal(run.handlers.has('provider:catalog'), true);
  assert.equal(run.handlers.has('tmdb:set'), true);
  assert.equal(run.windows.length, 1);
});

test('second launch never opens a window before startup has registered its handlers', async t => {
  const run = boot(t);
  run.app.emit('second-instance');
  assert.equal(run.windows.length, 0);
  await run.start();
  assert.equal(run.windows.length, 1);
});

test('a fatal startup error is reported and cannot leave a window with missing handlers', async t => {
  const run = boot(t, { brokenStore: true }); await run.start();
  assert.equal(run.windows.length, 0);
  assert.equal(run.errors.length, 1);
  assert.equal(run.app.quitted, true);
  run.app.emit('second-instance');
  assert.equal(run.windows.length, 0);
});
