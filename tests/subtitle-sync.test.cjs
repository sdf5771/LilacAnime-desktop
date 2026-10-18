const { test } = require('node:test');
const assert = require('node:assert/strict');
const { retimeVtt, retimeAss, parseResult, vttCues } = require('../electron/subtitle-sync.cjs');

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

test('VTT cues are read with hours or without', () => {
  assert.deepEqual(vttCues('WEBVTT\n\n00:01.500 --> 00:02.000\na\n\n01:00:00.000 --> 01:00:01,250\nb\n'), [[1.5, 2], [3600, 3601.25]]);
});

test('retime: a translation finished later gets the fix found for its source, as new files beside it', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { createSubtitleSync } = require('../electron/subtitle-sync.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lilac-retime-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const managedRoot = path.join(dir, 'subtitles'), translated = path.join(managedRoot, 'translated', 'abc.vtt');
  fs.mkdirSync(path.dirname(translated), { recursive: true }); fs.writeFileSync(translated, 'WEBVTT\n\n00:00:07.200 --> 00:00:10.640\n안녕\n');
  const sync = createSubtitleSync({ userData: dir, ffmpegPath: 'ffmpeg', managedRoot });
  const out = sync.retime({ subtitlePath: translated, offset: -3.2, scale: 1 });
  assert.equal(path.dirname(out.path), path.dirname(translated));
  assert.match(path.basename(out.path), /^abc\.sync-[a-z0-9]+\.vtt$/);
  assert.equal(fs.readFileSync(out.path, 'utf8'), 'WEBVTT\n\n00:00:04.000 --> 00:00:07.440\n안녕\n');
  assert.equal(fs.readFileSync(translated, 'utf8'), 'WEBVTT\n\n00:00:07.200 --> 00:00:10.640\n안녕\n');
  assert.throws(() => sync.retime({ subtitlePath: path.join(dir, 'missing.vtt'), offset: 1 }));
});

test('ffsubsync is matched with the dialogue lines only: captions, lyrics and signs are left out', () => {
  const { dialogueVtt } = require('../electron/subtitle-sync.cjs');
  const stamp = i => `00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000`;
  const lines = Array.from({ length: 60 }, (_, i) => `${stamp(i * 2)} --> ${stamp(i * 2 + 1)}\n${['（竜児）こんなもん…', 'つっかまえた～', '（拍手）', '♪ 歌詞', '{\\an8}看板', 'ハァ…'][i % 6]}`);
  const out = dialogueVtt(`WEBVTT\n\n${lines.join('\n\n')}\n`);
  const kept = out.split('\n').filter(line => !line.includes('-->') && line && line !== 'WEBVTT');
  assert.ok(kept.every(line => /こんなもん|つっかまえた/.test(line)), kept.join(' | '));
  assert.equal((out.match(/-->/g) || []).length, 20);
  // Too few dialogue lines: every line is kept.
  assert.equal((dialogueVtt(`WEBVTT\n\n${lines.slice(0, 6).join('\n\n')}\n`).match(/-->/g) || []).length, 6);
});
