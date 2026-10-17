(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LilacSubtitleSource = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function track(tracks, language) {
    const label = item => `${item.label || ''} ${item.language || ''}`;
    const code = language === 'ja' ? /^(?:ja|jpn)(?:[-_]|$)/i : /^(?:en|eng)(?:[-_]|$)/i;
    const name = language === 'ja' ? /japanese|日本|일본/i : /english|영어/i;
    const rank = item => /dubtitle|\(ai\)|\bai\b/i.test(item.label || '') ? 2 : /dialogue|full/i.test(item.label || '') ? 0 : 1;
    return (tracks || []).filter(item => !/signs|songs|forced/i.test(item.label || '') && (code.test(item.language || '') || name.test(label(item))))
      .sort((a, b) => rank(a) - rank(b))[0] || null;
  }
  async function resolve({ tracks = [], getJimaku, readTrack, readJimaku, current = () => true }) {
    const attempt = async (read, value, source) => {
      if (!current() || !value) return null;
      try { const file = await read(value); return file && current() ? { source, value, file } : null; } catch { return null; }
    };
    let found = await attempt(readTrack, track(tracks, 'ja'), 'track'); if (found || !current()) return found;
    const files = await Promise.resolve().then(getJimaku).catch(() => []);
    for (const file of files || []) {
      if (/(?:^|[. _-])(?:en|eng|english)(?:[. _-]|$)/i.test(file.name || '')) continue;
      found = await attempt(readJimaku, file, 'jimaku'); if (found || !current()) return found;
    }
    return attempt(readTrack, track(tracks, 'en'), 'track');
  }
  return { track, resolve };
});
