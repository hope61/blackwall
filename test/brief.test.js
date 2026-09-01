// Pure-function tests for the digest. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokens, overlap, dedupe } from '../web/brief.js';

const H = 3600e3;

test('tokens drop stopwords and short words', () => {
  const t = tokens('The rescuers are in a hillside of Nepal');
  assert.ok(t.has('rescuers') && t.has('hillside') && t.has('nepal'));
  for (const stop of ['the', 'are', 'in', 'a', 'of']) assert.ok(!t.has(stop), stop);
});

test('overlap is symmetric and bounded', () => {
  const a = tokens('Man arrested after Swiss rave shooting');
  const b = tokens('Man Arrested in Switzerland After Deadly Shooting');
  const ab = overlap(a, b);
  assert.equal(ab.j, overlap(b, a).j);
  assert.ok(ab.j > 0 && ab.j <= 1);
});

test('merges two feeds covering one event', () => {
  const now = Date.now();
  const out = dedupe([
    { title: 'Man arrested after Swiss rave shooting that killed two', ts: now, source: 'BBC' },
    { title: 'Man Arrested in Switzerland After Deadly Rave Shooting', ts: now - H, source: 'NYT' },
  ]);
  assert.equal(out.length, 1, 'should collapse to one story');
  assert.equal(out[0].dupes, 1);
  assert.deepEqual([...out[0].sources].sort(), ['BBC', 'NYT']);
});

test('keeps the earliest copy as canonical', () => {
  const now = Date.now();
  const out = dedupe([
    { title: 'Man arrested after Swiss rave shooting that killed two', ts: now, source: 'BBC' },
    { title: 'Man Arrested in Switzerland After Deadly Rave Shooting', ts: now - H, source: 'NYT' },
  ]);
  assert.equal(out[0].source, 'NYT', 'the feed that broke it first should lead');
});

test('does NOT merge unrelated stories that share vocabulary', () => {
  const now = Date.now();
  // Both measured 0.25 against live data — deliberately below the threshold.
  const out = dedupe([
    { title: 'Berlin confirms data theft after Rhysida ransomware attack', ts: now, source: 'A' },
    { title: 'FulcrumSec claims Manchester Airports hack, theft of data', ts: now, source: 'B' },
  ]);
  assert.equal(out.length, 2, 'two different breaches must stay separate');
});

test('does not merge across a long time gap', () => {
  const now = Date.now();
  const out = dedupe([
    { title: 'Man arrested after Swiss rave shooting that killed two', ts: now, source: 'BBC' },
    { title: 'Man Arrested in Switzerland After Deadly Rave Shooting', ts: now - 40 * H, source: 'NYT' },
  ]);
  assert.equal(out.length, 2, 'a 40-hour gap is a different event');
});
