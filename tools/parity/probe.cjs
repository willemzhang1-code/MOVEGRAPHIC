// Physics step-response probe (synthetic cases in web/parity/src/physics.ts)
// and raw per-frame dumps for offline fitting. Needs `npm run dev` in web/.
//   node tools/parity/probe.cjs out.json                 all physics cases: max tip error per case
//   node tools/parity/probe.cjs out.json "?only=x-base,rot-base"
//   node tools/parity/probe.cjs out.json "?rawdump=^ik-"  per-frame bone transforms (ref vs ours)
//   node tools/parity/probe.cjs out.json "?curve=1"       reference bezier samples
const { chromium } = require('./_pw.cjs')();
const fs = require('fs');
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(`${BASE}/parity/physics.html${process.argv[3] ?? ''}`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => document.body.dataset.done, null, { timeout: 900000 });
  console.log(await p.textContent('#status'));
  fs.writeFileSync(process.argv[2] ?? 'probe.json', JSON.stringify(await p.evaluate(() => window.__probe ?? null)));
  await b.close();
})();
