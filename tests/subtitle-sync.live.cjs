// Live check of 자막 싱크 맞추기 on this machine (macOS or Windows): installs ffsubsync the way the app does (uv, its own
// Python 3.12) into a temporary folder, makes a video with speech at known times (macOS `say`, Windows SAPI) and a
// subtitle 3.2 s late, then checks that the quick check finds it, ffsubsync fixes it, and the fixed copy passes.
// node tests/subtitle-sync.live.cjs   (GitHub Actions: Subtitle sync check)
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const assert = require('assert/strict');
const ffmpeg = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
const { createSubtitleSync, vttCues } = require('../electron/subtitle-sync.cjs');

const LATE = 3.2, LENGTH = 175;
const PHRASES = ['Good morning, how are you today', 'I am going to the station now', 'Please wait for me over there', 'The weather is really nice this afternoon', 'Did you finish your homework already', 'Let us meet again tomorrow evening', 'I cannot believe what just happened', 'Thank you so much for everything', 'We should hurry or we will be late', 'See you later, take care'];
const STARTS = [4, 11.5, 17, 26, 33.5, 41, 52, 58.5, 69, 80, 88, 97, 104.5, 113, 121, 130, 138.5, 147, 155, 163];

function speak(text, out) {
  if (process.platform === 'darwin') { const aiff = out.replace(/\.wav$/, '.aiff'); execFileSync('say', ['-o', aiff, text]); execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', aiff, '-ac', '1', '-ar', '22050', out]); return; }
  const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${out.replace(/'/g, "''")}'); $s.Speak('${text}'); $s.Dispose()`;
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
}
const seconds = file => { const data = fs.readFileSync(file); return data.readUInt32LE(data.indexOf('data') + 4) / data.readUInt32LE(28); };
const stamp = (t, sep) => { const ms = Math.round(Math.max(0, t) * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`; };
const assStamp = t => { const cs = Math.round(t * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lilac-sync-live-'));
  console.log(`platform ${process.platform} ${process.arch}, work ${dir}`);
  const clips = PHRASES.map((text, i) => { const file = path.join(dir, `p${i}.wav`); speak(text, file); return file; });
  const used = STARTS.map((_, i) => clips[i % clips.length]);
  const video = path.join(dir, 'test.mp4');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=320x240:r=24:d=${LENGTH}`, '-f', 'lavfi', '-i', `anullsrc=r=22050:cl=mono:d=${LENGTH}`,
    ...used.flatMap(file => ['-i', file]),
    '-filter_complex', `${used.map((_, i) => `[${i + 2}:a]adelay=${Math.round(STARTS[i] * 1000)}[a${i}]`).join(';')};[1:a]${used.map((_, i) => `[a${i}]`).join('')}amix=inputs=${used.length + 1}:normalize=0:duration=first[out]`,
    '-map', '0:v', '-map', '[out]', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', video]);
  const cues = STARTS.map((start, i) => [start + LATE, start + LATE + seconds(used[i]), `line ${i + 1}`]);
  const vtt = path.join(dir, 'late.vtt'), ass = path.join(dir, 'late.ass');
  fs.writeFileSync(vtt, `WEBVTT\n\n${cues.map(([s, e, t]) => `${stamp(s, '.')} --> ${stamp(e, '.')}\n${t}\n`).join('\n')}`);
  fs.writeFileSync(ass, `[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${cues.map(([s, e, t]) => `Dialogue: 0,${assStamp(s)},${assStamp(e)},Default,,0,0,0,,${t}`).join('\n')}\n`);

  const sync = createSubtitleSync({ userData: path.join(dir, 'userData'), ffmpegPath: ffmpeg, managedRoot: path.join(dir, 'userData', 'subtitles') });
  const videoUrl = pathToFileURL(video).href;
  const check = await sync.check({ videoUrl, subtitlePath: vtt, duration: LENGTH });
  console.log('quick check:', JSON.stringify(check));
  assert.ok(check?.off && Math.abs(check.lag - LATE) <= 0.6, 'the quick check finds the late subtitle');

  let started = Date.now(), installSeconds = 0;
  await sync.install((message, progress) => console.log(`  install: ${message}${progress == null ? '' : ` ${Math.round(progress * 100)}%`}`));
  installSeconds = (Date.now() - started) / 1000; started = Date.now();
  assert.ok(sync.installed(), 'ffsubsync is installed');
  const result = await sync.sync({ videoUrl, subtitlePath: vtt, assPath: ass, duration: LENGTH, status: (message, progress) => console.log(`  sync: ${message}${progress == null ? '' : ` ${Math.round(progress * 100)}%`}`) });
  console.log('ffsubsync:', JSON.stringify({ offset: result.offset, scale: result.scale, score: result.score }), `install ${installSeconds.toFixed(0)} s, sync ${((Date.now() - started) / 1000).toFixed(0)} s`);
  assert.ok(Math.abs(result.offset + LATE) <= 0.6 && Math.abs(result.scale - 1) < 0.01, 'ffsubsync moves the subtitle back');
  const fixed = vttCues(fs.readFileSync(result.path, 'utf8'));
  assert.ok(Math.abs(fixed[0][0] - STARTS[0]) <= 0.6, `first line at ${fixed[0][0]} s`);
  assert.ok(result.assPath && fs.readFileSync(result.assPath, 'utf8').includes('Dialogue: 0,0:00:0'), 'the ASS copy is retimed too');
  const again = await sync.check({ videoUrl, subtitlePath: result.path, duration: LENGTH });
  console.log('quick check of the fixed copy:', JSON.stringify(again));
  assert.ok(again && !again.off, 'the fixed copy is not flagged');
  console.log('SUBTITLE_SYNC_LIVE_OK');
  fs.rmSync(dir, { recursive: true, force: true });
})().catch(error => { console.error(error); process.exit(1); });
