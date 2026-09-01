// Contract tests against live upstreams.
//
// These deliberately hit the network. The thing being tested is precisely
// whether third-party APIs still return the shapes we normalise, so mocking
// them would test nothing. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sources } from '../server/registry.js';
import { env, has } from '../server/env.js';
import { validate, SPECS } from './schema.js';

// Panels that legitimately report { available:false } with no Radar token.
const TOKEN_GATED = { outages: 'CF_RADAR_TOKEN', bgp: 'CF_RADAR_TOKEN', attacks: 'CF_RADAR_TOKEN', ipv6: 'CF_RADAR_TOKEN' };

test('every source has a shape contract', () => {
  const missing = [...sources.keys()].filter((id) => !SPECS[id]);
  assert.deepEqual(missing, [], `sources without a spec: ${missing.join(', ')}`);
});

test('every source declares id, label and ttl', () => {
  for (const [id, src] of sources) {
    assert.equal(typeof src.id, 'string', `${id}: id`);
    assert.equal(typeof src.label, 'string', `${id}: label`);
    assert.ok(Number.isFinite(src.ttl) && src.ttl > 0, `${id}: ttl must be a positive number`);
    assert.equal(typeof src.fetch, 'function', `${id}: fetch`);
  }
});

for (const [id, src] of sources) {
  test(`${id} returns its contracted shape`, { timeout: 180000 }, async () => {
    const data = await src.fetch({ env, has });
    assert.ok(data && typeof data === 'object', `${id} returned no object`);

    const key = TOKEN_GATED[id];
    if (key && !has(key)) {
      assert.equal(data.available ?? data.upgraded, false,
        `${id} has no ${key} so it must report unavailable rather than an empty panel`);
      return;
    }

    const errs = validate(id, data);
    assert.deepEqual(errs, [], `\n  ${errs.join('\n  ')}`);
  });
}
