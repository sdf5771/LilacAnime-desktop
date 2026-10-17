// Check actual media, keeping subtitle/audio preferences ahead of speed.
async function selectMiruroServer(servers, { probe, priority, preferred = '', excluded = [] }) {
  const blocked = new Set(excluded), available = servers.filter(server => !blocked.has(server.label));
  const picked = available.find(server => server.label === preferred);
  const audio = servers.find(server => server.label === preferred)?.kind === 'dub' ? 'dub' : 'original';
  const candidates = available.filter(server => audio === 'dub' ? server.kind === 'dub' : server.kind !== 'dub');
  if (!candidates.length) throw new Error('사용 가능한 영상 서버가 없습니다. 다른 서버를 선택해 주세요.');
  if (picked) {
    try { return { server: picked, probe: await probe(picked) }; } catch { /* a broken manual choice may fall back */ }
  }
  const groups = [...new Set(candidates.map(priority))].sort((a, b) => a - b), slow = [];
  let lastError;
  for (const group of groups) {
    const list = candidates.filter(server => server !== picked && priority(server) === group);
    const good = await new Promise(resolve => {
      const controller = new AbortController(); let next = 0, running = 0, settled = false;
      const finish = value => { if (settled) return; settled = true; controller.abort(); resolve(value); };
      const run = () => {
        if (settled) return;
        if (next >= list.length) { if (!running) finish(null); return; }
        const server = list[next++]; running++;
        Promise.resolve().then(() => probe(server, controller.signal)).then(result => {
          if (settled) return;
          const value = { server, probe: result };
          if (result.speed >= Math.max(300, result.requiredSpeed || 0)) finish(value);
          else slow.push(value);
        }, error => { lastError = error; }).finally(() => { running--; run(); });
      };
      for (let i = 0; i < Math.min(3, list.length); i++) run();
      if (!list.length) finish(null);
    });
    if (good) return good;
  }
  const fastest = slow.sort((a, b) => b.probe.speed - a.probe.speed)[0];
  if (fastest) return fastest;
  throw new Error(`모든 영상 서버 연결에 실패했습니다.${lastError ? ` (${lastError.message})` : ''}`);
}
module.exports = { selectMiruroServer };
