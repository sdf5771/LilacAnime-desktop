const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCatalogBrowser } = require('../electron/catalog-browser.cjs');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

function setup(overrides = {}) {
  const requests = [];
  const deps = {
    reanimeBase: 'https://reanime.test', animenosubBase: 'https://animenosub.test', linkaniBase: 'https://linkani.test',
    reanimeFetch: async url => { requests.push(url); return url.includes('facets=true') ? { facets: { genres: { Action: 100, Comedy: 200 }, format: { TV: 100, MOVIE: 30 } } } : { results: Array.from({ length: 36 }, (_, at) => ({ mal_id: String(Number(new URL(url).searchParams.get('offset')) + at), title: `작품 ${at}` })), total: 80 }; },
    reanimeItems: root => root.results,
    animenosubFetch: async url => { requests.push(url); return '<input name="genre[]" value="action"><input name="type" value="tv"><input name="type" value="movie"><input name="season[]" value="winter-2026"><input name="season[]" value="spring-2026"><input name="season[]" value="fall-2025">'; },
    animenosubItems: () => [],
    linkkfTags: async () => ({ genres: [{ id: 10, name: '액션' }], formats: [{ id: 20, name: '극장판' }], years: [{ id: 30, name: '2026년' }] }),
    linkkfFilter: async request => { requests.push(request); return { data: [{ mal_id: 'linkkf:1' }], total: 100, totalPages: 3 }; },
    miruroApi: async (name, request) => { requests.push(request); return { data: [{ id: 'show' }], next_cursor: 'next:cursor', has_more: true }; }, miruroItem: raw => ({ mal_id: `miruro:${raw.id}` }),
    linkaniFetch: async url => { requests.push(url); return '<a href="/list/2/class/Action/">Action</a><a href="/list/2/class/Slice+of+Life/">Slice of Life</a><a href="/list/2/class/%EC%9B%94/">월</a><a href="/list/2/lang/TV/">TV</a><a href="/list/2/lang/Movie/">Movie</a><a href="/list/2/lang/OVA/">OVA</a><a href="/list/2/year/2026/">2026</a><a href="/list/2/year/2025/">2025</a>'; }, linkaniItems: () => [{ mal_id: 'linkani:tv', type: 'TV' }],
    ohliBrowse: async (page, format) => { requests.push({ ohli: page, format }); return { data: [{ mal_id: 'ohli:tv', type: 'TV' }, { mal_id: 'ohli:movie', type: 'Movie' }], done: page >= 3 }; },
    ohliBase: 'https://ohli.test', ohliAnime: item => item,
    ohliPage: async url => { requests.push(url); const params = new URL(url).searchParams, page = Number(params.get('page')) || 1;
      if (decodeURIComponent(new URL(url).pathname) === '/방영중') return { sca: params.get('weekday'), items: [{ mal_id: 'ohli:1' }] };
      return { filterOptions: { genres: [{ items: [{ value: '액션', label: '액션' }] }, { items: [{ value: '마법', label: '마법' }] }], years: [{ value: '2026', label: '2026' }, { value: '2025', label: '2025' }, { value: '1990-1999', label: '1990년대' }, { value: '0-1979', label: '1979년 이전' }] },
        comics: { data: [{ mal_id: `ohli:${page}`, type: params.get('types[0]') === '극장판' ? 'Movie' : 'TV' }], total: 73, next_page_url: page < 3 ? `https://ohli.test/?page=${page + 1}` : null } };
    },
    ...overrides
  };
  return { browser: createCatalogBrowser(deps), requests, deps };
}

test('RE:Anime genre, format, year and quarter apply to the server catalog with pagination', async () => {
  const { browser, requests } = setup();
  const first = await browser.browse('reanime', { genre: 'Action', format: 'TV', year: '2026', season: 'FALL', sort: 'score' });
  const url = new URL(requests.at(-1));
  for (const [name, value] of Object.entries({ genre: 'Action', format: 'TV', year: '2026', season: 'FALL', sort: 'score_desc', offset: '0', limit: '36' })) assert.equal(url.searchParams.get(name), value);
  assert.equal(first.total, 80); assert.equal(first.nextOffset, 36); assert.equal(first.done, false);
  await browser.browse('reanime', { genre: 'Comedy', offset: first.nextOffset, sort: 'popular' });
  assert.equal(new URL(requests.at(-1)).searchParams.get('offset'), '36');
  assert.equal(new URL(requests.at(-1)).searchParams.get('genre'), 'Comedy');
});

test('RE additional filters use the native search, including year sorting without dropping conditions', async () => {
  const h = setup(), original = h.deps.reanimeFetch;
  h.deps.reanimeFetch = async url => { const root = await original(url); if (root.facets) root.facets.tags = { Magic: 10 }; return root; };
  await h.browser.browse('reanime', { tag: 'Magic', status: 'Finished', country: 'JP', audio: 'dub', rating: 'PG-13', studio: 'Kyoto Animation', character: 'Naruto Uzumaki', staff: 'Hayao Miyazaki', sort: 'year' });
  const params = new URL(h.requests.at(-1)).searchParams;
  for (const [key, value] of Object.entries({ tag: 'Magic', status: 'Finished', country: 'JP', audio: 'dub', rating: 'PG-13', studio: 'Kyoto Animation', character: 'Naruto Uzumaki', staff: 'Hayao Miyazaki', sort: 'year_desc' })) assert.equal(params.get(key), value);
  await assert.rejects(h.browser.browse('reanime', { status: 'Finished', sort: 'updated' }), /추가 조건/);
});

test('RE format taxonomy includes special native formats without duplicate case variants', async () => {
  const h = setup({ reanimeFetch: async () => ({ facets: { genres: {}, format: { MOVIE: 10, Movie: 2, CM: 1, PV: 1, 'TV Special': 1 } } }) });
  assert.deepEqual((await h.browser.facets('reanime')).formats.map(item => item.value), ['CM', 'MOVIE', 'PV', 'TV SPECIAL']);
});

test('empty results finish cleanly and retain a zero total', async () => {
  const h = setup(), original = h.deps.reanimeFetch;
  h.deps.reanimeFetch = url => url.includes('facets=true') ? original(url) : Promise.resolve({ results: [], total: 0 });
  const result = await h.browser.browse('reanime', { year: '1800', season: 'WINTER' });
  assert.equal(result.done, true); assert.equal(result.total, 0); assert.deepEqual(result.data, []);
});

test('facet requests are shared; a failed request can be retried', async () => {
  const h = setup(); await Promise.all([h.browser.facets('reanime'), h.browser.facets('reanime')]);
  assert.equal(h.requests.length, 1);
  let calls = 0;
  const retry = setup({ reanimeFetch: async () => { if (++calls === 1) throw new Error('offline'); return { facets: { genres: { Comedy: 1 }, format: { TV: 1 } } }; } });
  await assert.rejects(retry.browser.facets('reanime'), /offline/);
  assert.equal((await retry.browser.facets('reanime')).genres[0].name, '코미디'); assert.equal(calls, 2);
});

test('unsupported genres, formats, years and quarters never become ignored server filters', async () => {
  const h = setup();
  for (const request of [{ genre: 'unknown' }, { format: 'unknown' }, { season: 'FALL' }, { year: 'NaN' }, { year: '2026', season: 'unknown' }]) await assert.rejects(h.browser.browse('reanime', request));
  await assert.rejects(h.browser.browse('miruro', { genre: 'unknown' }));
  await assert.rejects(h.browser.browse('ohli24', { year: '2026', season: 'WINTER' }));
});

test('Animenosub keeps native genre slugs and combines all available quarters for a year', async () => {
  const h = setup(), facets = await h.browser.facets('animenosub');
  assert.deepEqual(facets.yearOptions.map(item => item.value), ['2026', '2025']);
  const result = await h.browser.browse('animenosub', { genre: 'action', format: 'tv', year: '2026', sort: 'popular' });
  const params = new URL(h.requests.at(-1)).searchParams;
  assert.equal(params.get('genre[0]'), 'action'); assert.equal(params.get('type'), 'tv');
  assert.equal(params.get('season[0]'), 'winter-2026'); assert.equal(params.get('season[1]'), 'spring-2026');
  assert.equal(result.done, true);
});

test('Animenosub a missing quarter returns empty instead of the unfiltered list', async () => {
  const h = setup(); await h.browser.facets('animenosub');
  const count = h.requests.length, result = await h.browser.browse('animenosub', { year: '2026', season: 'SUMMER' });
  assert.deepEqual(result.data, []); assert.equal(result.done, true); assert.equal(h.requests.length, count);
});

test('Animenosub studio, release status, subtitle kind and native title order are preserved on later pages', async () => {
  const h = setup({ animenosubFetch: async url => {
    h.requests.push(url);
    return '<input name="genre[]" value="action"><input name="type" value="tv"><input name="season[]" value="winter-2025"><label><input name="studio[]" value="bones">Bones</label><input name="status" value="completed"><input name="sub" value="dub"><input name="order" value="titlereverse">';
  } });
  await h.browser.browse('animenosub', { genre: 'action', format: 'tv', year: '2025', studio: 'bones', status: 'completed', sub: 'dub', order: 'titlereverse', offset: 2 });
  const params = new URL(h.requests.at(-1)).searchParams;
  for (const [key, value] of Object.entries({ 'studio[0]': 'bones', status: 'completed', sub: 'dub', order: 'titlereverse', page: '2', 'season[0]': 'winter-2025' })) assert.equal(params.get(key), value);
});

test('Linkkf uses taxonomy ids and its real total-page boundary', async () => {
  const h = setup(), result = await h.browser.browse('linkkf', { genre: '10', format: '20', year: '30', offset: 3 });
  assert.deepEqual(h.requests[0], { page: 3, limit: 36, seasonTypeIds: [20], genreIds: [10], yearIds: [30] });
  assert.equal(result.done, true); assert.equal(result.total, 100);
});

test('a failed Linkkf taxonomy cannot be cached as a partially supported filter menu', async () => {
  let offline = true;
  const context = vm.createContext({ LINKKF_API: 'https://linkkf.test', linkkfFetch: async url => {
    if (offline && url.includes('anigenres')) throw new Error('offline');
    return { terms: [{ tag_ID: 10, name: '분류', count: 1 }] };
  } });
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('async function linkkfFilterTags()'), source.indexOf('async function linkkfFilter(')), context);
  const h = setup({ linkkfTags: context.linkkfFilterTags });
  await assert.rejects(h.browser.facets('linkkf'), /offline/);
  offline = false;
  const facets = await h.browser.facets('linkkf');
  assert.equal(facets.genres.length, 1); assert.equal(facets.formats.length, 1); assert.equal(facets.yearOptions.length, 1);
});

test('Miruro keeps its opaque cursor and sends only its supported filters', async () => {
  const h = setup(), first = await h.browser.browse('miruro', { year: '2026', season: 'SPRING', sort: 'popular' });
  assert.equal(first.nextOffset, 'next:cursor'); assert.equal(first.done, false);
  await h.browser.browse('miruro', { year: '2026', season: 'SPRING', offset: first.nextOffset });
  assert.equal(h.requests.at(-1).cursor, 'next:cursor'); assert.equal(h.requests.at(-1).season_year, '2026'); assert.equal(h.requests.at(-1).season, 'SPRING');
});

test('Linkani uses server taxonomy for year and format instead of guessing from titles', async () => {
  const h = setup(), first = await h.browser.browse('linkani', { format: 'Movie', year: '2026' });
  assert.equal(h.requests[1], 'https://linkani.test/list/2/year/2026/lang/Movie/'); assert.equal(first.data[0].type, 'Movie'); assert.equal(first.done, false); assert.equal(first.nextOffset, 2);
  await h.browser.browse('linkani', { format: 'Movie', year: '2026', offset: 2 }); assert.equal(h.requests[2], 'https://linkani.test/list/2/year/2026/lang/Movie/page/2/');
});

test('Linkani discovers genres, OVA and years, excludes weekdays and combines all filters on later pages', async () => {
  const h = setup(), facets = await h.browser.facets('linkani');
  assert.deepEqual(facets.genres.map(item => item.value), ['Action', 'Slice of Life']);
  assert.ok(facets.formats.some(item => item.value === 'OVA'));
  assert.deepEqual(facets.yearOptions.map(item => item.value), ['2026', '2025']);
  const result = await h.browser.browse('linkani', { genre: 'Slice of Life', format: 'OVA', year: '2025', offset: 2 });
  assert.equal(h.requests.at(-1), 'https://linkani.test/list/2/class/Slice%20of%20Life/year/2025/lang/OVA/page/2/');
  assert.equal(result.data[0].type, 'OVA');
  await assert.rejects(h.browser.browse('linkani', { year: '1800' }), /연도/);
});

test('Linkani finishes on its disabled next-page link even when the last page has cards', async () => {
  const h = setup(), original = h.deps.linkaniFetch;
  h.deps.linkaniFetch = async url => `${await original(url)}<a href="javascript:;">→</a>`;
  assert.equal((await h.browser.browse('linkani', { format: 'TV' })).done, true);
});

test('애니24 uses the whole filtered catalog with the server pagination boundary', async () => {
  const h = setup(), first = await h.browser.browse('ohli24', { format: 'Movie' });
  assert.equal(first.data.length, 1); assert.equal(first.data[0].type, 'Movie');
  const second = await h.browser.browse('ohli24', { format: 'Movie', offset: first.nextOffset });
  assert.equal(new URL(h.requests.at(-1)).searchParams.get('page'), '2');
  assert.equal(new URL(h.requests.at(-1)).searchParams.get('types[0]'), '극장판');
  assert.equal(second.done, false); assert.equal((await h.browser.browse('ohli24', { offset: 3 })).done, true);
});

test('애니24 discovers genre groups and year ranges and combines them with status and native sorting', async () => {
  const h = setup(), facets = await h.browser.facets('ohli24');
  assert.equal(h.requests[0], 'https://ohli.test/?sort=update-desc', 'taxonomy covers all boards, including movie-only genres');
  assert.deepEqual(facets.genres.map(item => item.value), ['액션', '마법']);
  assert.ok(facets.yearOptions.some(item => item.value === '1990-1999'));
  const result = await h.browser.browse('ohli24', { genre: '액션', year: '1990-1999', format: 'TV', status: '종영', order: 'release-asc', offset: 2 });
  const params = new URL(h.requests.at(-1)).searchParams;
  assert.equal(params.get('genres[0]'), '액션'); assert.equal(params.get('years[0]'), '1990-1999');
  assert.equal(params.get('types[0]'), '종영'); assert.equal(params.get('sort'), 'release-asc'); assert.equal(params.get('page'), '2');
  assert.equal(result.total, 73);
  await assert.rejects(h.browser.browse('ohli24', { year: '1980-1999' }), /연도/);
});

test('애니24 weekday requests select airing works and reject contradictory movie/completed choices', async () => {
  const h = setup(); await h.browser.browse('ohli24', { weekday: '월요일', genre: '액션', year: '2026' });
  const params = new URL(h.requests.find(url => new URL(url).searchParams.has('types[0]'))).searchParams;
  assert.equal(params.get('weekday'), '월요일'); assert.equal(params.get('types[0]'), '방영중');
  await assert.rejects(h.browser.browse('ohli24', { status: '종영', weekday: '월요일' }), /방영 중/);
  await assert.rejects(h.browser.browse('ohli24', { format: 'Movie', status: '종영' }), /극장판/);
});

test('Miruro combines genre, format, status, country, source, tags and score with an opaque next cursor', async () => {
  const h = setup(); await h.browser.browse('miruro', { genre: 'Action', format: 'TV', status: 'FINISHED', country: 'JP', source: 'MANGA', tag: 'Magic, Isekai,Magic', adult: 'false', scoreMin: '70', scoreMax: '90', offset: 'opaque:next' });
  const params = h.requests.at(-1);
  assert.equal(params.genre_all, 'Action'); assert.equal(params.format, 'TV'); assert.equal(params.status, 'FINISHED'); assert.equal(params.country_of_origin, 'JP');
  assert.equal(params.source, 'MANGA'); assert.equal(params.tag_all, 'Magic,Isekai'); assert.equal(params.is_adult, 'false');
  assert.equal(params.score_gte, '70'); assert.equal(params.score_lte, '90'); assert.equal(params.cursor, 'opaque:next');
  await assert.rejects(h.browser.browse('miruro', { scoreMin: '101' }), /범위/);
  await assert.rejects(h.browser.browse('miruro', { scoreMin: '90', scoreMax: '70' }), /최소 평점/);
  await assert.rejects(h.browser.browse('miruro', { status: 'NOT_YET_RELEASED', scoreMin: '1' }), /방영 예정/);
});

test('Miruro filtered update order uses one native query and is labelled as metadata updates', async () => {
  const h = setup();
  const result = await h.browser.browse('miruro', { sort: 'updated', genre: 'Action' });
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].sort, '-updated_at'); assert.equal(h.requests[0].genre_all, 'Action');
  assert.match(result.note, /작품 정보/);
  assert.equal((await h.browser.facets('miruro')).sortLabels.updated, '작품 정보 업데이트순');
});

test('Linkani weekday keeps year and format in the server route', async () => {
  const h = setup(); await h.browser.browse('linkani', { weekday: '월', format: 'TV', year: '2025' });
  assert.equal(h.requests.at(-1), 'https://linkani.test/list/2/class/%EC%9B%94/year/2025/lang/TV/');
  await assert.rejects(h.browser.browse('linkani', { weekday: '월', genre: 'Action' }), /각각 선택/);
});

test('RE latest filters preserve release order from the complete catalog', async () => {
  const data = [{ mal_id: 'fall', year: 2026, season: 'FALL', type: 'TV', genres: [{ name: 'Action' }] }, { mal_id: 'winter', year: 2026, season: 'WINTER', type: 'TV', genres: [{ name: 'Comedy' }] }];
  const h = setup({ reanimeReleaseItems: () => data });
  const result = await h.browser.browse('reanime', { sort: 'year', year: '2026', genre: 'Action' });
  assert.deepEqual(result.data.map(item => item.mal_id), ['fall']); assert.equal(result.total, 1);
  const pending = setup({ reanimeReleaseItems: () => null });
  await assert.rejects(pending.browser.browse('reanime', { sort: 'year' }), /분기 정보/);
});

test('filtered updates use native update order and only matching recent episodes', async () => {
  const h = setup({ updates: { snapshot: async () => [{ mal_id: 'match', year: 2026, season: 'FALL', type: 'TV', genres: [{ name: 'Action' }] }, { mal_id: 'outside', year: 2025, season: 'FALL', type: 'TV', genres: [{ name: 'Action' }] }] } });
  const result = await h.browser.browse('reanime', { sort: 'updated', year: '2026', genre: 'Action' });
  assert.deepEqual(result.data.map(item => item.mal_id), ['match']); assert.equal(result.total, 1);
  await h.browser.browse('animenosub', { sort: 'updated', genre: 'action' });
  assert.equal(new URL(h.requests.at(-1)).searchParams.get('order'), 'update');
  await h.browser.browse('miruro', { sort: 'year', year: '2026' });
  assert.equal(h.requests.at(-1).sort, '-started_on');
});
