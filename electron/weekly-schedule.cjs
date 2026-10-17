// Anissia's weekday numbers follow JavaScript: Sunday=0, Monday=1, ... Saturday=6.
function createWeeklySchedule(fetchDay) {
  const cache = new Map(), pending = new Map();
  return async day => {
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error('올바른 방영 요일을 선택해 주세요.');
    const saved = cache.get(day);
    if (saved && Date.now() - saved.at < 300000) return saved.items;
    if (pending.has(day)) return pending.get(day);
    const work = (async () => {
      const data = await fetchDay(day);
      if (!Array.isArray(data)) throw new Error('방영 시간표를 읽지 못했습니다.');
      const items = [...new Map(data.filter(item => item && item.subject && item.animeNo != null).map(item => [String(item.animeNo), {
        id: String(item.animeNo), title: String(item.subject), originalTitle: String(item.originalSubject || ''),
        time: /^\d{2}:\d{2}$/.test(item.time || '') ? item.time : '', cancelled: item.status === 'OFF',
        genres: String(item.genres || '').split(',').map(value => value.trim()).filter(Boolean),
        startDate: String(item.startDate || ''), endDate: String(item.endDate || '')
      }])).values()].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.title.localeCompare(b.title, 'ko'));
      cache.set(day, { at: Date.now(), items }); return items;
    })();
    pending.set(day, work);
    try { return await work; } finally { pending.delete(day); }
  };
}
module.exports = { createWeeklySchedule };
