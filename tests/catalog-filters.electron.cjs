// Offline UI smoke check: node node_modules/electron/cli.js tests/catalog-filters.electron.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'), { createCatalogBrowser } = require('../electron/catalog-browser.cjs');
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lilac-filter-ui-'));
app.setPath('userData', path.join(dir, 'profile')); app.disableHardwareAcceleration();
function fail(error) { console.error(error.stack || error); app.exit(1); }
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
app.whenReady().then(async () => {
  const backend = createCatalogBrowser({
    reanimeFetch: async () => ({ facets: { genres: { Action: 10 }, format: { TV: 10 }, tags: { Magic: 5 } } }),
    animenosubBase: 'https://animenosub.test', animenosubFetch: async () => '<input name="genre[]" value="action"><input name="type" value="tv"><input name="season[]" value="winter-2025"><label><input name="studio[]" value="bones">Bones</label><input name="status" value="completed"><input name="sub" value="dub"><input name="order" value="rating">',
    ohliBase: 'https://ohli.test', ohliPage: async () => ({ filterOptions: { genres: [{ items: [{ value: '액션', label: '액션' }, { value: '판타지', label: '판타지' }] }], years: [{ value: '2026', label: '2026' }, { value: '1990-1999', label: '1990년대' }] } })
  });
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace('<head>', `<head><base href="${pathToFileURL(path.join(root, 'src') + path.sep).href}">`);
  const file = path.join(dir, 'filters.html'); fs.writeFileSync(file, html);
  const win = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { offscreen: true } });
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  for (const provider of ['ohli24', 'miruro', 'reanime', 'animenosub']) {
    await win.loadFile(file);
    const facets = await backend.facets(provider);
    await win.webContents.executeJavaScript(`
      var $ = selector => document.querySelector(selector), $$ = selector => [...document.querySelectorAll(selector)];
      var state = { source: ${JSON.stringify(provider)} }, requests = [];
      function allSort() { return 'popular'; } function card() { return document.createElement('article'); }
      function renderCards(selector, items) { $(selector).replaceChildren(...items.map(card)); }
      function loadFullCatalog() { return catalogBrowser.active() ? catalogBrowser.load() : Promise.resolve(); }
      window.lilac = { catalogFacets: async () => (${JSON.stringify(facets)}), catalogBrowse: async (_, request) => { requests.push(request); return { data: [], total: 0, nextOffset: 2, done: true }; } };
      $$('.view').forEach(el => el.classList.remove('active')); $('#allView').classList.add('active'); $('#allView').style.animation = 'none';
      ${fs.readFileSync(path.join(root, 'src/catalog-browser.js'), 'utf8')}
      catalogBrowser.initialize(); void 0;
    `);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await win.webContents.executeJavaScript(`$('#catalogGenreField').classList.contains('hidden')`), false);
    assert.equal(await win.webContents.executeJavaScript(`$('#catalogExtraFilters').classList.contains('hidden')`), false);
    if (provider === 'ohli24') {
      await win.webContents.executeJavaScript(`$('#catalogGenre').value = '액션'; $('#catalogYear').value = '1990-1999'; $('#catalogExtra-status').value = '종영'; $('#catalogExtra-order').value = 'title-asc'; $('#catalogFilters').requestSubmit();`);
      await new Promise(resolve => setTimeout(resolve, 100));
      const request = await win.webContents.executeJavaScript('requests.at(-1)');
      assert.equal(request.year, '1990-1999'); assert.equal(request.order, 'title-asc'); assert.equal(request.status, '종영');
    } else if (provider === 'miruro') {
      await win.webContents.executeJavaScript(`$('#catalogGenre').value = 'Fantasy'; $('#catalogFormat').value = 'TV'; $('#catalogExtra-status').value = 'FINISHED'; $('#catalogExtra-scoreMin').value = '70'; $('#catalogFilters').requestSubmit();`);
      await new Promise(resolve => setTimeout(resolve, 100));
      const request = await win.webContents.executeJavaScript('requests.at(-1)');
      assert.equal(request.genre, 'Fantasy'); assert.equal(request.status, 'FINISHED'); assert.equal(request.scoreMin, '70');
    } else if (provider === 'reanime') {
      await win.webContents.executeJavaScript(`$('#catalogGenre').value = 'Action'; $('#catalogExtra-status').value = 'Finished'; $('#catalogExtra-tag').value = 'Magic'; $('#catalogExtra-studio').value = 'Kyoto Animation'; $('#catalogFilters').requestSubmit();`);
      await new Promise(resolve => setTimeout(resolve, 100));
      const request = await win.webContents.executeJavaScript('requests.at(-1)');
      assert.equal(request.status, 'Finished'); assert.equal(request.tag, 'Magic'); assert.equal(request.studio, 'Kyoto Animation');
    } else {
      await win.webContents.executeJavaScript(`$('#catalogExtra-status').value = 'completed'; $('#catalogExtra-studio').value = 'bones'; $('#catalogExtra-sub').value = 'dub'; $('#catalogExtra-order').value = 'rating'; $('#catalogFilters').requestSubmit();`);
      await new Promise(resolve => setTimeout(resolve, 100));
      const request = await win.webContents.executeJavaScript('requests.at(-1)');
      assert.equal(request.status, 'completed'); assert.equal(request.studio, 'bones'); assert.equal(request.sub, 'dub'); assert.equal(request.order, 'rating');
    }
    fs.writeFileSync(path.join(dir, `${provider}.png`), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`$('#catalogFilterReset').click();`);
    assert.equal(await win.webContents.executeJavaScript(`$('#catalogExtra-status').value`), '', 'reset clears extra controls');
    console.log(provider, 'controls, submission, year ranges and reset passed');
  }
  console.log('Previews:', dir); win.destroy(); app.quit();
}).catch(fail);
