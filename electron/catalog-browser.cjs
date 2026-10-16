const cheerio = require('cheerio');

const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
const GENRE_NAMES = { action: '액션', adventure: '모험', comedy: '코미디', drama: '드라마', fantasy: '판타지', horror: '공포', mystery: '미스터리', romance: '로맨스', 'sci-fi': 'SF', 'slice of life': '일상', sports: '스포츠', supernatural: '초자연', psychological: '심리', thriller: '스릴러', music: '음악', mecha: '메카', ecchi: '에치', 'mahou shoujo': '마법소녀' };
const FORMAT_NAMES = { TV: 'TV 애니', MOVIE: '극장판', OVA: 'OVA', ONA: '웹 애니', SPECIAL: '스페셜', TV_SHORT: '단편 TV', MUSIC: '뮤직비디오', 'LIVE ACTION': '실사', BD: 'BD', CM: '광고', PV: '프로모션 영상', 'TV SPECIAL': 'TV 스페셜' };
const option = (value, name = value) => ({ value: String(value), name: String(name) });
const genreName = name => GENRE_NAMES[String(name).toLowerCase().replace(/-/g, ' ')] || GENRE_NAMES[String(name).toLowerCase()] || name;
const formatName = name => FORMAT_NAMES[String(name).toUpperCase()] || name;
const unique = options => [...new Map(options.map(item => [item.value, item])).values()];
const weekdays = ['일', '월', '화', '수', '목', '금', '토'].map(day => option(day, `${day}요일`));
const MIRURO_GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Hentai', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];
const OHLI_ORDERS = { 'update-desc': '업데이트 최신순', 'update-asc': '업데이트 오래된순', 'release-desc': '공개일 최신순', 'release-asc': '공개일 오래된순', 'rating-desc': '별점 높은순', 'title-asc': '제목 가나다순' };
const selectFilter = (key, label, options) => ({ key, label, options });

// Each source supplies its own taxonomy and pagination. Filters never operate only on the visible home cards.
function createCatalogBrowser(deps) {
  const cache = new Map();
  async function cachedValue(key, load) {
    const known = cache.get(key); if (known && Date.now() - known.time < 5 * 60000) return known.promise;
    const entry = { time: Date.now(), promise: Promise.resolve().then(load) }; cache.set(key, entry);
    try { return await entry.promise; } catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
  }
  async function facets(provider) {
    const existing = cache.get(provider);
    if (existing && Date.now() - existing.time < 10 * 60 * 1000) return existing.promise;
    const promise = loadFacets(provider);
    const entry = { time: Date.now(), promise }; cache.set(provider, entry);
    try { return await promise; } catch (error) { if (cache.get(provider) === entry) cache.delete(provider); throw error; }
  }
  async function loadFacets(provider) {
    const base = { genres: [], formats: [], year: false, season: false, yearOptions: [], extraFilters: [], sorts: ['default'], note: '' };
    if (provider === 'reanime') {
      const root = await deps.reanimeFetch(`${deps.reanimeBase}/api/v1/search?facets=true&limit=0`), data = root.facets;
      if (!data?.genres || !data?.format) throw new Error('RE:Anime 분류를 불러오지 못했습니다.');
      return { ...base, genres: Object.keys(data.genres).sort().map(name => option(name, genreName(name))),
        formats: unique(Object.keys(data.format).sort().map(name => option(name.toUpperCase(), formatName(name)))),
        year: true, season: true, sorts: ['popular', 'year', 'updated', 'score'], extraSorts: ['popular', 'year', 'score'],
        extraFilters: [
          selectFilter('tag', '태그', Object.keys(data.tags || {}).sort().map(name => option(name))),
          selectFilter('status', '방영 상태', [['Finished', '완결'], ['Releasing', '방영 중'], ['Not Yet Released', '방영 예정'], ['Cancelled', '취소'], ['Unknown', '미분류']].map(([value, name]) => option(value, name))),
          selectFilter('country', '제작 국가', [['JP', '일본'], ['KR', '한국'], ['CN', '중국'], ['TW', '대만']].map(([value, name]) => option(value, name))),
          selectFilter('audio', '더빙 제공', [option('dub', '더빙 있음')]),
          selectFilter('rating', '연령 등급', ['G', 'PG', 'PG-13', 'R', 'R+', 'Rx'].map(name => option(name))),
          { key: 'studio', label: '제작사', type: 'text', placeholder: '예: Kyoto Animation', maxLength: 150 },
          { key: 'character', label: '등장인물', type: 'text', placeholder: '사이트의 영문 분류명', maxLength: 150 },
          { key: 'staff', label: '제작진', type: 'text', placeholder: '사이트의 영문 분류명', maxLength: 150 }
        ].filter(field => !field.options || field.options.length), note: '장르·태그·형태·연도·분기·방영 상태·국가·더빙·등급 등을 선택할 수 있습니다. 제작사·등장인물·제작진은 사이트의 분류명을 입력하세요.' };
    }
    if (provider === 'animenosub') {
      const $ = cheerio.load(await deps.animenosubFetch(`${deps.animenosubBase}/anime/`));
      const inputs = name => $('input').filter((_, node) => $(node).attr('name') === name);
      const values = name => unique(inputs(name).map((_, node) => { const value = $(node).attr('value') || ''; const text = $(node).parent().text().trim() || value.replace(/-/g, ' '); return option(value, text); }).get().filter(item => item.value));
      const seasons = values('season[]').map(item => item.value), genres = values('genre[]');
      if (!genres.length && !seasons.length) throw new Error('Animenosub 분류를 불러오지 못했습니다.');
      const years = [...new Set(seasons.map(value => value.match(/-(\d{4})$/)?.[1]).filter(Boolean))].sort((a, b) => Number(b) - Number(a));
      return { ...base, genres: genres.map(item => option(item.value, genreName(item.name))), formats: values('type').map(item => option(item.value, formatName(item.value))),
        year: Boolean(years.length), season: Boolean(seasons.length), seasons, yearOptions: years.map(year => option(year, `${year}년`)), sorts: ['popular', 'year', 'updated', 'score'],
        extraFilters: [selectFilter('studio', '제작사', values('studio[]')),
          selectFilter('status', '방영 상태', values('status').map(item => option(item.value, { ongoing: '방영 중', completed: '완결', upcoming: '방영 예정', hiatus: '휴방' }[item.value] || item.name))),
          selectFilter('sub', '자막·더빙', values('sub').map(item => option(item.value, { sub: '자막', dub: '더빙', raw: 'RAW' }[item.value] || item.name))),
          selectFilter('order', '정렬', values('order').map(item => option(item.value, { title: '제목 A–Z', titlereverse: '제목 Z–A', update: '업데이트 최신순', latest: '최신 등록순', popular: '인기순', rating: '평점순' }[item.value] || item.name)))
        ].filter(field => field.options.length) };
    }
    if (provider === 'linkkf') {
      const tags = await deps.linkkfTags();
      if (!tags.genres?.length && !tags.formats?.length && !tags.years?.length) throw new Error('Linkkf 분류를 불러오지 못했습니다.');
      const convert = list => (list || []).map(tag => option(tag.id, tag.name));
      return { ...base, genres: convert(tags.genres), formats: convert(tags.formats), year: Boolean(tags.years?.length), yearOptions: convert(tags.years), note: '연도는 Linkkf의 분류를 따릅니다. 별도의 분기 정보는 제공하지 않습니다.' };
    }
    if (provider === 'miruro') return { ...base, genres: MIRURO_GENRES.map(name => option(name, genreName(name))), formats: ['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC'].map(name => option(name, formatName(name))), year: true, season: true, sorts: ['popular', 'year', 'updated', 'score'], sortLabels: { updated: '작품 정보 업데이트순' },
      extraFilters: [
        selectFilter('status', '방영 상태', [['FINISHED', '완결'], ['RELEASING', '방영 중'], ['NOT_YET_RELEASED', '방영 예정'], ['CANCELLED', '취소'], ['HIATUS', '휴방']].map(([value, name]) => option(value, name))),
        selectFilter('country', '제작 국가', [['JP', '일본'], ['KR', '한국'], ['CN', '중국'], ['TW', '대만']].map(([value, name]) => option(value, name))),
        selectFilter('source', '원작', [['ORIGINAL', '오리지널'], ['MANGA', '만화'], ['LIGHT_NOVEL', '라이트노벨'], ['VISUAL_NOVEL', '비주얼노벨'], ['GAME', '게임'], ['OTHER', '기타'], ['NOVEL', '소설'], ['DOUJINSHI', '동인지'], ['ANIME', '애니메이션'], ['WEB_NOVEL', '웹소설'], ['LIVE_ACTION', '실사'], ['COMIC', '코믹'], ['MULTIMEDIA_PROJECT', '미디어 믹스'], ['PICTURE_BOOK', '그림책']].map(([value, name]) => option(value, name))),
        selectFilter('adult', '성인 분류', [option('false', '일반 작품'), option('true', '성인 작품')]),
        { key: 'tag', label: '태그', type: 'text', placeholder: '예: Isekai, Magic', maxLength: 500 },
        { key: 'scoreMin', label: '최소 평점 (0~100)', type: 'number', min: 0, max: 100 },
        { key: 'scoreMax', label: '최대 평점 (0~100)', type: 'number', min: 0, max: 100 }
      ], note: '장르·형태·방영 상태·제작 국가·원작·평점 등을 함께 선택할 수 있습니다. 태그는 영문 이름을 쉼표로 구분해 입력하세요.' };
    if (provider === 'linkani') {
      const $ = cheerio.load(await deps.linkaniFetch(`${deps.linkaniBase}/list/2/`));
      const categories = { class: [], year: [], lang: [] };
      $('a[href]').each((_, node) => {
        let path; try { path = new URL($(node).attr('href'), deps.linkaniBase).pathname; } catch { return; }
        const match = path.match(/^\/list\/2\/(class|year|lang)\/([^/]+)\/?$/);
        if (!match) return;
        let value; try { value = decodeURIComponent(match[2].replace(/\+/g, ' ')); } catch { return; }
        if (match[1] === 'class' && /^[월화수목금토일]$/.test(value)) return;
        categories[match[1]].push(option(value, match[1] === 'class' ? genreName(value) : match[1] === 'lang' ? formatName(value) : `${value}년`));
      });
      const genres = unique(categories.class), formats = unique(categories.lang), yearOptions = unique(categories.year).sort((a, b) => Number(b.value) - Number(a.value));
      if (!genres.length && !formats.length && !yearOptions.length) throw new Error('링크애니 분류를 불러오지 못했습니다.');
      return { ...base, genres, formats, year: Boolean(yearOptions.length), yearOptions, extraFilters: [selectFilter('weekday', '방영 요일', weekdays)], sorts: ['default', 'updated'], note: '장르·형태·연도·요일은 링크애니의 분류를 따릅니다. 분기 정보는 제공하지 않습니다.' };
    }
    if (provider === 'ohli24') {
      const page = await deps.ohliPage(`${deps.ohliBase}/?sort=update-desc`), filters = page.filterOptions;
      if (!filters?.genres || !filters?.years) throw new Error('애니24 분류를 불러오지 못했습니다.');
      return { ...base, genres: unique(filters.genres.flatMap(group => group.items || []).map(item => option(item.value, item.label))),
        formats: [option('TV', 'TV 애니'), option('Movie', '극장판')], year: true,
        yearOptions: filters.years.map(item => option(item.value, /^\d{4}$/.test(item.value) ? `${item.label}년` : item.label)),
        extraFilters: [selectFilter('status', '방영 상태', [option('방영중', '방영 중'), option('종영', '완결')]),
          selectFilter('weekday', '방영 요일', [...weekdays.map(item => option(item.name, item.name)), option('기타', '기타')]), selectFilter('order', '정렬', Object.entries(OHLI_ORDERS).map(([value, name]) => option(value, name)))],
        sorts: ['default', 'updated'], note: '장르·연도·연대·방영 상태·요일·정렬을 선택할 수 있습니다. 요일은 방영 중 작품에 적용합니다. 분기 정보는 제공하지 않습니다.' };
    }
    throw new Error('이 콘텐츠 소스는 상세 필터를 지원하지 않습니다.');
  }
  async function browse(provider, request = {}) {
    const taxonomy = await facets(provider), genre = String(request.genre || ''), format = String(request.format || ''), year = String(request.year || ''), season = String(request.season || '');
    if (genre && !taxonomy.genres.some(item => item.value === genre)) throw new Error('장르를 다시 선택해 주세요.');
    if (format && !taxonomy.formats.some(item => item.value === format)) throw new Error('작품 형태를 다시 선택해 주세요.');
    if (year && (!taxonomy.year || (taxonomy.yearOptions.length ? !taxonomy.yearOptions.some(item => item.value === year) : !/^\d+$/.test(year) || Number(year) <= 0))) throw new Error('연도를 다시 선택해 주세요.');
    if (season && (!taxonomy.season || !SEASONS.includes(season) || !year)) throw new Error('분기와 연도를 함께 선택해 주세요.');
    const extras = {};
    for (const field of taxonomy.extraFilters) {
      const value = String(request[field.key] ?? '').trim(); if (!value) continue;
      if (field.options && !field.options.some(item => item.value === value)) throw new Error(`${field.label}를 다시 선택해 주세요.`);
      if (field.type === 'number' && (!Number.isFinite(Number(value)) || Number(value) < field.min || Number(value) > field.max)) throw new Error(`${field.label} 범위를 확인해 주세요.`);
      if (field.maxLength && value.length > field.maxLength) throw new Error(`${field.label} 입력이 너무 깁니다.`);
      extras[field.key] = value;
    }
    for (const key of ['status', 'country', 'source', 'adult', 'tag', 'scoreMin', 'scoreMax', 'weekday', 'order', 'studio', 'character', 'staff', 'audio', 'rating', 'sub']) {
      if (request[key] !== undefined && request[key] !== '' && !taxonomy.extraFilters.some(field => field.key === key)) throw new Error('이 소스에서 지원하지 않는 필터입니다.');
    }
    if (extras.scoreMin !== undefined && extras.scoreMax !== undefined && Number(extras.scoreMin) > Number(extras.scoreMax)) throw new Error('최소 평점은 최대 평점보다 작거나 같아야 합니다.');
    const sort = taxonomy.sorts.includes(request.sort) ? request.sort : taxonomy.sorts[0];
    if (provider === 'reanime' && sort === 'updated' && Object.keys(extras).length) throw new Error('RE:Anime의 추가 조건은 인기순·최신순·평점순에서 사용할 수 있습니다.');
    const offset = Math.max(0, Math.trunc(Number(request.offset) || 0));
    if (sort === 'year' && provider === 'reanime' && !Object.keys(extras).length) {
      const catalog = deps.reanimeReleaseItems();
      if (!catalog) throw new Error('전체 목록의 분기 정보를 불러오는 중입니다. 잠시 뒤 다시 적용해 주세요.');
      const items = catalog.filter(item => (!genre || item.genres?.some(value => value.name === genre)) && (!format || item.type === format) && (!year || String(item.year) === year) && (!season || item.season === season));
      return { data: items.slice(offset, offset + 36), total: items.length, nextOffset: offset + 36, done: offset + 36 >= items.length };
    }
    if (sort === 'updated' && provider === 'reanime') {
      const items = (await deps.updates.snapshot(provider)).filter(item => (!genre || item.genres?.some(value => value.name === genre)) && (!format || item.type === format) && (!year || String(item.year) === year) && (!season || item.season === season));
      return { data: items.slice(offset, offset + 36), total: items.length, nextOffset: offset + 36, done: offset + 36 >= items.length, note: '최근 회차 업데이트 목록에 필터를 적용했습니다.' };
    }
    if (provider === 'reanime') {
      const url = new URL('/api/v1/search', deps.reanimeBase);
      const params = { limit: 36, offset, genre, format, year, season, ...extras, sort: { popular: 'popularity_desc', year: 'year_desc', score: 'score_desc' }[sort] };
      for (const [key, value] of Object.entries(params)) if (value !== '' && value !== undefined) url.searchParams.set(key, String(value));
      const root = await deps.reanimeFetch(url.href), data = deps.reanimeItems(root), total = Number(root.total);
      return { data, total: Number.isFinite(total) ? total : null, nextOffset: offset + data.length, done: !data.length || (Number.isFinite(total) ? offset + data.length >= total : data.length < 36) };
    }
    if (provider === 'miruro') {
      const params = { genre_all: genre || undefined, format: format || undefined, season: season || undefined, season_year: year || undefined,
        status: extras.status, country_of_origin: extras.country, source: extras.source, is_adult: extras.adult,
        tag_all: extras.tag ? [...new Set(extras.tag.split(',').map(value => value.trim()).filter(Boolean))].join(',') : undefined,
        score_gte: extras.scoreMin, score_lte: extras.scoreMax };
      if (extras.status === 'NOT_YET_RELEASED' && (extras.scoreMin !== undefined || extras.scoreMax !== undefined)) throw new Error('방영 예정 작품에는 평점 조건을 적용할 수 없습니다.');
      // Miruro's own filtered search sorts metadata updates; the home feed uses episode updates.
      const root = await deps.miruroApi('anime', { ...params, sort: { popular: '-popularity', year: '-started_on', score: '-score', updated: '-updated_at' }[sort], limit: 15, cursor: request.offset || undefined });
      return { data: (root.data || []).map(deps.miruroItem), nextOffset: root.next_cursor || null, done: !root.has_more || !root.next_cursor,
        ...(sort === 'updated' ? { note: 'Miruro의 작품 정보 업데이트순입니다.' } : {}) };
    }
    if (provider === 'linkkf') {
      const page = Math.max(1, offset), root = await deps.linkkfFilter({ page, limit: 36, seasonTypeIds: format ? [Number(format)] : [], genreIds: genre ? [Number(genre)] : [], yearIds: year ? [Number(year)] : [] });
      return { ...root, nextOffset: page + 1, done: !root.data.length || page >= (root.totalPages || 1) };
    }
    if (provider === 'animenosub') {
      const page = Math.max(1, offset), url = new URL('/anime/', deps.animenosubBase);
      url.searchParams.set('page', String(page)); url.searchParams.set('order', extras.order || { popular: 'popular', year: 'latest', updated: 'update', score: 'rating' }[sort]);
      if (genre) url.searchParams.set('genre[0]', genre);
      if (format) url.searchParams.set('type', format);
      if (extras.studio) url.searchParams.set('studio[0]', extras.studio);
      if (extras.status) url.searchParams.set('status', extras.status);
      if (extras.sub) url.searchParams.set('sub', extras.sub);
      if (year) {
        const seasons = taxonomy.seasons.filter(value => value.endsWith(`-${year}`) && (!season || value === `${season.toLowerCase()}-${year}`));
        if (!seasons.length) return { data: [], nextOffset: page, done: true };
        seasons.forEach((value, index) => url.searchParams.set(`season[${index}]`, value));
      }
      const $ = cheerio.load(await deps.animenosubFetch(url.href)), cards = $('article.bs');
      return { data: deps.animenosubItems(cards.map((_, node) => $.html(node)).get().join('')), nextOffset: page + 1, done: !cards.length };
    }
    const page = Math.max(1, offset);
    if (provider === 'ohli24') {
      if (format === 'Movie' && (extras.status || extras.weekday)) throw new Error('극장판에는 방영 상태·요일 조건을 적용할 수 없습니다.');
      if (extras.weekday && extras.status === '종영') throw new Error('요일은 방영 중 작품과 함께 선택해 주세요.');
      const url = new URL('/', deps.ohliBase), types = format === 'Movie' ? ['극장판'] : extras.weekday ? ['방영중'] : extras.status ? [extras.status] : format === 'TV' ? ['방영중', '종영'] : [];
      types.forEach((value, at) => url.searchParams.set(`types[${at}]`, value));
      if (genre) url.searchParams.set('genres[0]', genre);
      if (year) url.searchParams.set('years[0]', year);
      if (extras.weekday) url.searchParams.set('weekday', extras.weekday);
      url.searchParams.set('sort', extras.order || 'update-desc'); url.searchParams.set('page', String(page));
      const [root, dayIds] = await Promise.all([deps.ohliPage(url.href), extras.weekday ? cachedValue(`ohli24:weekday:${extras.weekday}`, async () => {
        const dayUrl = new URL(`/${encodeURIComponent('방영중')}`, deps.ohliBase); dayUrl.searchParams.set('weekday', extras.weekday);
        const day = await deps.ohliPage(dayUrl.href);
        if (!Array.isArray(day.items) || day.sca !== extras.weekday) throw new Error('애니24 요일 분류를 읽지 못했습니다.');
        return new Set(day.items.map(deps.ohliAnime).map(item => item.mal_id));
      }) : null]);
      const comics = root.comics;
      if (!comics || !Array.isArray(comics.data)) throw new Error('애니24 필터 결과를 읽지 못했습니다.');
      const data = comics.data.map(deps.ohliAnime).filter(item => !dayIds || dayIds.has(item.mal_id));
      return { data, total: dayIds ? null : Number(comics.total), nextOffset: page + 1, done: !comics.next_page_url };
    }
    if (genre && extras.weekday) throw new Error('링크애니의 장르와 요일은 각각 선택해 주세요.');
    const category = genre || extras.weekday;
    const route = `${category ? `class/${encodeURIComponent(category)}/` : ''}${year ? `year/${year}/` : ''}${format ? `lang/${encodeURIComponent(format)}/` : ''}${page > 1 ? `page/${page}/` : ''}`;
    const html = await deps.linkaniFetch(`${deps.linkaniBase}/list/2/${route}`), raw = deps.linkaniItems(html), $ = cheerio.load(html);
    const next = $('a[href]').filter((_, node) => $(node).text().trim() === '→').first().attr('href');
    // Cards omit their type; the server's selected taxonomy is authoritative, including OVA.
    return { data: raw.map(item => format ? { ...item, type: format } : item), nextOffset: page + 1, done: !raw.length || (next !== undefined && !/^(?:https?:\/\/|\/)/.test(next)) };
  }
  return { facets, browse };
}

module.exports = { createCatalogBrowser };
