// Downloads the AI test set images listed in tools/ai-testset-urls.txt.
//   node tools/fetch-ai-testset.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'assets/ai-testset');
fs.mkdirSync(out, { recursive: true });
const lines = fs.readFileSync(path.join(root, 'tools/ai-testset-urls.txt'), 'utf8').trim().split('\n');
await Promise.all(
  lines.map(async (line) => {
    const [id, url] = line.trim().split(/\s+/);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
    fs.writeFileSync(path.join(out, `${id}.png`), Buffer.from(await res.arrayBuffer()));
    console.log(`${id}.png`);
  }),
);
