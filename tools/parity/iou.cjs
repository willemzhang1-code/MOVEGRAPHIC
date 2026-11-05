// Silhouette IoU against the official spine-webgl runtime for the Spine
// examples (renderer-level check). Needs `npm run dev` in web/ and the
// examples from tools/fetch-spine-examples.mjs.
//   node tools/parity/iou.cjs <outDir> ["only=spineboy,raptor&anim=walk"]
const { chromium } = require('./_pw.cjs')();
const fs = require('fs');
const out = process.argv[2] ?? 'parity-out';
const query = process.argv[3] ?? '';
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1140, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${BASE}/parity/?${query}`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => document.body.dataset.done, null, { timeout: 900000 });
  const r = await p.evaluate(() => window.__parity || []);
  fs.writeFileSync(`${out}/results.json`, JSON.stringify(r, null, 1));
  const by = {};
  for (const x of r) (by[x.example] ??= []).push(x);
  for (const [k, v] of Object.entries(by)) {
    const iou = v.reduce((s, x) => s + x.iou, 0) / v.length;
    const worst = v.reduce((m, x) => (x.iou < m.iou ? x : m));
    console.log(`${k.padEnd(18)} meanIoU ${iou.toFixed(3)}  worst ${worst.iou.toFixed(3)} (${worst.animation} @${worst.time.toFixed(2)})`);
  }
  console.log('errors', errs.slice(0, 5));
  await b.close();
})();
