// Subtitle sync to the episode's audio. sync(): ffsubsync over the whole episode (the player runs it for every
// subtitle put on, and for its button); the offset it finds is then applied to the VTT and the ASS beside it, so
// styles, fonts and effects stay as they are. ffsubsync runs in its own Python, installed once under userData/tools by uv.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { fileURLToPath, pathToFileURL } = require('url');
const { dropCaptions } = require('./subtitle-translator.cjs');

const UV_VERSION = '0.13.1', FFSUBSYNC_VERSION = '0.5.1', PYTHON_VERSION = '3.12';
const MAC = process.platform === 'darwin', WIN = process.platform === 'win32';

function uvAsset() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  return MAC ? `uv-${arch}-apple-darwin.tar.gz` : WIN ? `uv-${arch}-pc-windows-msvc.zip` : `uv-${arch}-unknown-linux-gnu.tar.gz`;
}

// A file: URL is given to FFmpeg as its path; the headers go only to a remote stream (the local proxy needs none).
function ffmpegInput(url, headers = {}) {
  if (/^file:/i.test(url)) return { input: fileURLToPath(url), args: [] };
  const args = [], lines = /^https?:\/\/127\.0\.0\.1:/i.test(url) ? '' : Object.entries(headers || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\r\n');
  if (lines) args.push('-headers', `${lines}\r\n`);
  if (/^https?:/i.test(url)) args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
  return { input: url, args };
}

function seconds(stamp) {
  const parts = String(stamp).trim().replace(',', '.').split(':').map(Number);
  return parts.reduce((sum, value) => sum * 60 + value, 0);
}
function vttStamp(value) {
  const ms = Math.max(0, Math.round(value * 1000)), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
function assStamp(value) {
  const cs = Math.max(0, Math.round(value * 100)), h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

// The cues' [start, end] of a VTT, in seconds.
function vttCues(text) {
  const cues = [], pattern = /^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/gm;
  for (let match; (match = pattern.exec(text));) { const start = seconds(match[1]), end = seconds(match[2]); if (end > start) cues.push([start, end]); }
  return cues;
}

// The cues ffsubsync is matched with: dialogue only. Sound captions and speaker-only lines（拍手）, song lyrics (♪) and
// signs at the top ({\an8}) are on screen while nobody talks; they are left out (all cues are kept when that would
// leave fewer than 20, or under a third of them).
function dialogueVtt(text) {
  const blocks = String(text).replace(/^﻿/, '').replace(/\r/g, '').split(/\n{2,}/), cues = [];
  for (const block of blocks) {
    const lines = block.split('\n'), at = lines.findIndex(line => line.includes('-->'));
    if (at < 0) continue;
    const body = lines.slice(at + 1).join('\n'), plain = body.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '');
    cues.push({ timing: lines[at], body, dialogue: !/\{\\an[789]\}/.test(body) && !/[♪♫]/.test(plain) && Boolean(dropCaptions(plain)) });
  }
  const dialogue = cues.filter(cue => cue.dialogue), use = dialogue.length >= 20 && dialogue.length >= cues.length / 3 ? dialogue : cues;
  return `WEBVTT\n\n${use.map(cue => `${cue.timing}\n${cue.body || 'x'}\n`).join('\n')}`;
}

// time → time * scale + offset (ffsubsync's order: the scale first, then the offset), on the timing lines only.
function retimeVtt(text, offset, scale = 1) {
  const stamp = /((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/g;
  return text.split('\n').map(line => line.includes('-->') ? line.replace(stamp, value => vttStamp(seconds(value) * scale + offset)) : line).join('\n');
}
function retimeAss(text, offset, scale = 1) {
  return text.replace(/^((?:Dialogue|Comment):\s*[^,\r\n]*,)(\d+:\d{2}:\d{2}[.:]\d{1,3}),(\d+:\d{2}:\d{2}[.:]\d{1,3})/gim,
    (_, head, start, end) => `${head}${assStamp(seconds(start.replace(/:(\d+)$/, '.$1')) * scale + offset)},${assStamp(seconds(end.replace(/:(\d+)$/, '.$1')) * scale + offset)}`);
}
// The file's bytes are kept: UTF-16 is read as such, anything else byte for byte (the times are ASCII), so a CP949
// or Shift-JIS ASS comes out in its own encoding.
function rewrite(source, target, change) {
  const raw = fs.readFileSync(source), utf16 = raw[0] === 0xff && raw[1] === 0xfe, encoding = utf16 ? 'utf16le' : 'latin1';
  fs.writeFileSync(target, Buffer.from(change(raw.toString(encoding)), encoding));
}

// ffsubsync's "offset seconds: -3.090" and "framerate scale factor: 1.000" (rich may break a log line: it is joined
// first).
function parseResult(output) {
  const flat = String(output).replace(/\r/g, '').replace(/\s*\n\s*/g, ' ');
  const offset = flat.match(/offset seconds:\s*(-?\d+(?:\.\d+)?)/i), scale = flat.match(/framerate scale factor:\s*(\d+(?:\.\d+)?)/i), score = flat.match(/score:\s*(-?\d+(?:\.\d+)?)/i);
  return offset ? { offset: Number(offset[1]), scale: scale ? Number(scale[1]) : 1, score: score ? Number(score[1]) : null } : null;
}

function createSubtitleSync({ userData, ffmpegPath, managedRoot }) {
  const root = path.join(userData, 'tools', 'ffsubsync'), marker = path.join(root, 'installed.json');
  const venv = path.join(root, 'venv'), exe = path.join(venv, WIN ? 'Scripts' : 'bin', WIN ? 'ffsubsync.exe' : 'ffsubsync');
  const uvEnv = () => ({ ...process.env, UV_CACHE_DIR: path.join(root, 'cache'), UV_PYTHON_INSTALL_DIR: path.join(root, 'python'), UV_NO_PROGRESS: '1' });
  const children = new Set();
  let installing = null, running = null;

  function installed() {
    try { return JSON.parse(fs.readFileSync(marker, 'utf8')).ffsubsync === FFSUBSYNC_VERSION && fs.existsSync(exe); } catch { return false; }
  }
  function run(command, args, { env = process.env, signal = null, onOutput = () => {}, stdout = 'pipe' } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(Object.assign(new Error('취소했습니다.'), { canceled: true }));
      const child = spawn(command, args, { env, windowsHide: true, stdio: ['ignore', stdout, 'pipe'] }); children.add(child);
      let output = '';
      const take = chunk => { const text = chunk.toString('utf8'); output = (output + text).slice(-20000); onOutput(text); };
      child.stderr.on('data', take); if (stdout === 'pipe') child.stdout.on('data', take);
      const abort = () => child.kill();
      signal?.addEventListener('abort', abort, { once: true });
      child.once('error', error => { children.delete(child); reject(error); });
      child.once('close', code => {
        children.delete(child); signal?.removeEventListener('abort', abort);
        if (signal?.aborted) reject(Object.assign(new Error('취소했습니다.'), { canceled: true }));
        else if (code === 0) resolve(output);
        else reject(new Error(output.trim().split('\n').slice(-4).join(' ').slice(-400) || `${path.basename(command)} ${code}`));
      });
    });
  }
  async function download(url, target, progress) {
    const response = await fetch(url, { headers: { 'User-Agent': 'LilacAnime-Desktop' }, redirect: 'follow' });
    if (!response.ok) throw new Error(`uv를 받지 못했습니다 (${response.status})`);
    const total = Number(response.headers.get('content-length')) || 0, out = fs.createWriteStream(target); let done = 0;
    for await (const chunk of response.body) { done += chunk.length; if (!out.write(chunk)) await new Promise(r => out.once('drain', r)); if (total) progress(done / total); }
    await new Promise((resolve, reject) => out.end(error => error ? reject(error) : resolve()));
  }
  function findFile(dir, name) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { const found = findFile(file, name); if (found) return found; } else if (entry.name === name) return file;
    }
    return null;
  }
  // uv (one program) → its own Python 3.12 → a venv with ffsubsync. Its download cache is removed afterwards.
  function install(status = () => {}) {
    if (installed()) return Promise.resolve();
    if (!installing) installing = (async () => {
      fs.mkdirSync(root, { recursive: true });
      const asset = uvAsset(), archive = path.join(root, asset), unpacked = path.join(root, 'uv');
      status('uv 받는 중', 0);
      await download(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`, archive, done => status('uv 받는 중', done * 0.3));
      fs.rmSync(unpacked, { recursive: true, force: true }); fs.mkdirSync(unpacked, { recursive: true });
      const tar = WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar';
      try { await run(tar, [WIN ? '-xf' : '-xzf', archive, '-C', unpacked]); } finally { fs.rmSync(archive, { force: true }); }
      const uv = findFile(unpacked, WIN ? 'uv.exe' : 'uv');
      if (!uv) throw new Error('uv 실행 파일을 찾지 못했습니다.');
      if (!WIN) fs.chmodSync(uv, 0o755);
      status('Python 준비 중', 0.35);
      fs.rmSync(venv, { recursive: true, force: true });
      await run(uv, ['venv', '--python', PYTHON_VERSION, '--managed-python', venv], { env: uvEnv() });
      status('ffsubsync 설치 중', 0.6);
      await run(uv, ['pip', 'install', '--python', path.join(venv, WIN ? 'Scripts/python.exe' : 'bin/python'), `ffsubsync==${FFSUBSYNC_VERSION}`], { env: uvEnv() });
      if (!fs.existsSync(exe)) throw new Error('ffsubsync 설치를 마치지 못했습니다.');
      // uv itself is not needed to run ffsubsync (its Python stays: the venv runs on it).
      for (const dir of ['cache', 'uv']) fs.rmSync(path.join(root, dir), { recursive: true, force: true });
      fs.writeFileSync(marker, JSON.stringify({ uv: UV_VERSION, ffsubsync: FFSUBSYNC_VERSION, python: PYTHON_VERSION, at: Date.now() }));
      status('ffsubsync 설치 완료', 1);
    })().finally(() => { installing = null; });
    return installing;
  }

  // The episode's audio as 16 kHz stereo WAV (the centre is taken from it, see sync); progress from FFmpeg's time=
  // against the duration.
  async function extractAudio(videoUrl, headers, duration, target, status, signal) {
    const { input, args } = ffmpegInput(videoUrl, headers);
    await run(ffmpegPath, ['-hide_banner', '-nostdin', '-y', ...args, '-i', input, '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '16000', '-c:a', 'pcm_s16le', target], {
      signal, onOutput: text => { const time = text.match(/time=(\d+:\d{2}:\d{2}(?:\.\d+)?)/g)?.pop(); if (time && duration > 0) status('영상 음성 읽는 중', Math.min(1, seconds(time.slice(5)) / duration)); },
    });
  }

  // Where the synced copy goes: beside its original when that is the app's own (an ASS keeps the folder with its
  // fonts), else under subtitles/synced. ".sync-<time>" makes a new name each run, so the player does not show a
  // cached copy; earlier runs are left for 자막 정리.
  function syncedName(file) {
    const own = path.resolve(file).startsWith(path.resolve(managedRoot) + path.sep);
    const dir = own ? path.dirname(file) : path.join(managedRoot, 'synced'), ext = path.extname(file);
    const base = path.basename(file, ext).replace(/\.sync-[a-z0-9]+$/i, '');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${base}.sync-${Date.now().toString(36)}${ext}`);
  }

  // subtitlePath: the VTT on screen; assPath: its ASS, retimed the same way; timingPath: the file a translation was made
  // from (its Japanese lines tell dialogue from captions better; the times are the same).
  // Toradora! 1 (Netflix ja[cc] from Jimaku, music under most of the talk) came out +28.4 s with a 1.042 frame-rate
  // scale, where the subtitle was 1.3 s late. So ffsubsync never changes the frame rate (web releases do not need it)
  // and hears the centre of the stereo mix, where dialogue sits with the music spread around it: there it found -1.32 s
  // with any set of lines, where the whole mix swung between -1.34 and +44 s as ten lines came and went. It is asked
  // twice, with the dialogue lines only (captions, lyrics and signs left out) and with every line; the result counts
  // only when both say the same, as a wrong match does not hold when the lines change. Under 0.3 s the subtitle is left
  // as it is.
  async function sync({ videoUrl, headers = {}, subtitlePath, assPath = null, timingPath = null, duration = 0, status = () => {} }) {
    if (running) throw new Error('이미 자막 싱크를 맞추는 중입니다.');
    if (!/^(https?|file):/i.test(videoUrl || '')) throw new Error('이 영상은 자동 싱크를 쓸 수 없습니다.');
    if (!subtitlePath || !fs.existsSync(subtitlePath)) throw new Error('자막 파일이 없습니다.');
    const abort = new AbortController(), work = fs.mkdtempSync(path.join(os.tmpdir(), 'lilac-sync-'));
    running = abort;
    try {
      if (!installed()) { status('ffsubsync 설치 준비 중 (처음 한 번)', 0); await install((message, progress) => status(`${message} (처음 한 번)`, progress)); }
      if (abort.signal.aborted) throw Object.assign(new Error('취소했습니다.'), { canceled: true });
      const wav = path.join(work, 'audio.wav');
      status('영상 음성 읽는 중', 0);
      await extractAudio(videoUrl, headers, Number(duration) || 0, wav, status, abort.signal);
      status('ffsubsync로 대사 위치 맞추는 중', null);
      const timing = path.join(work, 'dialogue.vtt'), center = path.join(work, 'center.wav');
      fs.writeFileSync(timing, dialogueVtt(fs.readFileSync(timingPath && fs.existsSync(timingPath) ? timingPath : subtitlePath, 'utf8')));
      let centerOk = true;
      try { await run(ffmpegPath, ['-hide_banner', '-nostdin', '-y', '-i', wav, '-af', 'dialoguenhance=original=0:enhance=3,pan=mono|c0=FC', '-ar', '16000', '-c:a', 'pcm_s16le', center], { signal: abort.signal }); } catch (error) { if (abort.signal.aborted) throw error; centerOk = false; }
      const ask = async lines => {
        const output = await run(exe, [centerOk ? center : wav, '-i', lines, '-o', path.join(work, 'out.vtt'), '--ffmpeg-path', path.dirname(ffmpegPath), '--no-fix-framerate'], {
          signal: abort.signal, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', COLUMNS: '400', NO_COLOR: '1', TERM: 'dumb' },
        });
        const found = parseResult(output);
        if (!found) throw new Error('ffsubsync가 결과를 알려 주지 않았습니다.');
        return found.offset;
      };
      const dialogue = await ask(timing), every = await ask(subtitlePath);
      if (Math.abs(dialogue - every) > 0.5) throw Object.assign(new Error(`음성 분석 결과가 서로 달라(${dialogue.toFixed(1)}초 / ${every.toFixed(1)}초) 싱크를 확신할 수 없어 그대로 뒀어요.`), { uncertain: true });
      const offset = Math.round(dialogue * 100) / 100, result = { offset, scale: 1, checked: { dialogue, every } };
      if (Math.abs(offset) < 0.3) return { ...result, unchanged: true };
      return { ...result, ...retime({ subtitlePath, assPath, ...result }) };
    } finally {
      running = null;
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
  // A retimed copy of a subtitle (and its ASS) by an offset and scale found before: a translation finished after its
  // source was synced gets the same fix without running ffsubsync again.
  function retime({ subtitlePath, assPath = null, offset = 0, scale = 1 }) {
    if (!subtitlePath || !fs.existsSync(subtitlePath) || !Number.isFinite(offset) || !(scale > 0)) throw new Error('자막 파일이 없습니다.');
    const vtt = syncedName(subtitlePath);
    rewrite(subtitlePath, vtt, text => retimeVtt(text, offset, scale));
    let ass = null;
    if (assPath && fs.existsSync(assPath)) { ass = syncedName(assPath); rewrite(assPath, ass, text => retimeAss(text, offset, scale)); }
    return { path: vtt, url: pathToFileURL(vtt).href, assPath: ass, assUrl: ass ? pathToFileURL(ass).href : null };
  }

  function cancel() { running?.abort(); }
  function stop() { cancel(); for (const child of children) child.kill(); }
  return { installed, install, sync, retime, cancel, stop, running: () => Boolean(running) };
}

module.exports = { createSubtitleSync, retimeVtt, retimeAss, parseResult, vttCues, dialogueVtt };
