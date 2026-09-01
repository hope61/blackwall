// The history sampler shares the panel cache, so it must fetch with the same
// credentials the API does. A stubbed `has` here silently downgraded every
// token-gated panel an hour after startup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { has } from '../server/env.js';
import { sample, summary, METRICS } from '../server/history.js';
import { cached } from '../server/cache.js';
import { sources } from '../server/registry.js';

test('sampler does not stub credential checks', () => {
  const src = readFileSync(new URL('../server/history.js', import.meta.url), 'utf8');
  assert.ok(!/has:\s*\(\)\s*=>/.test(src),
    'history.js must not stub `has` — it would poison the shared panel cache');
});

test('sampling leaves token-gated panels upgraded', { timeout: 180000 }, async () => {
  if (!has('CF_RADAR_TOKEN')) return;              // nothing to prove without a token
  await sample();
  const src = sources.get('outages');
  const out = await cached(src.id, src.ttl, () => src.fetch({ env: process.env, has }));
  assert.equal(out.data.upgraded, true,
    'outages was downgraded after sampling — the cache was poisoned');
});

test('summary reports every metric it can', { timeout: 60000 }, () => {
  const s = summary();
  assert.ok(s.days >= 1, 'expected at least one recorded day');
  for (const key of Object.keys(s.metrics)) {
    assert.ok(key in METRICS, `unknown metric ${key}`);
    assert.equal(typeof s.metrics[key].value, 'number');
  }
});
