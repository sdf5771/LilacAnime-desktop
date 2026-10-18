const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dropCaptions } = require('../electron/subtitle-translator.cjs');

test('caption labels, speaker names and vocal sounds are taken out; words and thoughts stay', () => {
  const cases = {
    '（創太）えっ？': 'えっ？', '（男の子）こんにちは\n（拍手）': 'こんにちは', '（ため息）': '', '（ドアの開く音）': '', 'そうだね（笑い）': 'そうだね',
    '創太：行くぞ': '行くぞ', '[laughs]': '', '(SIGHS) Okay.': 'Okay.', 'SOTA: Hey there.': 'Hey there.', 'Note: this works': 'Note: this works',
    'あっ': '', 'うう…': '', 'くっ': '', 'はあ…': '', 'あはは': '', 'ふふっ': '', 'Ugh!': '', 'Hahaha': '',
    'うん': 'うん', 'ええ': 'ええ', 'ううん': 'ううん', 'えっ': 'えっ', '（どうしよう）': '（どうしよう）'
  };
  for (const [source, expected] of Object.entries(cases)) assert.equal(dropCaptions(source), expected, source);
});
