// Downloads Esoteric Software's public Spine example exports for local
// compatibility testing. The assets belong to Esoteric Software and are NOT
// committed or redistributed (target dir is gitignored).
//
//   node tools/fetch-spine-examples.mjs [branch=4.2]

import fs from 'node:fs';
import path from 'node:path';

const branch = process.argv[2] ?? '4.2';
const BASE = `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/${branch}/examples`;
const OUT = path.resolve(import.meta.dirname, '../web/demo/public/examples', branch);
const NAMES = [
  'spineboy', 'raptor', 'goblins', 'tank', 'vine', 'stretchyman', 'owl', 'mix-and-match', 'coin',
  'celestial-circus', 'cloud-pot', 'sack', 'snowglobe', 'dragon', 'hero', 'powerup', 'speedy',
  'windmill', 'alien', 'chibi-stickers',
];

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

const index = [];
for (const name of NAMES) {
  const dir = path.join(OUT, name);
  fs.mkdirSync(dir, { recursive: true });
  let skeleton = null;
  for (const f of [`${name}-pro.json`, `${name}-ess.json`, `${name}.json`]) {
    const data = await get(`${BASE}/${name}/export/${f}`);
    if (data) {
      fs.writeFileSync(path.join(dir, f), data);
      skeleton = f;
      break;
    }
  }
  const atlasName = `${name}-pma.atlas`;
  const atlas = await get(`${BASE}/${name}/export/${atlasName}`);
  if (!skeleton || !atlas) {
    console.log(`skip ${name}`);
    continue;
  }
  fs.writeFileSync(path.join(dir, atlasName), atlas);
  // Page names: first non-empty line of each blank-line separated block.
  const pages = [];
  let expect = true;
  for (const line of atlas.toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) { expect = true; continue; }
    if (expect) { pages.push(line.trim()); expect = false; }
  }
  for (const p of pages) {
    const png = await get(`${BASE}/${name}/export/${p}`);
    if (png) fs.writeFileSync(path.join(dir, p), png);
    else console.log(`  missing page ${p}`);
  }
  index.push({ name, skeleton, atlas: atlasName, pages });
  console.log(`${name}: ${skeleton}, ${pages.length} page(s)`);
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
console.log(`wrote ${index.length} examples to ${path.relative(process.cwd(), OUT)}`);
