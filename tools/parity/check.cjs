// Bone-level parity against the official runtime (web/parity/physics.html).
// Prints the page's report. Needs `npm run dev` in web/.
//   node tools/parity/check.cjs "scan=1&frames=150&dt=0.0166683"        all example animations
//   node tools/parity/check.cjs "scan=1&only=raptor"                     one example
//   node tools/parity/check.cjs "example=sack&anim=walk&thr=0.3"         first diverging bones
//   node tools/parity/check.cjs "example=sack&anim=walk&trace=bone1,bone2&frames=10"
//   node tools/parity/check.cjs "raw=1"                                  synthetic IK / inherit / path cases
//   node tools/parity/check.cjs "raw=^ik-"                               subset (regex)
const { chromium } = require('./_pw.cjs')();
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(`${BASE}/parity/physics.html?${process.argv[2] ?? 'raw=1'}`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => document.body.dataset.done, null, { timeout: 900000 });
  console.log(await p.textContent('#status'));
  await b.close();
})();
