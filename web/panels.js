// One renderer per source id. Each returns { body, foot }.
// The renderer never fetches — it is handed already-normalised data.
import {
  el, rows, meter, meterRow, field, figure, figGrid, statusDot,
  list, chips, stack, msg, num, compact, bytes, ago, esc,
} from './ui.js';

const pct = (n, d = 1) => (n == null ? '—' : Number(n).toFixed(d) + '%');
const cc = (c) => (c ?? '??').toUpperCase();

// Flag emoji from an ISO-3166 alpha-2 code.
const flag = (c) => (!c || c.length !== 2 ? '' :
  String.fromCodePoint(...[...c.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)));

export const renderers = {

  /* ───────────────────────────── THREAT ──────────────────────────────── */

  outages: (d) => {
    if (!d.upgraded) return { body: msg(d.note ?? 'NO TOKEN'), foot: 'CLOUDFLARE RADAR CREDENTIAL REQUIRED' };
    const causeTone = (c) => (c === 'STATE DIRECTED' ? 'bad' : c === 'CABLE CUT' ? 'warn' : '');
    return {
      body: stack([
        figGrid([
          { n: num(d.events.length), l: 'EVENTS / 28D' },
          { n: num(d.ongoing), l: 'ONGOING', cls: d.ongoing ? 'amber' : '' },
          { n: num(Object.keys(d.byCause).length), l: 'CAUSES' },
        ]),
        list(d.events.slice(0, 12).map((e) => ({
          when: ago(e.start),
          title: `${flag(e.cc)} ${e.locations.map((l) => l.name).join(', ') || cc(e.cc)} — ${e.description}`,
          sub: `${e.asnCount} ASN${e.asnCount === 1 ? '' : 'S'} · ${e.scope ?? 'SCOPE UNKNOWN'}${e.asns.length ? ' · ' + e.asns.slice(0, 3).map((a) => a.name).join(', ') : ''}`,
          tag: e.cause, tagCls: causeTone(e.cause),
        })), { maxHeight: 210 }),
      ]),
      foot: `CLOUDFLARE RADAR · ${d.window} WINDOW · NATIONAL SCOPE TRAFFIC ANOMALIES`,
    };
  },

  bgp: (d) => {
    if (!d.available) return { body: msg(d.note ?? 'NO TOKEN'), foot: 'CLOUDFLARE RADAR CREDENTIAL REQUIRED' };
    return {
      body: stack([
        figGrid([
          { n: num(d.hijacks.length), l: 'HIJACKS' },
          { n: num(d.highConfidence), l: 'HIGH CONF', cls: d.highConfidence ? 'amber' : '' },
          { n: num(d.leaks.length), l: 'ROUTE LEAKS' },
        ]),
        list(d.hijacks.slice(0, 10).map((h) => ({
          when: ago(h.start),
          title: `${h.prefix} ← AS${h.hijackerAsn} ${h.hijackerName ?? ''}`,
          sub: `VICTIM AS${h.victimAsn} ${h.victimName ?? ''} ${flag(h.victimCc)} · ${h.peers} PEERS · ${h.tags.slice(0, 2).join(' ')}`,
          tag: `C${h.confidence}`, tagCls: h.confidence >= 5 ? 'bad' : h.confidence >= 3 ? 'hot' : '',
        })), { maxHeight: 200 }),
      ]),
      foot: `BGP ORIGIN HIJACKS + ROUTE LEAKS · ${d.window} · RPKI/IRR CORRELATED`,
    };
  },

  ransomware: (d) => ({
    body: stack([
      figGrid([
        { n: num(d.last24h), l: 'VICTIMS / 24H', cls: d.last24h > 20 ? 'amber' : '' },
        { n: num(d.last7d), l: 'VICTIMS / 7D' },
        { n: num(d.topGroups.length), l: 'ACTIVE GANGS' },
      ]),
      chips(d.topGroups.slice(0, 8).map((g) => ({ tone: 'bad', k: g.k.toUpperCase(), v: g.n }))),
      list(d.victims.slice(0, 12).map((v) => ({
        when: ago(v.discovered),
        title: v.victim,
        sub: `${v.group.toUpperCase()}${v.country ? ' · ' + flag(v.country) + ' ' + cc(v.country) : ''}${v.sector ? ' · ' + v.sector : ''}`,
        tag: 'LEAK', tagCls: 'bad',
      })), { maxHeight: 190 }),
    ]),
    foot: 'RANSOMWARE.LIVE · LEAK-SITE DISCLOSURES · VICTIM NAMES AS PUBLISHED BY THREAT ACTORS',
  }),

  kev: (d) => ({
    body: stack([
      figGrid([
        { n: num(d.total), l: 'KEV CATALOG' },
        { n: num(d.addedLast30d), l: 'ADDED / 30D', cls: 'amber' },
        { n: num(d.ransomwareLinked), l: 'RANSOMWARE', cls: 'red' },
      ]),
      stack(d.items.slice(0, 7).map((v) =>
        meterRow(v.cve, (v.epss ?? 0) * 100,
          v.epss != null ? (v.epss * 100).toFixed(1) + '%' : '—',
          { tone: v.ransomware ? 'bad' : (v.epss ?? 0) > 0.1 ? 'warn' : '' })), 4),
      list(d.items.slice(0, 6).map((v) => ({
        when: ago(v.dateAdded),
        title: `${v.vendor} ${v.product}`,
        sub: v.name,
        tag: v.ransomware ? 'RANSOM' : v.cve.split('-')[1],
        tagCls: v.ransomware ? 'bad' : '',
      })), { maxHeight: 150 }),
    ]),
    foot: 'CISA KEV × FIRST EPSS · METER SHOWS 30-DAY EXPLOITATION PROBABILITY',
  }),

  attacks: (d) => {
    if (!d.available) return { body: msg(d.note ?? 'NO TOKEN'), foot: 'CLOUDFLARE RADAR CREDENTIAL REQUIRED' };
    const mit = Object.entries(d.mitigation ?? {}).map(([k, v]) => [k, +v]).filter(([, v]) => v > 0.5);
    return {
      body: stack([
        field(d.series.map((x) => x.v), { tone: 'hi', cap: ['-7D', 'NOW'] }),
        el('div', 'field-cap', '<span>L7 ATTACK VOLUME</span><span></span>'),
        stack(mit.slice(0, 4).map(([k, v]) => meterRow(k.replace(/_/g, ' '), v, v.toFixed(1) + '%')), 4),
        rows([
          { k: 'TOP ORIGIN', v: d.origins.slice(0, 3).map((x) => `${flag(x.cc)}${x.cc} ${x.pct}%`).join('  ') },
          { k: 'TOP TARGET', v: d.targets.slice(0, 3).map((x) => `${flag(x.cc)}${x.cc} ${x.pct}%`).join('  ') },
        ]),
      ]),
      foot: `CLOUDFLARE LAYER 7 MITIGATION TELEMETRY · ${d.window} · PERCENTAGE OF MITIGATED REQUESTS`,
    };
  },

  malware: (d) => ({
    body: stack([
      figGrid([
        { n: num(d.total), l: 'C2 TRACKED' },
        { n: num(d.online), l: 'ONLINE', cls: d.online ? 'red' : '' },
      ]),
      d.families.length
        ? stack(d.families.slice(0, 5).map((f) => {
            const max = d.families[0].n || 1;
            return meterRow(f.k.toUpperCase(), (f.n / max) * 100, String(f.n), { tone: 'bad', ticks: 10 });
          }), 4)
        : msg('NO ACTIVE C2'),
      d.threatfox ? el('div', 'msg', `THREATFOX +${d.threatfox.count} IOC`) : null,
    ]),
    foot: d.upgraded
      ? 'ABUSE.CH FEODO + THREATFOX · LIVE COMMAND AND CONTROL INFRASTRUCTURE'
      : 'ABUSE.CH FEODO TRACKER · SET ABUSECH_AUTH_KEY TO ADD THREATFOX IOC FEED',
  }),

  apt: (d) => ({
    body: stack([
      figGrid([
        { n: num(d.total), l: 'TRACKED SETS' },
        { n: compact(d.totalTechniqueLinks), l: 'TTP LINKS' },
      ]),
      list(d.groups.slice(0, 9).map((g) => ({
        when: g.id,
        title: g.name,
        sub: g.aliases.slice(0, 3).join(' / ') || '—',
        tag: g.techniques + 'T',
      })), { maxHeight: 175 }),
    ]),
    foot: `MITRE ATT&CK ENTERPRISE V${d.version} · INTRUSION SETS RANKED BY ATTRIBUTED TECHNIQUES`,
  }),

  /* ───────────────────────────── NETWORK ─────────────────────────────── */

  rootdns: (d) => {
    const grid = el('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(13,1fr);gap:5px;margin-bottom:4px';
    for (const s of d.servers) {
      const c = el('div');
      c.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px';
      c.title = `${s.letter}.root-servers.net — ${s.operator} — ${s.ip} — ${s.rtt ?? '?'}ms`;
      const dot = el('span', `dot ${s.status === 'NOMINAL' ? 'ok' : s.status === 'DEGRADED' ? 'warn' : 'bad'}`);
      dot.style.cssText += 'width:9px;height:9px';
      c.appendChild(dot);
      c.appendChild(el('div', '', `<span style="font-size:9px;font-weight:700">${s.letter}</span>`));
      c.appendChild(el('div', '', `<span style="font-size:7px;color:var(--ink-3)">${s.rtt != null ? Math.round(s.rtt) : '—'}</span>`));
      grid.appendChild(c);
    }
    return {
      body: stack([
        grid,
        rows([
          { k: 'REACHABLE', v: `${d.reachable} / ${d.total}`, cls: d.reachable === d.total ? 'green' : 'red' },
          { k: 'MEDIAN RTT', v: d.medianRtt != null ? d.medianRtt + ' ms' : '—' },
          { k: 'FASTEST', v: d.fastest ? `${d.fastest.letter} · ${d.fastest.rtt} ms` : '—' },
        ]),
      ]),
      foot: 'MEASURED LOCALLY — UDP/53 NS QUERIES TO ALL 13 ROOT SERVER LETTERS, NOT A STATUS PAGE',
    };
  },

  cloudflare: (d) => {
    const tone = { none: 'ok', minor: 'warn', major: 'bad', critical: 'bad' }[d.indicator] ?? 'off';
    return {
      body: stack([
        el('div', '', `<div style="display:flex;align-items:center;gap:7px"><span class="dot ${tone}"></span><span style="font-size:12px;font-weight:500">${esc(d.description)}</span></div>`),
        meterRow('EDGE HEALTH', (d.operational / Math.max(1, d.total)) * 100,
          `${d.operational}/${d.total}`, { ticks: 20, tone: tone === 'ok' ? '' : 'warn' }),
        d.degraded.length
          ? list(d.degraded.slice(0, 8).map((c) => ({
              when: '', title: c.name, tag: c.status.replace(/_/g, ' ').toUpperCase(),
              tagCls: c.status === 'under_maintenance' ? '' : 'hot',
            })), { maxHeight: 130 })
          : msg('ALL POPS OPERATIONAL'),
        ...(d.incidents.length ? [list(d.incidents.map((i) => ({
          when: ago(i.updated), title: i.name, sub: i.body, tag: i.impact.toUpperCase(),
          tagCls: i.impact === 'critical' ? 'bad' : 'hot',
        })), { maxHeight: 110 })] : []),
      ]),
      foot: 'CLOUDFLARE SYSTEM STATUS · POINT-OF-PRESENCE LEVEL COMPONENT HEALTH',
    };
  },

  honeypot: (d) => {
    const max = d.ports[0]?.records || 1;
    return {
      body: stack([
        figGrid([
          { n: compact(d.totals.records), l: 'PACKETS / DAY' },
          { n: compact(d.totals.sources), l: 'SOURCES' },
          { n: num(d.totals.targets), l: 'SENSORS' },
        ]),
        field(d.series.map((s) => s.records), {
          tone: (v, i) => (i === d.series.length - 1 ? 'amber' : null),
          cap: ['-14D', 'TODAY (PARTIAL)'],
        }),
        stack(d.ports.slice(0, 6).map((p) =>
          meterRow(`PORT ${p.port}`, (p.records / max) * 100, compact(p.records), { ticks: 12 })), 4),
        chips(d.sources.slice(0, 6).map((s) => ({ tone: 'bad', k: s.ip, v: compact(s.attacks) }))),
      ]),
      foot: `SANS ISC DSHIELD · ${d.settledDate} SETTLED · GLOBAL DISTRIBUTED SENSOR NETWORK`,
    };
  },

  tor: (d) => {
    const max = d.countries[0]?.count || 1;
    return {
      body: stack([
        figGrid([
          { n: num(d.total), l: 'EXIT NODES' },
          { n: num(d.countryCount), l: 'COUNTRIES' },
          { n: bytes(d.bandwidth) + '/s', l: 'OBSERVED BW' },
        ]),
        stack(d.countries.slice(0, 6).map((c) =>
          meterRow(`${flag(c.cc)} ${c.name.slice(0, 14)}`, (c.count / max) * 100, String(c.count), { ticks: 12 })), 4),
      ]),
      foot: 'TOR PROJECT ONIONOO · RUNNING RELAYS CARRYING THE EXIT FLAG',
    };
  },

  ct: (d) => ({
    body: stack([
      rows([
        { k: 'LOG', v: d.log },
        { k: 'TREE SIZE', v: num(d.treeSize) },
        { k: 'SAMPLED', v: `${d.sampled} LEAVES` },
      ]),
      list(d.certs.slice(0, 9).map((c) => ({
        when: c.precert ? 'PRE' : 'CRT',
        title: c.cn,
        sub: c.names.length > 1 ? `+${c.names.length - 1} SAN` : '',
      })), { maxHeight: 165 }),
    ]),
    foot: 'CT LOG TAILED DIRECTLY · MERKLE LEAVES DECODED SERVER-SIDE · EVERY TLS CERT ON EARTH',
  }),

  cables: (d) => ({
    body: stack([
      figGrid([
        { n: num(d.cableCount), l: 'CABLE SYSTEMS' },
        { n: num(d.landingCount), l: 'LANDING POINTS' },
      ]),
      stack(d.byCountry.slice(0, 6).map((c) => {
        const max = d.byCountry[0].n || 1;
        return meterRow(c.k.slice(0, 16), (c.n / max) * 100, String(c.n), { ticks: 12 });
      }), 4),
    ]),
    foot: 'TELEGEOGRAPHY SUBMARINE CABLE MAP · THE PHYSICAL LAYER OF THE INTERNET',
  }),

  ipv6: (d) => {
    if (!d.available) return { body: msg(d.note ?? 'NO TOKEN'), foot: 'CLOUDFLARE RADAR CREDENTIAL REQUIRED' };
    return {
      body: stack([
        figure(pct(d.global), 'IPV6 OF ALL REQUESTS'),
        meter(d.global ?? 0, { ticks: 26, tone: 'warn' }),
        field(d.series.map((s) => s.pct), { tone: 'hi', cap: ['-28D', 'NOW'] }),
        stack(d.countries.slice(0, 4).map((c) =>
          meterRow(`${flag(c.cc)} ${c.cc}`, c.pct, c.pct + '%', { ticks: 12 })), 4),
      ]),
      foot: 'CLOUDFLARE RADAR · CLIENT-OBSERVED IP VERSION SHARE, NOT ALLOCATION COUNTS',
    };
  },

  egress: (d) => ({
    body: stack([
      rows([
        { k: 'PUBLIC IP', v: d.ip ?? '—' },
        { k: 'LOCATION', v: `${flag(d.cc)} ${[d.city, d.region].filter(Boolean).join(', ') || '—'}` },
        { k: 'AUTONOMOUS SYS', v: d.asn ? `AS${d.asn}` : '—', sub: d.asName ?? '' },
        { k: 'DNS RESOLVER', v: d.resolver?.ip ?? '—', sub: d.resolver?.cc ?? '' },
        { k: 'REVERSE DNS', v: d.hostname ?? '—' },
        { k: 'HOSTING RANGE', v: d.privacy.hostingLikely ? 'LIKELY' : 'NO', cls: d.privacy.hostingLikely ? 'amber' : '' },
      ]),
    ]),
    foot: 'HOW THIS MACHINE APPEARS FROM OUTSIDE · RESOLVER PATH REVEALS VPN AND DOH SPLIT',
  }),

  /* ──────────────────────────── INTELLIGENCE ─────────────────────────── */

  news: (d) => ({
    body: stack([
      chips(d.feeds.map((f) => ({ tone: f.ok ? 'ok' : 'bad', k: f.name, v: f.count }))),
      list(d.items.slice(0, 14).map((i) => ({
        when: ago(i.ts), title: i.title, sub: i.source, href: i.link,
      })), { maxHeight: 250 }),
    ]),
    foot: 'CISA ADVISORIES · KREBSONSECURITY · BLEEPINGCOMPUTER · THE HACKER NEWS',
  }),

  world: (d) => ({
    body: stack([
      chips(d.feeds.map((f) => ({ tone: f.ok ? 'ok' : 'bad', k: f.name, v: f.count }))),
      list(d.press.slice(0, 7).map((i) => ({
        when: ago(i.ts), title: i.title, sub: i.source, href: i.link,
      })), { maxHeight: 150 }),
      el('div', 'field-cap', '<span>HACKER NEWS</span><span>POINTS</span>'),
      list(d.hn.slice(0, 7).map((i) => ({
        when: '▲' + i.score, title: i.title,
        sub: `${i.descendants} comments`, href: i.link,
      })), { maxHeight: 150 }),
    ]),
    foot: 'BBC WORLD · NYT WORLD · ARS TECHNICA · HACKER NEWS — THE NON-SECURITY HALF OF THE MORNING',
  }),

  breaches: (d) => ({
    body: stack([
      figure(compact(d.totalAccounts), 'ACCOUNTS COMPROMISED'),
      figGrid([
        { n: num(d.totalBreaches), l: 'KNOWN BREACHES' },
        { n: num(d.recent.length), l: 'RECENT LOADS' },
      ]),
      field(d.byYear.map((y) => y.n), {
        tone: 'hi',
        cap: [String(d.byYear[0]?.year ?? ''), String(d.byYear.at(-1)?.year ?? '')],
      }),
      list(d.recent.slice(0, 7).map((b) => ({
        when: ago(b.added),
        title: b.title,
        sub: b.classes.slice(0, 4).join(' · '),
        tag: compact(b.count),
        tagCls: b.count > 1e7 ? 'bad' : b.count > 1e6 ? 'hot' : '',
      })), { maxHeight: 165 }),
    ]),
    foot: 'HAVE I BEEN PWNED · AGGREGATE ACCOUNT COUNT ACROSS ALL CATALOGUED BREACHES',
  }),

  cve: (d) => {
    const b = d.buckets;
    return {
      body: stack([
        figGrid([
          { n: num(d.total), l: `PUBLISHED / ${d.windowDays}D` },
          { n: num(b.CRITICAL ?? 0), l: 'CRITICAL', cls: 'red' },
          { n: num(b.HIGH ?? 0), l: 'HIGH', cls: 'amber' },
        ]),
        field(d.histogram, {
          tone: (v, i) => (i >= 9 ? 'amber' : i >= 7 ? 'hi' : null),
          cap: ['CVSS 0', 'CVSS 10'],
        }),
        list(d.worst.slice(0, 7).map((v) => ({
          when: v.score.toFixed(1),
          title: v.cve,
          sub: v.desc,
          tag: v.severity,
          tagCls: v.severity === 'CRITICAL' ? 'bad' : v.severity === 'HIGH' ? 'hot' : '',
        })), { maxHeight: 165 }),
      ]),
      foot: 'NVD CVE API 2.0 · HISTOGRAM BINS ALL SCORED CVES BY CVSS BASE SCORE',
    };
  },

  github: (d) => ({
    body: stack([
      chips(d.topLangs.slice(0, 6).map((l) => ({ k: l.k, v: l.n }))),
      list(d.repos.slice(0, 11).map((r) => ({
        when: '★' + compact(r.stars),
        title: r.name,
        sub: r.desc || (r.topics.join(' · ') || '—'),
        tag: r.velocity + '/D',
        tagCls: r.velocity > 300 ? 'hot' : '',
        href: r.url,
      })), { maxHeight: 235 }),
    ]),
    foot: d.authenticated
      ? `GITHUB SEARCH API · REPOS CREATED IN LAST ${d.windowDays}D RANKED BY STAR VELOCITY`
      : `UNAUTHENTICATED — 60 REQ/HR · SET GITHUB_TOKEN TO RAISE THE LIMIT`,
  }),

  /* ───────────────────────────── AMBIENT ─────────────────────────────── */

  space: (d) => {
    const tone = d.kpImpact === 'SEVERE' || d.kpImpact === 'STORM' ? 'bad'
      : d.kpImpact === 'ACTIVE' ? 'warn' : '';
    return {
      body: stack([
        figure(d.kp != null ? d.kp.toFixed(2) : '—', `KP · ${d.kpImpact}`),
        meter(((d.kp ?? 0) / 9) * 100, { ticks: 18, tone }),
        field(d.kpSeries.map((k) => k.kp), {
          tone: (v) => (v >= 5 ? 'amber' : 'hi'),
          cap: ['-4D', 'NOW'],
        }),
        rows([
          { k: 'SOLAR WIND', v: d.solarWind ? d.solarWind.speed + ' km/s' : '—' },
          { k: 'BZ / BT', v: d.solarWind ? `${d.solarWind.bz} / ${d.solarWind.bt} nT` : '—' },
          { k: 'LAST FLARE', v: d.flare?.class ?? '—', sub: d.flare?.max ? ago(d.flare.max) + ' ago' : '' },
        ]),
      ]),
      foot: 'NOAA SWPC · GEOMAGNETIC ACTIVITY DEGRADES HF PROPAGATION AND SATELLITE OPERATIONS',
    };
  },

  orbital: (d) => ({
    body: stack([
      d.iss ? rows([
        { k: 'ISS POSITION', v: `${d.iss.lat.toFixed(2)}, ${d.iss.lon.toFixed(2)}` },
        { k: 'ALTITUDE', v: Math.round(d.iss.altitude) + ' km' },
        { k: 'VELOCITY', v: num(Math.round(d.iss.velocity)) + ' km/h' },
        { k: 'ILLUMINATION', v: (d.iss.visibility ?? '—').toUpperCase() },
        { k: 'FOOTPRINT', v: Math.round(d.iss.footprint ?? 0) + ' km' },
      ]) : msg('ISS TELEMETRY UNAVAILABLE'),
      rows([{
        k: 'STARLINK ACTIVE',
        v: d.starlink.active != null ? num(d.starlink.active) : 'RATE LIMITED',
        cls: d.starlink.stale ? 'dim' : '',
      }]),
    ]),
    foot: 'WHERETHEISS.AT + CELESTRAK · CELESTRAK THROTTLES REPEAT PULLS TO A 2-HOUR WINDOW',
  }),

  quakes: (d) => ({
    body: stack([
      figGrid([
        { n: num(d.count), l: `M${d.threshold}+ / ${d.window}` },
        { n: d.strongest ? d.strongest.mag.toFixed(1) : '—', l: 'STRONGEST', cls: (d.strongest?.mag ?? 0) >= 6 ? 'red' : '' },
        { n: num(d.tsunamiFlags), l: 'TSUNAMI FLAG', cls: d.tsunamiFlags ? 'red' : '' },
      ]),
      list(d.events.slice(0, 8).map((e) => ({
        when: ago(e.time),
        title: e.place,
        sub: `DEPTH ${Math.round(e.depth)} KM`,
        tag: 'M' + e.mag.toFixed(1),
        tagCls: e.mag >= 6 ? 'bad' : e.mag >= 5 ? 'hot' : '',
        href: e.url,
      })), { maxHeight: 175 }),
    ]),
    foot: 'USGS · COASTAL EVENTS CORRELATE WITH SUBMARINE CABLE FAULTS AT LANDING SITES',
  }),
};
