const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { fetchHedged } = require('../electron/flix-proxy.cjs');

// A range server whose first answers behave as asked: stall after a few bytes, trickle steadily, or fail.
async function server(t, behave) {
  let asks = 0;
  const body = Buffer.alloc(64 * 1024, 7);
  const srv = http.createServer((req, res) => {
    const ask = ++asks, [start, end] = (req.headers.range || 'bytes=0-').slice(6).split('-').map(Number), part = body.subarray(start, end + 1);
    res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': part.length });
    behave(ask, part, res);
  });
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => { srv.closeAllConnections(); srv.close(); });
  return { url: `http://127.0.0.1:${srv.address().port}/segment`, asks: () => asks };
}

test('an answer that has gone quiet is asked for again at once, long before the overall wait', async t => {
  const s = await server(t, (ask, part, res) => { if (ask === 1) res.write(part.subarray(0, 100)); else res.end(part); });
  const begin = Date.now(), { body } = await fetchHedged(s.url, {}, 100, 30000, 200, 10000);
  assert.equal(body.length, 29901); assert.equal(s.asks(), 2);
  assert.ok(Date.now() - begin < 2000, 'taken over after the silence, not after 10 s');
});

test('a slow answer that keeps arriving is not asked for twice', async t => {
  const s = await server(t, (ask, part, res) => {
    let at = 0; const step = () => { if (at >= part.length) return res.end(); res.write(part.subarray(at, at + 4096)); at += 4096; setTimeout(step, 50); }; step();
  });
  const { body } = await fetchHedged(s.url, {}, 100, 40000, 300, 10000);
  assert.equal(body.length, 39901); assert.equal(s.asks(), 1);
});

test('a failed answer is asked for again at once', async t => {
  const s = await server(t, (ask, part, res) => { if (ask === 1) res.destroy(); else res.end(part); });
  const { body } = await fetchHedged(s.url, {}, 0, 999, 5000, 10000);
  assert.equal(body.length, 1000); assert.equal(s.asks(), 2);
});
