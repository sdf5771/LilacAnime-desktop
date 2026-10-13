const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function tmdbError(code, status = 0, retryAfterMs = 0) {
  const messages = {
    auth: 'TMDB API 키가 올바르지 않거나 사용할 권한이 없습니다.',
    'rate-limit': 'TMDB 요청이 많아 잠시 기다려야 합니다.',
    timeout: 'TMDB 응답 시간이 초과됐습니다.',
    network: 'TMDB에 연결하지 못했습니다.',
    response: 'TMDB 응답을 읽지 못했습니다.',
    http: `TMDB HTTP ${status}`
  };
  return Object.assign(new Error(messages[code]), { code, status, retryAfterMs });
}

// All callers share request spacing and a 429 cooldown. Requests made for the screen go first and are spaced by
// `interval` (TMDB allows about 50 a second); the catalog index's background lookups only start when no screen request
// waits, spaced by `backgroundInterval`. The same request asked again while it runs shares that request, and a screen
// request's answer is kept for `cacheTtl` (the background ones are kept by the catalog index itself).
function createTmdbClient({ fetch = globalThis.fetch, now = Date.now, sleep = wait, interval = 40, backgroundInterval = 150,
  cacheTtl = 6 * 60 * 60 * 1000, cacheSize = 500 } = {}) {
  const lanes = { front: [], back: [] }, inflight = new Map(), cache = new Map();
  let lastStart = -Infinity, blockedUntil = 0, pumping = false;
  async function pump() {
    if (pumping) return; pumping = true;
    try {
      while (lanes.front.length || lanes.back.length) {
        // Long server cooldowns are handed back to the catalog scheduler, not held open here.
        if (blockedUntil - now() > 30000) {
          for (const ticket of lanes.front.splice(0).concat(lanes.back.splice(0))) ticket.reject(tmdbError('rate-limit', 429, blockedUntil - now()));
          break;
        }
        const back = !lanes.front.length, ready = Math.max(lastStart + (back ? backgroundInterval : interval), blockedUntil);
        // A screen request that comes in meanwhile is looked at again after this wait.
        if (ready > now()) { await sleep(ready - now()); continue; }
        lastStart = now();
        (back ? lanes.back : lanes.front).shift().resolve();
      }
    } finally { pumping = false; }
  }
  function takeTurn(ticket) {
    return new Promise((resolve, reject) => { Object.assign(ticket, { resolve, reject }); (ticket.background ? lanes.back : lanes.front).push(ticket); pump(); });
  }
  // A background request still waiting moves to the screen lane when the screen asks for the same thing.
  function promote(ticket) {
    if (!ticket.background) return;
    ticket.background = false;
    const index = lanes.back.indexOf(ticket);
    if (index >= 0) { lanes.back.splice(index, 1); lanes.front.push(ticket); pump(); }
  }
  async function send(url, key, bearer, ticket) {
    for (let attempt = 0; ; attempt++) {
      await takeTurn(ticket);
      let failure;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: {
          Accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${key}` } : {})
        } });
        if (response.ok) {
          try { return await response.json(); } catch { failure = tmdbError('response'); }
        } else {
          const status = response.status;
          const retryAfter = response.headers?.get('retry-after');
          const retryAfterMs = retryAfter == null ? 0 : Math.max(0, /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : (Date.parse(retryAfter) || 0) - now());
          failure = tmdbError(status === 401 || status === 403 ? 'auth' : status === 429 ? 'rate-limit' : 'http', status, retryAfterMs);
          if (response.body) await response.body.cancel().catch(() => {});
        }
      } catch (error) {
        failure = tmdbError(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'timeout' : 'network');
      }
      const delay = Math.max(failure.retryAfterMs, 1000 * 2 ** attempt);
      if (failure.status === 429) blockedUntil = Math.max(blockedUntil, now() + delay);
      const transient = !failure.status || failure.status === 408 || failure.status === 429 || failure.status >= 500;
      if (!transient || attempt >= 2 || delay > 30000) throw failure;
      if (failure.status !== 429) await sleep(delay);
    }
  }
  return async function request(pathname, params = {}, key = '', { background = false } = {}) {
    if (!key) throw tmdbError('auth');
    const url = new URL(`https://api.themoviedb.org/3${pathname}`), bearer = key.includes('.');
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    if (!bearer) url.searchParams.set('api_key', key);
    const id = `${bearer ? key : ''} ${url}`, cached = cache.get(id);
    if (cached && now() - cached.time < cacheTtl) return cached.value;
    if (cached) cache.delete(id);
    let running = inflight.get(id);
    if (running) { if (!background) promote(running.ticket); return running.promise; }
    running = { ticket: { background } };
    running.promise = send(url, key, bearer, running.ticket).then(value => {
      if (!running.ticket.background) {
        cache.set(id, { value, time: now() });
        if (cache.size > cacheSize) cache.delete(cache.keys().next().value);
      }
      return value;
    }).finally(() => inflight.delete(id));
    inflight.set(id, running);
    return running.promise;
  };
}

module.exports = { createTmdbClient };
