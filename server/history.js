// Daily metric history.
//
// Every panel is a live snapshot, which means the board can say "9.5M attacks
// today" but never "up 14% on the week". Absolutes are far less interesting
// than movement, so a small set of scalars is sampled once an hour and kept
// per UTC day for 120 days. One flat file; no database.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, env, has } from './env.js';
import { cached } from './cache.js';
import { sources } from './registry.js';

const DIR = join(ROOT, '.cache');
const FILE = join(DIR, 'history.json');
const KEEP_DAYS = 120;

if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

/** What we track, and how to pull it out of a panel payload.
 *  `dir: 'up'` means a rising number is bad news. */
export const METRICS = {
  attacks:      { panel: 'honeypot',   label: 'Attack volume',    dir: 'up',   pick: (d) => d?.totals?.records },
  attackers:    { panel: 'honeypot',   label: 'Unique attackers', dir: 'up',   pick: (d) => d?.totals?.sources },
  torExits:     { panel: 'tor',        label: 'Tor exit nodes',   dir: 'flat', pick: (d) => d?.total },
  torBandwidth: { panel: 'tor',        label: 'Tor bandwidth',    dir: 'flat', pick: (d) => d?.bandwidth },
  kev:          { panel: 'kev',        label: 'KEV catalogue',    dir: 'up',   pick: (d) => d?.total },
  ransomware:   { panel: 'ransomware', label: 'Ransomware / 24h', dir: 'up',   pick: (d) => d?.last24h },
  pwned:        { panel: 'breaches',   label: 'Accounts breached',dir: 'up',   pick: (d) => d?.totalAccounts },
  outages:      { panel: 'outages',    label: 'Outages ongoing',  dir: 'up',   pick: (d) => d?.ongoing },
  c2:           { panel: 'malware',    label: 'C2 online',        dir: 'up',   pick: (d) => d?.online },
  ipv6:         { panel: 'ipv6',       label: 'IPv6 adoption',    dir: 'down', pick: (d) => d?.global },
  cveCritical:  { panel: 'cve',        label: 'Critical CVEs',    dir: 'up',   pick: (d) => d?.buckets?.CRITICAL },
  rootRtt:      { panel: 'rootdns',    label: 'Root DNS latency', dir: 'up',   pick: (d) => d?.medianRtt },
};

function load() {
  try {
    if (!existsSync(FILE)) return {};
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch { return {}; }
}

function save(db) {
  try {
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(db));
    renameSync(tmp, FILE);          // atomic; a torn history file is worse than none
  } catch (err) {
    console.warn('[history] write failed:', err.message);
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/** Sample every tracked metric and record it against today's date. */
export async function sample() {
  const db = load();
  const day = today();
  db[day] ??= {};

  for (const [key, m] of Object.entries(METRICS)) {
    const src = sources.get(m.panel);
    if (!src) continue;
    try {
      // Must pass the real credentials. Sampling shares the panel cache, so a
      // stubbed `has` here writes a credential-less payload into the entry the
      // UI reads — silently downgrading every token-gated panel an hour after
      // startup.
      const out = await cached(src.id, src.ttl, () => src.fetch({ env, has }));
      const v = m.pick(out.data);
      // Last write of the day wins, so the figure settles as the day completes.
      if (typeof v === 'number' && Number.isFinite(v)) db[day][key] = v;
    } catch { /* a missing sample is fine; a wrong one is not */ }
  }

  for (const d of Object.keys(db).sort().slice(0, -KEEP_DAYS)) delete db[d];
  save(db);
  return db[day];
}

/** Series + comparisons for the frontend. */
export function summary() {
  const db = load();
  const days = Object.keys(db).sort();
  const out = {};

  for (const [key, m] of Object.entries(METRICS)) {
    const series = days
      .map((d) => ({ date: d, v: db[d]?.[key] }))
      .filter((x) => typeof x.v === 'number');
    if (!series.length) continue;

    const now = series.at(-1);
    const prev = series.length > 1 ? series.at(-2) : null;
    // Compare against the week before today, excluding today's partial figure.
    const window = series.slice(-8, -1);
    const avg = window.length
      ? window.reduce((a, b) => a + b.v, 0) / window.length
      : null;

    out[key] = {
      label: m.label,
      dir: m.dir,
      value: now.v,
      date: now.date,
      prev: prev?.v ?? null,
      dayChange: prev ? now.v - prev.v : null,
      avg7: avg,
      pctVsAvg: avg ? ((now.v - avg) / avg) * 100 : null,
      series: series.slice(-30),
      days: series.length,
    };
  }
  return { metrics: out, days: days.length, from: days[0] ?? null, to: days.at(-1) ?? null };
}

/** Hourly sampling. Runs immediately so a fresh install has a first data point. */
export function startSampler() {
  const run = () => sample().catch((e) => console.warn('[history]', e.message));
  setTimeout(run, 8000);                    // let the first fetches land
  setInterval(run, 3600 * 1000);
}
