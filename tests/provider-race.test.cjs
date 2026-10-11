const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
const start = source.indexOf('function firstAnswering('), end = source.indexOf('async function resolveProviderEpisode(', start);
assert.ok(start >= 0 && end > start, 'Missing firstAnswering');
const context = vm.createContext({ AbortController, setTimeout, clearTimeout, Promise, Error });
vm.runInContext(source.slice(start, end), context);
const firstAnswering = (...args) => context.firstAnswering(...args);
const later = (ms, value, fail) => new Promise((resolve, reject) => setTimeout(() => fail ? reject(new Error(value)) : resolve(value), ms));

test('a server that does not answer no longer holds the next one for its whole time limit', async () => {
  const started = [], aborted = [], begin = Date.now();
  const result = await firstAnswering(['HD-2', 'HD-1', 'HD-3'], (server, signal) => {
    started.push([server, Date.now() - begin]); signal.addEventListener('abort', () => aborted.push(server));
    return server === 'HD-2' ? new Promise(() => {}) : later(20, server);
  }, 60);
  assert.equal(result, 'HD-1');
  assert.deepEqual(started.map(([server]) => server), ['HD-2', 'HD-1'], 'the third is not opened once one answers');
  assert.ok(started[1][1] >= 55, 'the next one waits its turn');
  assert.deepEqual(aborted.sort(), ['HD-1', 'HD-2'], 'the pages still trying are closed');
});

test('a server that fails is followed at once; the first answer wins even from an earlier server', async () => {
  const begin = Date.now(), started = [];
  assert.equal(await firstAnswering(['a', 'b'], server => { started.push([server, Date.now() - begin]); return server === 'a' ? later(5, 'down', true) : later(5, server); }, 5000), 'b');
  assert.ok(started[1][1] < 1000, 'not after the stagger');
  assert.equal(await firstAnswering(['slow', 'fast'], server => server === 'slow' ? later(80, server) : new Promise(() => {}), 20), 'slow');
});

test('when every server fails, the last error is given', async () => {
  await assert.rejects(firstAnswering(['a', 'b', 'c'], server => later(5, `${server} down`, true), 10), /c down/);
  await assert.rejects(firstAnswering(['a'], () => later(1, 'only one', true), 10), /only one/);
});
