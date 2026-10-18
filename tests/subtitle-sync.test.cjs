const { test } = require('node:test');
const assert = require('node:assert/strict');
const { retimeVtt, retimeAss, parseResult, estimateLag, vttCues } = require('../electron/subtitle-sync.cjs');

test('VTT: only the timing lines move, by the scale first and then the offset, and never below zero', () => {
  const vtt = 'WEBVTT\n\n1\n00:00:04.000 --> 00:00:07.500 line:85%\n12:00 시에\n\n00:01.000 --> 00:02.000\n둘째\n';
  assert.equal(retimeVtt(vtt, -3.09), 'WEBVTT\n\n1\n00:00:00.910 --> 00:00:04.410 line:85%\n12:00 시에\n\n00:00:00.000 --> 00:00:00.000\n둘째\n');
  assert.match(retimeVtt('00:00:10.000 --> 00:00:20.000\nx', 1, 1.001), /^00:00:11\.010 --> 00:00:21\.020/);
});

test('ASS: Dialogue and Comment times move, everything else (styles, tags, text with commas) stays', () => {
  const ass = '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
    + 'Dialogue: 0,0:00:07.20,0:00:10.64,Default,,0,0,0,,{\\an8}안녕, 0:00:01.00\nComment: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,메모\nStyle: Default,Arial,60\n';
  const out = retimeAss(ass, -3.2);
  assert.match(out, /Dialogue: 0,0:00:04\.00,0:00:07\.44,Default,,0,0,0,,\{\\an8\}안녕, 0:00:01\.00\n/);
  assert.match(out, /Comment: 0,0:00:00\.00,0:00:00\.00,/);
  assert.match(out, /Style: Default,Arial,60\n$/);
});

test('ffsubsync output: offset and scale are read, also when its log line is broken', () => {
  assert.deepEqual(parseResult('INFO score: 12863.000\nINFO offset seconds: -3.090   ffsubsync.py:256\nINFO framerate scale factor: 1.000'), { offset: -3.09, scale: 1, score: 12863 });
  assert.equal(parseResult('INFO offset\n   seconds: 2.5').offset, 2.5);
  assert.equal(parseResult('error'), null);
});

test('the quick check finds how late the subtitle is from bursts of sound against its cues', () => {
  const rate = 8000, length = 240, samples = new Float32Array(rate * length), cues = [];
  let seed = 7; const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < samples.length; i++) samples[i] = (random() - 0.5) * 0.02;
  for (let at = 100 + 3, n = 0; at < 100 + length - 10; at += 4 + (n++ % 5) * 1.3) {
    const start = at - 100, end = start + 1.5 + (n % 3) * 0.5;
    for (let i = Math.floor(start * rate); i < end * rate; i++) samples[i] += Math.sin(i / 3) * 0.4 * (0.5 + random());
    cues.push([at + 2.4, at + 2.4 + (end - start)]);
  }
  const found = estimateLag(samples, 100, cues);
  assert.ok(Math.abs(found.lag - 2.4) <= 0.1, `lag ${found.lag}`);
  assert.ok(found.score - found.zero > 0.06);
  const fixed = estimateLag(samples, 100, cues.map(([s, e]) => [s - 2.4, e - 2.4]));
  assert.ok(Math.abs(fixed.lag) <= 0.1, `lag ${fixed.lag}`);
});

test('VTT cues are read with hours or without', () => {
  assert.deepEqual(vttCues('WEBVTT\n\n00:01.500 --> 00:02.000\na\n\n01:00:00.000 --> 01:00:01,250\nb\n'), [[1.5, 2], [3600, 3601.25]]);
});
