// Actual shader, native VTT and composed PIP regression: node node_modules/electron/cli.js tests/anime4k.electron.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lilac-anime4k-'));
app.setPath('userData', path.join(dir, 'profile'));
app.disableHardwareAcceleration();
function fail(error) { console.error(error.stack || error); app.exit(1); }
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace('<head>', `<head><base href="${pathToFileURL(path.join(root, 'src') + path.sep).href}">`)
    .replace('</body>', '<script src="anime4k.js"></script></body>');
  const file = path.join(dir, 'test.html'); fs.writeFileSync(file, html);
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { backgroundThrottling: false, offscreen: true } });
  await win.loadFile(file);
  await win.webContents.executeJavaScript(`
    var video = document.querySelector('#video'), stage = document.querySelector('#videoStage');
    var aspect = 'original', notices = [];
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.body.classList.add('player-mode'); document.querySelector('#playerView').classList.add('active');
    document.querySelector('#playerView').style.animation = 'none';
    document.querySelector('#immersivePlayer').classList.remove('controls-visible');
    document.querySelector('#playerEmpty').classList.add('hidden');
    var source = document.createElement('canvas'); source.width = 320; source.height = 180;
    var paint = () => { const ctx = source.getContext('2d'); ctx.fillStyle = '#e02020'; ctx.fillRect(0, 0, 160, 180); ctx.fillStyle = '#2020e0'; ctx.fillRect(160, 0, 160, 180); };
    paint(); var painting = setInterval(paint, 40); video.muted = true; video.srcObject = source.captureStream(25);
    var track = video.addTextTrack('subtitles', 'native', 'en'); track.mode = 'showing'; track.addCue(new VTTCue(0, 3600, 'NATIVE CAPTION'));
    window.LilacAnime4K.init({ getAspect: () => aspect, notify: value => notices.push(value) });
    video.play(); void 0;
  `);
  await wait(500);
  assert.equal(await win.webContents.executeJavaScript(`window.LilacAnime4K.mode()`), 'off', 'disabled by default');
  for (const mode of ['light', 'a', 'b', 'c']) {
    await win.webContents.executeJavaScript(`document.querySelector('[data-anime4k="${mode}"]').click()`);
    await wait(700);
    const state = await win.webContents.executeJavaScript(`({ active: stage.classList.contains('anime4k-active'), mode: window.LilacAnime4K.mode(), notices, width: stage.querySelector('canvas')?.width, height: stage.querySelector('canvas')?.height })`);
    assert.equal(state.active, true, JSON.stringify(state)); assert.equal(state.mode, mode);
    assert.equal(state.width, 640); assert.equal(state.height, 360); assert.deepEqual(state.notices, []);
    const shot = await win.webContents.capturePage(), pixels = shot.toBitmap();
    let red = 0, blue = 0, white = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 2] > 150 && pixels[i] < 100) red++;
      if (pixels[i] > 150 && pixels[i + 2] < 100) blue++;
      if (pixels[i] > 210 && pixels[i + 1] > 210 && pixels[i + 2] > 210) white++;
    }
    assert.ok(red > 10000 && blue > 10000, `${mode}: video picture visible, red=${red}, blue=${blue}`);
    assert.ok(white > 50, `${mode}: native captions visible, white=${white}`);
    if (mode === 'a') fs.writeFileSync(path.join(dir, 'anime4k.png'), shot.toPNG());
    console.log(`${mode}: shaders render 640x360, native captions visible`);
  }
  assert.equal(await win.webContents.executeJavaScript(`localStorage.getItem('playerAnime4k')`), 'c', 'mode selection persists');
  await win.webContents.executeJavaScript(`
    document.querySelector('#playerSettings').classList.add('open');
    document.querySelectorAll('[data-ps-pane]').forEach(pane => pane.classList.toggle('hidden', pane.dataset.psPane !== 'play'));
  `);
  await wait(300); fs.writeFileSync(path.join(dir, 'settings.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('#playerSettings').classList.remove('open'); source.width = 640; source.height = 360; paint = () => { const ctx = source.getContext('2d'); ctx.fillStyle = '#e02020'; ctx.fillRect(0, 0, 640, 360); }; paint();`);
  await wait(400);
  assert.equal(await win.webContents.executeJavaScript(`stage.querySelector('.anime4k-canvas').width`), 1280, 'resolution changes recreate correctly sized textures');
  await win.webContents.executeJavaScript(`document.body.classList.remove('player-mode')`); await wait(100);
  assert.equal(await win.webContents.executeJavaScript(`stage.querySelector('.anime4k-canvas') === null`), true, 'leaving player releases GPU resources');
  await win.webContents.executeJavaScript(`document.body.classList.add('player-mode')`); await wait(300);
  assert.equal(await win.webContents.executeJavaScript(`stage.classList.contains('anime4k-active')`), true, 'returning restores selected mode');
  const ass = '[Script Info]\nScriptType: v4.00+\nPlayResX: 640\nPlayResY: 360\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,30,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,20,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,1:00:00.00,Default,,0,0,0,,ASS CAPTION\n';
  await win.webContents.executeJavaScript(`(async () => {
    track.mode = 'disabled';
    await import(${JSON.stringify(pathToFileURL(path.join(root, 'src/ass-renderer.js')).href)});
    var assUrl = URL.createObjectURL(new Blob([${JSON.stringify(ass)}], { type: 'text/plain' }));
    await window.LilacAss.attach(video, { subUrl: assUrl });
  })()`);
  await wait(700);
  const assShot = await win.webContents.capturePage(), assPixels = assShot.toBitmap();
  let assWhite = 0;
  for (let i = 0; i < assPixels.length; i += 4) if (assPixels[i] > 210 && assPixels[i + 1] > 210 && assPixels[i + 2] > 210) assWhite++;
  assert.ok(assWhite > 50, 'actual libass captions render above the filtered picture');
  console.log('ASS captions visible above Anime4K');
  await win.webContents.executeJavaScript(`window.LilacAss.destroy().then(() => { track.mode = 'showing'; })`);
  await win.webContents.executeJavaScript(`video.pause(); aspect = 'fill'; window.LilacAnime4K.layout();`);
  await wait(100);
  await win.webContents.executeJavaScript(`{ const gl = stage.querySelector('.anime4k-canvas').getContext('webgl'); gl.clearColor(0, 1, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.flush(); }`);
  await wait(100);
  const overlay = await win.webContents.capturePage(), overlayPixels = overlay.toBitmap();
  let green = 0, caption = 0;
  for (let i = 0; i < overlayPixels.length; i += 4) {
    if (overlayPixels[i + 1] > 180 && overlayPixels[i] < 80 && overlayPixels[i + 2] < 80) green++;
    if (overlayPixels[i] > 210 && overlayPixels[i + 1] > 210 && overlayPixels[i + 2] > 210) caption++;
  }
  assert.ok(green > 10000, 'the filtered canvas is visible above the original picture');
  assert.ok(caption > 50, 'native captions stay above the filtered picture');
  const paused = await win.webContents.executeJavaScript(`(() => {
    const frame = window.LilacAnime4K.frame(), copy = document.createElement('canvas'); copy.width = 640; copy.height = 360;
    copy.getContext('2d').drawImage(frame, 0, 0);
    return { pixel: [...copy.getContext('2d').getImageData(80, 80, 1, 1).data], canvas: frame.getBoundingClientRect().toJSON(), stage: stage.getBoundingClientRect().toJSON() };
  })()`);
  assert.ok(paused.pixel[0] > 150 && paused.pixel[2] < 100, 'paused frame can be copied into PIP/screenshots');
  assert.equal(paused.canvas.width, paused.stage.width); assert.equal(paused.canvas.height, paused.stage.height);
  await win.webContents.executeJavaScript(`window.LilacAnime4K.select('off')`);
  assert.equal(await win.webContents.executeJavaScript(`stage.querySelector('canvas') === null && !stage.classList.contains('anime4k-active')`), true);
  await win.webContents.executeJavaScript(`window.LilacAnime4K.select('light')`); await wait(400);
  await win.webContents.executeJavaScript(`stage.querySelector('canvas').getContext('webgl').getExtension('WEBGL_lose_context').loseContext()`); await wait(200);
  assert.equal(await win.webContents.executeJavaScript(`!stage.classList.contains('anime4k-active') && notices.length === 1`), true, 'context loss restores original video');
  console.log('pause, fill aspect, PIP copy, off and GPU failure passed');
  console.log('Preview:', path.join(dir, 'anime4k.png'));
  console.log('Settings preview:', path.join(dir, 'settings.png'));
  win.destroy(); app.quit();
}).catch(fail);
