import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { ROOT, PORT, HOST, env, has } from './env.js';
import { cached } from './cache.js';
import { sources } from './registry.js';
import { getGeo, geoSets } from './geo.js';
import { summary, startSampler } from './history.js';

const WEB = join(ROOT, 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

/* Sane defaults for anyone who deploys this exposed rather than on loopback.
   The UI ships no inline scripts and no inline style attributes, so the policy
   can stay strict: everything comes from this origin, plus the data: URI used
   by the favicon. Nothing here is fetched cross-origin. */
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), interest-cohort=()',
};

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(s),
  });
  res.end(s);
};

async function serveStatic(req, res, pathname) {
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(WEB, rel);
  if (!file.startsWith(WEB)) { res.writeHead(403, SECURITY_HEADERS).end('forbidden'); return; }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const buf = await readFile(file);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Content-Length': buf.length,
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' }).end('404');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const p = url.pathname;

  // ── manifest: what panels exist, their labels and refresh cadence ──
  if (p === '/api/panels') {
    return json(res, 200, {
      panels: [...sources.values()].map(({ id, label, ttl, span, group }) => ({
        id, label, ttl, span: span ?? 1, group: group ?? 'GRID',
      })),
      credentials: {
        cloudflareRadar: has('CF_RADAR_TOKEN'),
        abusech: has('ABUSECH_AUTH_KEY'),
        github: has('GITHUB_TOKEN'),
      },
      operator: {
        label: env.OPERATOR_LABEL ?? null,
      },
      serverTime: new Date().toISOString(),
    });
  }

  // ── one panel's data ──
  const m = p.match(/^\/api\/panel\/([a-z0-9_-]+)$/i);
  if (m) {
    const src = sources.get(m[1]);
    if (!src) return json(res, 404, { error: `no such source: ${m[1]}` });
    const t0 = Date.now();
    const out = await cached(src.id, src.ttl, () => src.fetch({ env, has }));
    console.log(`[api] ${src.id} ${out.state} age=${out.age}s ${Date.now() - t0}ms`);
    return json(res, 200, { id: src.id, label: src.label, ttl: src.ttl, ...out });
  }

  // ── everything at once, for first paint ──
  if (p === '/api/all') {
    const ids = [...sources.keys()];
    const results = await Promise.all(
      ids.map(async (id) => {
        const src = sources.get(id);
        try {
          const out = await cached(id, src.ttl, () => src.fetch({ env, has }));
          return [id, { id, label: src.label, ttl: src.ttl, ...out }];
        } catch (err) {
          return [id, { id, label: src.label, state: 'FAULT', data: null, error: String(err?.message ?? err) }];
        }
      }),
    );
    return json(res, 200, Object.fromEntries(results));
  }

  // The layout config lives at the repo root so it is easy to find and edit.
  if (p === '/panels.config.json') {
    try {
      const buf = await readFile(join(ROOT, 'panels.config.json'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(buf);
    } catch {
      return json(res, 500, { error: 'panels.config.json missing or unreadable' });
    }
  }

  // Heavy map geometry, fetched only when a layer needs it.
  const g = p.match(/^\/api\/geo\/([a-z0-9_-]+)$/i);
  if (g) {
    if (!geoSets[g[1]]) return json(res, 404, { error: `no such geo set: ${g[1]}` });
    const out = await getGeo(g[1]);
    console.log(`[geo] ${g[1]} ${out.state} age=${out.age}s`);
    return json(res, 200, out);
  }

  if (p === '/api/history') return json(res, 200, summary());

  if (p === '/api/health') return json(res, 200, { ok: true, sources: sources.size, uptime: process.uptime() });

  return serveStatic(req, res, p);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  BLACKWALL // listening on http://${HOST}:${PORT}`);
  startSampler();
  console.log(`  credentials: radar=${has('CF_RADAR_TOKEN')} abusech=${has('ABUSECH_AUTH_KEY')} github=${has('GITHUB_TOKEN')}\n`);
});
