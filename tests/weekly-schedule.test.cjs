const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWeeklySchedule } = require('../electron/weekly-schedule.cjs');

test('weekly schedule validates weekdays before making requests', async () => {
  let calls = 0; const load = createWeeklySchedule(async () => { calls++; return []; });
  for (const value of [-1, 7, '6', null, 1.5]) await assert.rejects(load(value));
  assert.equal(calls, 0);
});
test('schedule keeps cancelled shows, sorts by time and deduplicates entries', async () => {
  const load = createWeeklySchedule(async () => [
    { animeNo: 2, subject: '밤 작품', time: '23:30', status: 'OFF', genres: '액션, SF' },
    { animeNo: 1, subject: '새벽 작품', originalSubject: '原題', time: '00:30', status: 'ON', startDate: '2026-10-17' },
    { animeNo: 2, subject: '밤 작품', time: '23:30', status: 'OFF', genres: '액션, SF' },
    { animeNo: 3, subject: '시간 미정', time: '', status: 'ON' }, null
  ]);
  const items = await load(6);
  assert.deepEqual(items.map(item => item.id), ['1', '2', '3']);
  assert.equal(items[1].cancelled, true); assert.deepEqual(items[1].genres, ['액션', 'SF']);
  assert.equal(items[0].originalTitle, '原題'); assert.equal(items[0].startDate, '2026-10-17');
});
test('requests are shared and cached per day, failed requests can retry', async () => {
  let calls = 0; const load = createWeeklySchedule(async day => { calls++; if (calls === 1) throw new Error('offline'); return [{ animeNo: day, subject: '작품' }]; });
  await assert.rejects(load(6));
  const [a, b] = await Promise.all([load(6), load(6)]); assert.equal(a, b); assert.equal(calls, 2);
  await load(6); assert.equal(calls, 2); await load(0); assert.equal(calls, 3);
});
test('malformed responses are not cached as an empty schedule', async () => {
  let calls = 0; const load = createWeeklySchedule(async () => ++calls === 1 ? {} : []);
  await assert.rejects(load(1)); assert.deepEqual(await load(1), []);
});
