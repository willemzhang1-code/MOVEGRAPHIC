// Runs the AI test set (docs/AI_TESTSET.md) through the Studio auto-rig and
// writes one contact row per image: rig overlay, (AI joints), 3 frames of a
// motion. Used by .github/workflows/ai-testset.yml; locally:
//   BASE=http://127.0.0.1:5173 DIR=assets/ai-testset OUT=/tmp/out node tools/run-ai-testset.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE ?? 'https://rabbit-studio.willemzhang1.workers.dev';
const DIR = process.env.DIR ?? 'assets/ai-testset';
const OUT = process.env.OUT ?? 'ai-testset-results';
const AI = process.env.AI !== '0';
const TEMPLATE = { '12': 'quadruped', '13': 'blob', '15': 'quadruped' };
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const files = fs.readdirSync(DIR).filter((f) => /^\d+\.(png|jpe?g|webp)$/i.test(f)).sort();
const summary = [];

async function shot() {
  const buf = await page.locator('.stage').screenshot({ type: 'jpeg', quality: 80 });
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

for (const f of files) {
  const id = f.split('.')[0];
  const template = TEMPLATE[id] ?? 'humanoid';
  const row = { id, template, panels: [], stats: '', error: null, ms: 0 };
  const errors = [];
  const onErr = (e) => errors.push(String(e.message ?? e));
  page.on('pageerror', onErr);
  try {
    const t0 = Date.now();
    await page.goto(`${BASE}/studio/`, { waitUntil: 'networkidle' });
    await page.setInputFiles('input[type=file]', path.join(DIR, f));
    await page.waitForSelector('.row.seg', { timeout: 120000 });
    if (template !== 'humanoid') {
      await page.locator('label.field', { hasText: 'Template' }).locator('select').selectOption(template);
      await page.waitForTimeout(1500);
    }
    row.ms = Date.now() - t0;
    await page.waitForTimeout(500);
    row.panels.push(['auto joints', await shot()]);
    if (AI && template === 'humanoid') {
      await page.getByRole('button', { name: 'AI joints' }).click();
      await page.waitForFunction(() => !document.querySelector('.panel .busy'), null, { timeout: 90000 }).catch(() => {});
      await page.waitForTimeout(500);
      const err = await page.locator('.error').textContent().catch(() => null);
      row.panels.push([err ? `AI joints: ${err.slice(0, 60)}` : 'AI joints', await shot()]);
    }
    row.stats = (await page.locator('.panel .stat').first().textContent()) ?? '';
    const view = await page.locator('.panel .row.seg button.on', { hasText: 'view' }).textContent().catch(() => null);
    if (view) row.stats = `${view.trim()} · ${row.stats}`;
    const names = await page.$$eval('.panel h3 + .row.wrap button', (bs) => bs.map((b) => b.textContent.trim())).catch(() => []);
    const motion = ['walk', 'run', 'idle', 'bounce'].find((m) => names.includes(m)) ?? names[0];
    if (motion) {
      await page.locator('.panel .row.wrap button', { hasText: motion }).first().click();
      for (const wait of [250, 350, 350]) {
        await page.waitForTimeout(wait);
        row.panels.push([`${motion}`, await shot()]);
      }
    }
  } catch (e) {
    row.error = String(e.message ?? e).slice(0, 200);
  }
  page.off('pageerror', onErr);
  if (errors.length) row.error = (row.error ? row.error + ' | ' : '') + errors.slice(0, 2).join(' | ');
  summary.push({ id: row.id, template: row.template, ms: row.ms, stats: row.stats, error: row.error });
  // Contact row: panels side by side, labelled.
  const html = `<html><body style="margin:0;background:#222;font:14px sans-serif;color:#fff">
    <div style="display:flex;gap:4px;padding:4px">${row.panels
      .map(([label, src]) => `<div style="width:360px"><div style="height:20px">${row.id} · ${label}</div><img src="${src}" style="width:360px;display:block"></div>`)
      .join('')}</div><div style="padding:0 6px 6px">${row.template} · ${row.stats} · ${row.ms} ms ${row.error ? '· ERROR ' + row.error : ''}</div></body></html>`;
  const sheet = await browser.newPage({ viewport: { width: 4 + row.panels.length * 364, height: 300 } });
  await sheet.setContent(html);
  await sheet.waitForTimeout(200);
  await sheet.screenshot({ path: path.join(OUT, `${row.id}.jpg`), type: 'jpeg', quality: 75, fullPage: true });
  await sheet.close();
  console.log(row.id, row.template, row.ms, 'ms', row.stats, row.error ?? '');
}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
await browser.close();
