'use strict';
/**
 * chartjs-chart-financial and chartjs-adapter-date-fns ship `"type":"module"` while their dist
 * builds are UMD/CJS `require()` bundles. Node 22 then loads them via `importSyncForRequire` and
 * `require("chart.js")` / `require("chart.js/helpers")` inside those files resolve to undefined
 * when the app entry is a .js file (e.g. `node index.js`). Dropping `type` makes Node treat
 * those .js files as CommonJS so the bot's charts render.
 */
const fs = require('fs');
const path = require('path');

const roots = [
  path.join(__dirname, '..', 'node_modules', 'chartjs-chart-financial', 'package.json'),
  path.join(__dirname, '..', 'node_modules', 'chartjs-adapter-date-fns', 'package.json')
];

for (const pkgPath of roots) {
  if (!fs.existsSync(pkgPath)) continue;
  const raw = fs.readFileSync(pkgPath, 'utf8');
  const j = JSON.parse(raw);
  if (j.type !== 'module') continue;
  delete j.type;
  fs.writeFileSync(pkgPath, `${JSON.stringify(j, null, 2)}\n`);
  console.log('[patch-chartjs-packages] removed type:module from %s', path.basename(path.dirname(pkgPath)));
}
