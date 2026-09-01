// Shape contracts, one per source.
//
// Every panel that silently rendered empty during this build did so because an
// upstream changed shape, not because it broke: DShield started returning
// index-keyed objects instead of arrays, cable landing points lost their
// country field, Radar nested hijack prefixes in an array, APNIC began serving
// HTML. None of those threw — they produced a well-formed, empty panel.
//
// These specs assert the fields the renderers actually read, so drift fails
// loudly instead of quietly.

/** t: type, req: must be present, min: minimum array length / numeric floor */
export const SPECS = {
  tor: {
    total: { t: 'number', min: 100 },
    countryCount: { t: 'number', min: 5 },
    bandwidth: { t: 'number', min: 1 },
    countries: { t: 'array', min: 5, each: { cc: 'string', count: 'number' } },
    geo: { t: 'array', min: 5, each: { cc: 'string', count: 'number' } },
  },
  honeypot: {
    infocon: { t: 'string' },
    settledDate: { t: 'string' },
    // The bug that started this: index-keyed objects normalised to [].
    ports: { t: 'array', min: 1, each: { port: 'number', records: 'number' } },
    sources: { t: 'array', min: 1, each: { ip: 'string' } },
    series: { t: 'array', min: 1, each: { date: 'string', records: 'number' } },
    totals: { t: 'object', keys: ['records', 'sources', 'targets'] },
  },
  rootdns: {
    servers: { t: 'array', min: 13, max: 13, each: { letter: 'string', status: 'string' } },
    reachable: { t: 'number' },
    total: { t: 'number', min: 13 },
  },
  cloudflare: {
    indicator: { t: 'string' },
    description: { t: 'string' },
    total: { t: 'number', min: 1 },
    degraded: { t: 'array' },
    incidents: { t: 'array' },
  },
  kev: {
    total: { t: 'number', min: 100 },
    items: { t: 'array', min: 1, each: { cve: 'string', vendor: 'string', dateAdded: 'string' } },
    topVendors: { t: 'array', min: 1 },
  },
  cve: {
    total: { t: 'number' },
    buckets: { t: 'object', keys: ['CRITICAL', 'HIGH', 'MEDIUM'] },
    histogram: { t: 'array', min: 10, max: 10 },
  },
  ransomware: {
    victims: { t: 'array', min: 1, each: { victim: 'string', group: 'string' } },
    topGroups: { t: 'array', min: 1, each: { k: 'string', n: 'number' } },
    last24h: { t: 'number' },
  },
  breaches: {
    totalBreaches: { t: 'number', min: 100 },
    totalAccounts: { t: 'number', min: 1e9 },
    recent: { t: 'array', min: 1, each: { title: 'string', count: 'number' } },
    byYear: { t: 'array', min: 1 },
  },
  news: {
    items: { t: 'array', min: 5, each: { title: 'string', source: 'string' } },
    feeds: { t: 'array', min: 1 },
  },
  world: {
    press: { t: 'array', min: 5, each: { title: 'string', source: 'string' } },
    hn: { t: 'array', min: 1, each: { title: 'string', score: 'number' } },
  },
  github: {
    repos: { t: 'array', min: 1, each: { name: 'string', stars: 'number' } },
  },
  ct: {
    treeSize: { t: 'number', min: 1e6 },
    certs: { t: 'array', min: 1, each: { cn: 'string' } },
  },
  cables: {
    // Landing points carry no country field; it is parsed out of the name.
    cableCount: { t: 'number', min: 100 },
    landingCount: { t: 'number', min: 100 },
    byCountry: { t: 'array', min: 5, each: { k: 'string', n: 'number' } },
  },
  space: {
    kp: { t: 'number' },
    kpImpact: { t: 'string' },
    kpSeries: { t: 'array', min: 1, each: { kp: 'number' } },
  },
  quakes: {
    events: { t: 'array', each: { mag: 'number', place: 'string' } },
    count: { t: 'number' },
  },
  malware: {
    total: { t: 'number' },
    families: { t: 'array' },
  },
  apt: {
    total: { t: 'number', min: 50 },
    groups: { t: 'array', min: 10, each: { id: 'string', name: 'string' } },
  },
  egress: {
    ip: { t: 'string' },
  },
  orbital: {
    iss: { t: 'object', keys: ['lat', 'lon', 'altitude'] },
  },
  // Token-gated: these report { available:false } without a Radar key, which
  // is a valid shape, so the check is conditional in the runner.
  outages: { events: { t: 'array' }, upgraded: { t: 'boolean' } },
  bgp: { hijacks: { t: 'array' }, available: { t: 'boolean' } },
  attacks: { series: { t: 'array' }, available: { t: 'boolean' } },
  ipv6: { global: { t: 'number' }, available: { t: 'boolean' } },
};

/** Returns an array of human-readable problems; empty means the shape holds. */
export function validate(id, data) {
  const spec = SPECS[id];
  const errs = [];
  if (!spec) return [`no spec defined for "${id}"`];
  if (data == null) return [`${id}: data is null`];

  for (const [key, rule] of Object.entries(spec)) {
    const v = data[key];

    if (v === undefined || v === null) { errs.push(`${id}.${key} is missing`); continue; }

    if (rule.t === 'array') {
      if (!Array.isArray(v)) { errs.push(`${id}.${key} should be an array, got ${typeof v}`); continue; }
      if (rule.min != null && v.length < rule.min) errs.push(`${id}.${key} has ${v.length} entries, expected at least ${rule.min}`);
      if (rule.max != null && v.length > rule.max) errs.push(`${id}.${key} has ${v.length} entries, expected at most ${rule.max}`);
      if (rule.each && v.length) {
        for (const [f, ft] of Object.entries(rule.each)) {
          const bad = v.slice(0, 5).filter((row) => typeof row?.[f] !== ft);
          if (bad.length) errs.push(`${id}.${key}[].${f} should be ${ft} (${bad.length}/5 sampled wrong)`);
        }
      }
      continue;
    }

    if (rule.t === 'object') {
      if (typeof v !== 'object') { errs.push(`${id}.${key} should be an object`); continue; }
      for (const k of rule.keys ?? []) {
        if (v[k] === undefined || v[k] === null) errs.push(`${id}.${key}.${k} is missing`);
      }
      continue;
    }

    if (typeof v !== rule.t) { errs.push(`${id}.${key} should be ${rule.t}, got ${typeof v}`); continue; }
    if (rule.t === 'number') {
      if (!Number.isFinite(v)) errs.push(`${id}.${key} is not finite`);
      else if (rule.min != null && v < rule.min) errs.push(`${id}.${key} is ${v}, expected at least ${rule.min}`);
    }
  }
  return errs;
}
