// Cloudflare Worker for RABBIT:
// - serves the built web app from the `deploy` branch of the public GitHub
//   repo, cached at the edge (deploying = pushing that branch);
// - /api/keypoints: AI joint detection with Workers AI (env.AI binding).

const REPO = 'willemzhang1-code/MOVEGRAPHIC';
const REF = 'deploy';
const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  wasm: 'application/wasm',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  atlas: 'text/plain; charset=utf-8',
};

const JOINTS = {
  humanoid: {
    head_top: 'top of the head',
    neck: 'base of the neck',
    chest: 'middle of the chest',
    pelvis: 'centre of the hips / pelvis',
    shoulder_l: 'shoulder on the left side of the image',
    elbow_l: 'elbow on the left side of the image',
    wrist_l: 'wrist on the left side of the image',
    shoulder_r: 'shoulder on the right side of the image',
    elbow_r: 'elbow on the right side of the image',
    wrist_r: 'wrist on the right side of the image',
    hip_l: 'hip joint on the left side of the image',
    knee_l: 'knee on the left side of the image',
    ankle_l: 'ankle on the left side of the image',
    hip_r: 'hip joint on the right side of the image',
    knee_r: 'knee on the right side of the image',
    ankle_r: 'ankle on the right side of the image',
  },
  quadruped: {
    head: 'centre of the head',
    nose: 'tip of the nose / snout',
    withers: 'top of the shoulders (withers)',
    pelvis: 'top of the hips',
    tail_tip: 'tip of the tail',
    fl_paw: 'front paw on the right side of the image',
    fr_paw: 'other front paw',
    bl_paw: 'back paw on the left side of the image',
    br_paw: 'other back paw',
  },
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v)));

async function scout(env, dataUri, template) {
  const names = JOINTS[template];
  const list = Object.entries(names)
    .map(([k, d]) => `- ${k}: ${d}`)
    .join('\n');
  const schema = {
    type: 'object',
    properties: Object.fromEntries(Object.keys(names).map((k) => [k, { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }])),
    required: Object.keys(names),
  };
  const prompt =
    `You are a 2D animation rigging assistant. The image shows one full-body game character. ` +
    `Locate these joints and return JSON mapping each name to [x, y], normalised to the image (0..1, x from the left edge, y from the top edge). ` +
    `"Left/right side of the image" means screen side, not the character's own side. Estimate hidden joints.\n${list}`;
  const r = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUri } }] }],
    response_format: { type: 'json_schema', json_schema: schema },
    max_tokens: 800,
    temperature: 0,
  });
  let out = r.response ?? r;
  if (typeof out === 'string') out = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  const joints = {};
  for (const k of Object.keys(names)) {
    const p = out?.[k];
    if (Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1])) {
      // Some answers come back in pixels: normalise defensively.
      const big = Math.max(+p[0], +p[1]) > 1.5;
      joints[k] = big ? null : [clamp01(p[0]), clamp01(p[1])];
    }
  }
  return joints;
}

const PARTS = {
  humanoid: ['head', 'torso', 'arm_left_of_image', 'arm_right_of_image', 'leg_left_of_image', 'leg_right_of_image', 'tail'],
  quadruped: ['head', 'body', 'tail', 'front_legs', 'back_legs'],
};

/** Bounding boxes of body parts ([x0, y0, x1, y1], normalised); missing parts omitted. */
async function scoutBoxes(env, dataUri, template) {
  const names = PARTS[template] ?? PARTS.humanoid;
  const box = { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 };
  const properties = Object.fromEntries(names.map((k) => [k, box]));
  if (template === 'humanoid') properties.facing = { type: 'string', enum: ['profile', 'three_quarter', 'front', 'back'] };
  const schema = { type: 'object', properties };
  const prompt =
    `You are a 2D animation rigging assistant. The image shows one full-body game character. ` +
    `Give a tight bounding box for each visible body part as [x0, y0, x1, y1], normalised to the image (0..1, origin top-left). ` +
    `"left/right of image" means screen side. Include the whole limb from shoulder or hip to the hand or foot. Omit parts that do not exist.\nParts: ${names.join(', ')}` +
    (template === 'humanoid'
      ? `\nAlso "facing": "profile" if the body is seen from the side (only one shoulder and the far leg mostly hidden behind the near one), "three_quarter" if turned partly toward the viewer with both shoulders visible, "front" if facing the viewer, "back" if facing away.`
      : '');
  const r = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUri } }] }],
    response_format: { type: 'json_schema', json_schema: schema },
    max_tokens: 600,
    temperature: 0,
  });
  let out = r.response ?? r;
  if (typeof out === 'string') out = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  const boxes = {};
  for (const k of names) {
    const b = out?.[k];
    if (Array.isArray(b) && b.length === 4 && b.every((v) => Number.isFinite(+v) && +v <= 1.5)) {
      const [x0, y0, x1, y1] = b.map(clamp01);
      if (x1 > x0 && y1 > y0) boxes[k] = [x0, y0, x1, y1];
    }
  }
  const facing = ['profile', 'three_quarter', 'front', 'back'].includes(out?.facing) ? out.facing : undefined;
  return { boxes, facing };
}

async function moondream(env, dataUri, template) {
  const names = JOINTS[template];
  const joints = {};
  await Promise.all(
    Object.entries(names).map(async ([k, d]) => {
      let r = await env.AI.run('@cf/moondream/moondream3.1-9B-A2B', { task: 'point', image: dataUri, target: `the character's ${d}`, max_objects: 1 });
      if (r instanceof ReadableStream) r = JSON.parse(await new Response(r).text());
      const p = r?.points?.[0] ?? r?.result?.points?.[0];
      if (p) joints[k] = [clamp01(p.x), clamp01(p.y)];
    }),
  );
  return joints;
}

async function keypoints(request, env, url) {
  if (!env.AI) return json({ error: 'AI binding missing' }, 500);
  let dataUri;
  let template = 'humanoid';
  let model = 'scout';
  if (request.method === 'POST') {
    // Same-origin only: the endpoint spends the account's AI quota.
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return json({ error: 'forbidden' }, 403);
    const body = await request.json();
    template = body.template ?? template;
    model = body.model ?? model;
    const m = /^data:image\/(?:png|jpeg|webp);base64,(.+)$/.exec(body.image ?? '');
    if (!m) return json({ error: 'image must be a png/jpeg/webp data URI' }, 400);
    if (m[1].length > 1_500_000) return json({ error: 'image too large (max ~1 MB)' }, 413);
    dataUri = body.image;
  } else {
    // Debug: only this site's own sample images.
    const path = url.searchParams.get('sample') ?? '';
    if (!/^[a-z0-9_-]+\.png$/i.test(path)) return json({ error: 'sample=<name>.png' }, 400);
    template = url.searchParams.get('template') ?? template;
    model = url.searchParams.get('model') ?? model;
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${REF}/samples/${path}`);
    if (!res.ok) return json({ error: 'sample not found' }, 404);
    dataUri = `data:image/png;base64,${toBase64(await res.arrayBuffer())}`;
  }
  if (!JOINTS[template]) return json({ error: 'unknown template' }, 400);
  const t0 = Date.now();
  try {
    if (model === 'boxes') {
      const { boxes, facing } = await scoutBoxes(env, dataUri, template);
      return json({ template, model, ms: Date.now() - t0, boxes, facing });
    }
    const joints = model === 'moondream' ? await moondream(env, dataUri, template) : await scout(env, dataUri, template);
    return json({ template, model, ms: Date.now() - t0, joints });
  } catch (e) {
    return json({ error: String(e).slice(0, 500), model }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/keypoints') return keypoints(request, env, url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    let path = decodeURIComponent(url.pathname);
    if (path.includes('..') || path.includes('\\')) return new Response('Bad path', { status: 400 });
    if (path === '/studio' || path === '/demo') return Response.redirect(`${url.origin}${path}/`, 301);
    if (path.endsWith('/')) path += 'index.html';
    const ext = path.split('.').pop().toLowerCase();
    const cache = caches.default;
    const key = new Request(`https://rabbit-cache.invalid${path}`);
    let res = await cache.match(key);
    if (!res) {
      const origin = await fetch(`https://raw.githubusercontent.com/${REPO}/${REF}${path}`, { cf: { cacheTtl: 60, cacheEverything: true } });
      if (!origin.ok) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      const immutable = /^\/assets\/.+-[A-Za-z0-9_-]{8}\.(js|css)$/.test(path);
      res = new Response(origin.body, {
        headers: {
          'content-type': TYPES[ext] ?? 'application/octet-stream',
          'cache-control': immutable ? 'public, max-age=86400' : 'public, max-age=300',
          'x-content-type-options': 'nosniff',
        },
      });
      ctx.waitUntil(cache.put(key, res.clone()));
    }
    return res;
  },
};
