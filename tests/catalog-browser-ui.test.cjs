const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(facetOverrides = {}) {
  const elements = new Map(), requests = [];
  function element(id) {
    const classes = new Set();
    return { id, value: '', children: [], disabled: false, textContent: '', dataset: {}, events: {},
      classList: { contains: name => classes.has(name), add: name => classes.add(name), toggle(name, on) { on ? classes.add(name) : classes.delete(name); } },
      replaceChildren(...children) { this.children = children; if (this.id !== 'allGrid') this.value = children[0]?.value || ''; },
      append(...children) { this.children.push(...children); }, addEventListener(name, fn) { this.events[name] = fn; },
      replaceWith(replacement) { elements.set(this.id, replacement); }, setAttribute() {},
      scrollTo() {}, reportValidity() {}, reset() { for (const name of ['catalogGenre', 'catalogFormat', 'catalogYear', 'catalogSeason']) elements.get(name).value = ''; for (const label of elements.get('catalogExtraFilters').children) label.children[0].value = ''; }
    };
  }
  for (const id of ['catalogFilters', 'catalogFilterNote', 'catalogExtraFilters', 'catalogGenre', 'catalogFormat', 'catalogYear', 'catalogSeason', 'catalogGenreField', 'catalogFormatField', 'catalogYearField', 'catalogSeasonField', 'catalogEmpty', 'catalogMore', 'catalogFilterReset', 'allGrid', 'allStatus', 'main']) elements.set(id, element(id));
  const card = item => ({ dataset: { id: String(item.mal_id) }, title: item.title });
  const context = vm.createContext({ state: { source: 'reanime' }, allSort: () => 'popular', card,
    $: selector => elements.get(selector.slice(1)), $$: () => [...elements.values()],
    Option: function (name, value) { this.name = name; this.value = value; },
    document: { querySelector: () => elements.get('main'), createElement: () => element('') },
    renderCards: (selector, items) => elements.get(selector.slice(1)).replaceChildren(...items.map(card)),
    window: { lilac: {
      catalogFacets: async () => ({ genres: [{ value: 'Action', name: '액션' }, { value: 'Comedy', name: '코미디' }], formats: [{ value: 'TV', name: 'TV 애니' }], year: true, season: true, yearOptions: [], sorts: ['popular'], note: '', ...facetOverrides }),
      catalogBrowse: (_, filters) => new Promise(resolve => requests.push({ filters, resolve }))
    } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/catalog-browser.js'), 'utf8'), context);
  const browser = vm.runInContext('catalogBrowser', context);
  context.loadFullCatalog = async () => { if (browser.active()) await browser.load(); else elements.get('allGrid').replaceChildren(); };
  const submit = (genre, year = '2025', season = 'WINTER') => { elements.get('catalogGenre').value = genre; elements.get('catalogYear').value = year; elements.get('catalogSeason').value = season; elements.get('catalogFilters').onsubmit({ preventDefault() {} }); };
  return { elements, requests, browser, submit, context };
}

test('an older filter response cannot overwrite the newly selected category', async () => {
  const h = setup(); await h.browser.initialize(); h.submit('Action'); await tick();
  h.submit('Comedy', '2026', 'SPRING'); await tick(); assert.equal(h.requests.length, 2);
  h.requests[1].resolve({ data: [{ mal_id: 'new', title: '새 분류' }], total: 1, nextOffset: 1, done: true }); await tick();
  h.requests[0].resolve({ data: [{ mal_id: 'old', title: '이전 분류' }], total: 1, nextOffset: 1, done: true }); await tick();
  assert.equal(h.elements.get('allGrid').children[0].dataset.id, 'new');
  assert.match(h.elements.get('allStatus').textContent, /코미디.*2026년.*2분기/);
});

test('empty filtered pages can advance, matching pages append, and duplicate pages finish', async () => {
  const h = setup(); await h.browser.initialize(); h.submit('Action'); await tick();
  h.requests[0].resolve({ data: [], nextOffset: 2, done: false }); await tick();
  assert.equal(h.elements.get('catalogMore').classList.contains('hidden'), false);
  const second = h.browser.load(); assert.equal(h.requests[1].filters.offset, 2);
  h.requests[1].resolve({ data: [{ mal_id: 'a', title: '액션' }], nextOffset: 3, done: false }); await second;
  const existingCard = h.elements.get('allGrid').children[0], third = h.browser.load();
  h.requests[2].resolve({ data: [{ mal_id: 'b', title: '다음 작품' }], nextOffset: 4, done: false }); await third;
  assert.equal(h.elements.get('allGrid').children[0], existingCard); assert.equal(h.elements.get('allGrid').children.length, 2);
  const fourth = h.browser.load(); h.requests[3].resolve({ data: [{ mal_id: 'b' }], nextOffset: 5, done: false }); await fourth;
  assert.equal(h.elements.get('catalogMore').classList.contains('hidden'), true);
});

test('resetting while a request is pending restores the unfiltered list', async () => {
  const h = setup(); await h.browser.initialize(); h.submit('Action'); await tick();
  h.elements.get('catalogFilterReset').onclick(); await tick();
  h.requests[0].resolve({ data: [{ mal_id: 'late' }], nextOffset: 1, done: true }); await tick();
  assert.equal(h.browser.active(), false); assert.equal(h.elements.get('allGrid').children.length, 0);
  assert.equal(h.elements.get('catalogGenre').value, ''); assert.equal(h.elements.get('catalogMore').classList.contains('hidden'), true);
});

test('choosing only a quarter uses an available year even when this year is missing', async () => {
  const h = setup({ yearOptions: [{ value: '2025', name: '2025년' }, { value: '2024', name: '2024년' }] });
  h.context.Date = class { getFullYear() { return 2026; } };
  await h.browser.initialize(); h.submit('Action', '', 'WINTER'); await tick();
  assert.equal(h.requests[0].filters.year, '2025'); assert.equal(h.elements.get('catalogYear').value, '2025');
  h.requests[0].resolve({ data: [], nextOffset: 1, done: true }); await tick();
});

test('filtered sorting falls back to a supported order and restores the saved order after reset', () => {
  let active = true;
  const context = vm.createContext({ state: { source: 'linkani' }, ALL_SORTS: { linkani: ['default', 'popular', 'updated'] },
    localStorage: { getItem: () => 'popular' }, catalogBrowser: { active: () => active, sortOptions: () => ['default', 'updated'] } });
  const source = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function allSort()'), source.indexOf('const sortedMode=')), context);
  assert.equal(context.allSort(), 'default'); active = false; assert.equal(context.allSort(), 'popular');
});

test('source-specific controls are submitted, labelled and cleared together with common filters', async () => {
  const h = setup({ season: false, yearOptions: [{ value: '1990-1999', name: '1990년대' }], extraFilters: [
    { key: 'status', label: '방영 상태', options: [{ value: '종영', name: '완결' }] },
    { key: 'order', label: '정렬', options: [{ value: 'title-asc', name: '제목 가나다순' }] }
  ] });
  await h.browser.initialize();
  const controls = h.elements.get('catalogExtraFilters').children.map(label => label.children[0]);
  controls[0].value = '종영'; controls[1].value = 'title-asc';
  h.submit('Action', '1990-1999', ''); await tick();
  assert.equal(h.requests[0].filters.year, '1990-1999'); assert.equal(h.requests[0].filters.status, '종영'); assert.equal(h.requests[0].filters.order, 'title-asc');
  assert.equal(h.browser.sortOptions().length, 0, 'the source order dropdown replaces the top sort chips');
  h.requests[0].resolve({ data: [], total: 0, nextOffset: 2, done: true }); await tick();
  assert.match(h.elements.get('allStatus').textContent, /1990년대.*완결.*제목 가나다순/);
  h.elements.get('catalogFilterReset').onclick(); await tick();
  assert.equal(controls[0].value, ''); assert.equal(controls[1].value, ''); assert.equal(h.browser.active(), false);
});

test('RE extra conditions offer only native search sort orders and reset restores the episode sort option', async () => {
  const h = setup({ sorts: ['popular', 'year', 'updated', 'score'], extraSorts: ['popular', 'year', 'score'], extraFilters: [{ key: 'status', label: '방영 상태', options: [{ value: 'Finished', name: '완결' }] }] });
  await h.browser.initialize(); h.elements.get('catalogExtraFilters').children[0].children[0].value = 'Finished';
  h.submit('Action'); await tick();
  assert.equal(h.browser.sortOptions().includes('updated'), false);
  h.requests[0].resolve({ data: [], nextOffset: 1, done: true }); await tick();
  h.elements.get('catalogFilterReset').onclick(); await tick();
  assert.equal(h.browser.sortOptions().includes('updated'), true);
});
