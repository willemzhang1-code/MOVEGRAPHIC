// Cloudflare Worker serving the built web app from the `deploy` branch of the
// public GitHub repo, pinned to a commit and cached at the edge.
// REF is replaced with the deploy commit when the worker is uploaded.

const REPO = 'willemzhang1-code/MOVEGRAPHIC';
const REF = '__REF__';
const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  wasm: 'application/wasm',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  atlas: 'text/plain; charset=utf-8',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const url = new URL(request.url);
    let path = decodeURIComponent(url.pathname);
    if (path.includes('..') || path.includes('\\')) return new Response('Bad path', { status: 400 });
    if (path === '/studio' || path === '/demo') return Response.redirect(`${url.origin}${path}/`, 301);
    if (path.endsWith('/')) path += 'index.html';
    const ext = path.split('.').pop().toLowerCase();
    const cache = caches.default;
    const key = new Request(`https://rabbit-cache.invalid/${REF}${path}`);
    let res = await cache.match(key);
    if (!res) {
      const origin = await fetch(`https://raw.githubusercontent.com/${REPO}/${REF}${path}`, { cf: { cacheTtl: 86400, cacheEverything: true } });
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
