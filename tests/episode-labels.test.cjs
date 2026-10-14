const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function section(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing production section: ${start}`);
  return source.slice(first, last);
}
const context = vm.createContext({});
vm.runInContext(section('const SPECIAL_EPISODE=', 'async function ohliDetail('), context);
const info = label => ({ ...vm.runInContext(`episodeLabelInfo(${JSON.stringify(label)})`, context) });

test('Korean sites\' episode labels: numbers, half episodes and specials', () => {
  assert.deepEqual(info('12화'), { name: '12', number: 12 });
  assert.deepEqual(info('1150.5화'), { name: '1150.5', number: 1150.5 });
  assert.deepEqual(info('12화 (끝)'), { name: '12', number: 12 });
  assert.deepEqual(info('3'), { name: '3', number: 3 });
  for (const [label, name] of [['OVA 1화', 'OVA 1'], ['OAD 2화', 'OAD 2'], ['SP 노벨 히로인즈', 'SP 노벨 히로인즈'], ['특별편', '특별편'], ['스페셜 3화', '스페셜 3'], ['ova 2화', 'ova 2']])
    assert.deepEqual(info(label), { name, number: null, special: true }, label);
  assert.equal(info('SPY 1화').special, undefined, 'a word that only starts like SP is not a special');
});

test('a number in an episode\'s title is not its number (issue #11)', () => {
  assert.deepEqual(info('80000대장경'), { name: '80000대장경', number: null });
  assert.deepEqual(info('팔만대장경'), { name: '팔만대장경', number: null });
  assert.deepEqual(info('3월의 라이온'), { name: '3월의 라이온', number: null });
  for (const [label, number] of [['5회', 5], ['제7화', 7], ['EP 3', 3], ['#4', 4], ['12-13', 12], ['12 END', 12], ['12 (完)', 12], ['1기 3화', 3], ['80000대장경 5화', 5]])
    assert.equal(info(label).number, number, label);
  const numbered = labels => vm.runInContext(`numberTitledEpisodes(${JSON.stringify(labels)}.map(episodeLabelInfo)).map(e=>e.number)`, context);
  assert.deepEqual([...numbered(['1화', '2화', '3화', '4화', '80000대장경', '6화'])], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...numbered(['팔만대장경', '80000대장경', 'OVA 1화'])], [1, 2, null]);
});
