const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'src/vendor/anime4k');
fs.mkdirSync(out, { recursive: true });
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'anime4k-entry.mjs')], outfile: path.join(out, 'anime4k.mjs'),
  bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', minify: true, legalComments: 'inline'
});
fs.copyFileSync(path.join(root, 'node_modules/anime4k.js/LICENSE'), path.join(out, 'LICENSE'));
console.log('anime4k bundled -> src/vendor/anime4k');
