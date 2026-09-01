// The morning read.
//
// A grid of 22 gauges answers "what is the state of everything". It does not
// answer "what happened while I was asleep", which is the question you actually
// have with a coffee in hand. This merges every source into one ranked stream
// of things worth knowing, newest and most consequential first.

const HOUR = 3600e3;

/** Importance weight per kind — decides what floats when everything is recent. */
const WEIGHT = {
  outage: 100, kev: 82, breach: 78, world: 74, news: 70,
  hijack: 62, hn: 58, ransomware: 45, quake: 40, repo: 34, space: 30, cert: 10,
};

const t = (v) => (v == null ? null : (typeof v === 'number' ? v : Date.parse(v)));

// ── cross-feed deduplication ──────────────────────────────────────────────
// BBC, NYT and the security feeds routinely cover the same event, and the
// digest showed each copy as a separate story. Cluster on title token overlap
// and keep one entry carrying every source that ran it.
const STOP = new Set(('a an the of in on at to for from by with and or as is are was were '
  + 'be been it its this that these those after before over under new say says said '
  + 'report reports amid into out up down more than about').split(' '));

export function tokens(title) {
  return new Set(
    String(title).toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function overlap(a, b) {
  if (!a.size || !b.size) return { j: 0, shared: 0 };
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return { j: shared / (a.size + b.size - shared), shared };   // Jaccard + count
}

// Calibrated against live feeds. Genuine same-event pairs measured 0.29-0.44;
// unrelated stories that merely share vocabulary ("data theft ransomware",
// "flaws execute code") measured up to 0.25. The gap is narrow, so this errs
// toward precision: a wrong merge hides a real story, a missed merge only
// repeats one. Two extra guards carry the rest of the work.
const SIM_MIN = 0.30;
const SHARED_MIN = 2;              // one coincidental word is not a match
const WINDOW_MS = 24 * HOUR;       // coverage of one event clusters in time

export function dedupe(items) {
  const clusters = [];
  for (const it of items) {
    const tk = tokens(it.title);
    const hit = clusters.find((c) => {
      if (Math.abs(c.lead.ts - it.ts) > WINDOW_MS) return false;
      const o = overlap(c.tokens, tk);
      return o.j >= SIM_MIN && o.shared >= SHARED_MIN;
    });
    if (hit) {
      hit.members.push(it);
      // Keep the earliest publication as the canonical one; it broke the story.
      if (it.ts < hit.lead.ts) { hit.lead = it; hit.tokens = tk; }
    } else {
      clusters.push({ tokens: tk, lead: it, members: [it] });
    }
  }
  return clusters.map((c) => {
    const sources = [...new Set(c.members.map((m) => m.source).filter(Boolean))];
    return { ...c.lead, dupes: c.members.length - 1, sources };
  });
}

export function buildBrief(data, sinceTs) {
  const d = (id) => data[id]?.data;
  let items = [];
  const push = (o) => { if (o.ts) items.push(o); };

  // ── outages ──
  for (const e of d('outages')?.events ?? []) {
    push({
      kind: 'outage', ts: t(e.start), panel: 'outages',
      title: `${e.locations.map((l) => l.name).join(', ') || e.cc} — ${e.description}`,
      why: `${e.cause} · ${e.asnCount} networks affected${e.ongoing ? ' · ONGOING' : ''}`,
      sev: e.ongoing ? 'crit' : e.cause === 'STATE DIRECTED' ? 'warn' : 'info',
      cc: e.cc,
    });
  }

  // ── BGP hijacks worth believing ──
  for (const h of (d('bgp')?.hijacks ?? []).filter((x) => x.confidence >= 4).slice(0, 6)) {
    push({
      kind: 'hijack', ts: t(h.start), panel: 'bgp',
      title: `${h.prefix} announced by AS${h.hijackerAsn}${h.hijackerName ? ' ' + h.hijackerName : ''}`,
      why: `Route hijack · victim ${h.victimName ?? 'AS' + h.victimAsn} · confidence ${h.confidence}`,
      // Never 'crit': high-confidence hijacks fire many times a day, so letting
      // them claim the lead slot would bury the actual news every morning.
      sev: 'warn',
      cc: h.hijackerCc,
    });
  }

  // ── newly exploited vulnerabilities ──
  // CISA often adds several CVEs for one product on the same day. Listing each
  // separately fills the column with near-identical rows, so group by product.
  const kevGroups = new Map();
  for (const v of (d('kev')?.items ?? []).slice(0, 10)) {
    const key = `${v.vendor} ${v.product}`;
    if (!kevGroups.has(key)) kevGroups.set(key, []);
    kevGroups.get(key).push(v);
  }
  for (const [product, vs] of kevGroups) {
    const lead = vs[0];
    const ransom = vs.some((v) => v.ransomware);
    const epss = Math.max(...vs.map((v) => v.epss ?? 0));
    push({
      kind: 'kev', ts: t(lead.dateAdded), panel: 'kev',
      title: vs.length > 1
        ? `${vs.length} new exploited vulnerabilities in ${product}`
        : `${lead.cve} — ${product}`,
      why: `${vs.length > 1 ? vs.map((v) => v.cve).join(', ') + ' · ' : ''}`
        + `Being exploited in the wild${ransom ? ' · used in ransomware' : ''}`
        + `${epss > 0 ? ` · ${(epss * 100).toFixed(0)}% exploit probability` : ''}`,
      sev: ransom ? 'crit' : 'warn',
    });
  }

  // ── breaches ──
  for (const b of (d('breaches')?.recent ?? []).slice(0, 6)) {
    push({
      kind: 'breach', ts: t(b.added), panel: 'breaches',
      title: `${b.title} — ${(b.count / 1e6).toFixed(1)}M accounts`,
      why: `Breach loaded · ${b.classes.slice(0, 3).join(', ')}`,
      sev: b.count > 1e7 ? 'crit' : 'warn',
    });
  }

  // ── world & tech: what a morning read is actually made of ──
  for (const n of (d('world')?.press ?? []).slice(0, 45)) {
    push({
      kind: 'world', ts: n.ts, panel: 'world', href: n.link,
      title: n.title, why: n.summary || n.source, source: n.source, sev: 'info',
    });
  }
  for (const h of (d('world')?.hn ?? []).slice(0, 10)) {
    push({
      kind: 'hn', ts: h.ts, panel: 'world', href: h.link,
      title: h.title, why: `${h.score} points · ${h.descendants} comments on Hacker News`,
      sev: 'info',
    });
  }

  // ── the security news itself ──
  for (const n of (d('news')?.items ?? []).slice(0, 40)) {
    push({
      kind: 'news', ts: n.ts, panel: 'news', href: n.link,
      title: n.title, why: n.summary || n.source, source: n.source, sev: 'info',
    });
  }

  // ── ransomware: summarise rather than list 60 victims ──
  const rw = d('ransomware');
  if (rw?.victims?.length) {
    const v = rw.victims[0];
    push({
      kind: 'ransomware', ts: t(v.discovered), panel: 'ransomware',
      title: `${rw.last24h} organisations named on leak sites in 24h`,
      why: `Most recent: ${v.victim} (${v.group.toUpperCase()}) · top gang ${rw.topGroups[0]?.k.toUpperCase() ?? '—'}`,
      sev: 'warn',
    });
  }

  // ── notable quakes ──
  for (const q of (d('quakes')?.events ?? []).filter((x) => x.mag >= 5.5).slice(0, 3)) {
    push({
      kind: 'quake', ts: q.time, panel: 'quakes',
      title: `M${q.mag.toFixed(1)} — ${q.place}`,
      why: `Depth ${Math.round(q.depth)} km${q.tsunami ? ' · tsunami flag raised' : ''}`,
      sev: q.mag >= 6.5 ? 'warn' : 'info', href: q.url,
    });
  }

  // ── what the world started building this week ──
  for (const r of (d('github')?.repos ?? []).slice(0, 5)) {
    push({
      kind: 'repo', ts: t(r.created), panel: 'github', href: r.url,
      title: `${r.name} — ${r.stars.toLocaleString()} stars`,
      why: r.desc || `${r.lang ?? 'Unknown'} · ${r.velocity} stars/day`,
      sev: 'info',
    });
  }

  // ── space weather, only when it matters ──
  const sp = d('space');
  if (sp?.kp >= 4 && sp.kpSeries?.length) {
    push({
      kind: 'space', ts: t(sp.kpSeries.at(-1).t), panel: 'space',
      title: `Geomagnetic activity ${sp.kpImpact} — Kp ${sp.kp.toFixed(1)}`,
      why: 'HF propagation and satellite operations degraded',
      sev: sp.kp >= 6 ? 'warn' : 'info',
    });
  }

  // Only editorial items can duplicate; sensor events are already unique.
  const reported = dedupe(items.filter((i) => i.kind === 'world' || i.kind === 'news'));
  const rest = items.filter((i) => i.kind !== 'world' && i.kind !== 'news');
  items = [...reported, ...rest];

  const now = Date.now();
  for (const it of items) {
    const ageH = Math.max(0, (now - it.ts) / HOUR);
    // Recency decays over roughly three days; importance sets the floor.
    it.score = (WEIGHT[it.kind] ?? 20) * Math.exp(-ageH / 40);
    it.isNew = sinceTs ? it.ts > sinceTs : false;
  }

  // Ranking by score alone hands the top of the page to whichever feed
  // publishes most often -- BBC posts hourly, so it buries everything else.
  // Bucket by theme, sort inside each, then round-robin so the first screen
  // always mixes world, security and operational events.
  const GROUP = {
    world: 'world', hn: 'world',
    news: 'security', kev: 'security', breach: 'security', ransomware: 'security',
    outage: 'ops', hijack: 'ops', space: 'ops', quake: 'ops',
    repo: 'build', cert: 'build',
  };
  const buckets = { ops: [], world: [], security: [], build: [] };
  for (const it of items) (buckets[GROUP[it.kind] ?? 'build']).push(it);
  for (const k of Object.keys(buckets)) buckets[k].sort((a, b) => b.score - a.score);

  const ranked = [];
  const used = {};
  const take = (bucket) => {
    const list = buckets[bucket];
    while (list.length) {
      const it = list.shift();
      const cap = { world: 5, news: 5, hn: 3, repo: 2, hijack: 2, kev: 3, breach: 3, outage: 3 }[it.kind] ?? 2;
      used[it.kind] = (used[it.kind] ?? 0) + 1;
      if (used[it.kind] <= cap) { ranked.push(it); return true; }
    }
    return false;
  };

  // Anything genuinely critical leads, regardless of theme.
  const crit = items.filter((i) => i.sev === 'crit').sort((a, b) => b.score - a.score).slice(0, 2);
  for (const c of crit) {
    ranked.push(c);
    used[c.kind] = (used[c.kind] ?? 0) + 1;
    for (const k of Object.keys(buckets)) {
      const i = buckets[k].indexOf(c);
      if (i !== -1) buckets[k].splice(i, 1);
    }
  }

  // Rotation order sets the texture of the first screen.
  const order = ['world', 'security', 'ops', 'security', 'world', 'build'];
  let guard = 0;
  while (ranked.length < 26 && guard++ < 400) {
    let progressed = false;
    for (const g of order) if (take(g)) progressed = true;
    if (!progressed) break;
  }

  // Selection stays weighted (importance, recency decay, per-kind caps so one
  // busy feed cannot own the page) but DISPLAY order is strictly chronological:
  // newest at the top, oldest at the bottom.
  ranked.sort((a, b) => b.ts - a.ts);

  return {
    items: ranked.slice(0, 26),
    newCount: items.filter((i) => i.isNew).length,
    headline: headline(data),
  };
}

function headline(data) {
  const d = (id) => data[id]?.data;
  const out = [];
  const o = d('outages'); const kev = d('kev'); const rw = d('ransomware');
  const br = d('breaches'); const hp = d('honeypot'); const root = d('rootdns');

  if (root) out.push({ n: `${root.reachable}/${root.total}`, l: 'ROOT DNS UP', tone: root.reachable === root.total ? 'green' : 'red' });
  if (o) out.push({ n: String(o.ongoing), l: 'OUTAGES NOW', tone: o.ongoing ? 'amber' : '', metric: 'outages' });
  if (kev) out.push({ n: String(kev.addedLast30d), l: 'NEW KEV / 30D', tone: 'amber', metric: 'kev' });
  if (rw) out.push({ n: String(rw.last24h), l: 'RANSOM VICTIMS / 24H', tone: rw.last24h > 25 ? 'red' : '', metric: 'ransomware' });
  if (br) out.push({ n: (br.totalAccounts / 1e9).toFixed(1) + 'B', l: 'ACCOUNTS PWNED', metric: 'pwned' });
  if (hp) out.push({ n: (hp.totals.records / 1e6).toFixed(1) + 'M', l: 'ATTACKS / DAY', metric: 'attacks' });
  return out;
}

/** Where an item came from, which is a real editorial distinction:
 *  REPORTED — a human wrote it and a newsroom published it. You read these.
 *  DETECTED — our own sensors and correlation found it. Nobody wrote it up. */
export const ORIGIN = {
  world: 'reported', news: 'reported', hn: 'reported', repo: 'reported',
  outage: 'detected', hijack: 'detected', kev: 'detected', breach: 'detected',
  ransomware: 'detected', quake: 'detected', space: 'detected', cert: 'detected',
};

export const KIND_LABEL = {
  outage: 'OUTAGE', hijack: 'BGP', kev: 'EXPLOITED', breach: 'BREACH',
  news: 'SECURITY', world: 'WORLD', hn: 'HN', ransomware: 'RANSOMWARE',
  quake: 'SEISMIC', repo: 'GITHUB', space: 'SPACE', cert: 'CERT',
};
