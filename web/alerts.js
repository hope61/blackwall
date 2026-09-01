// Derive the handful of things that actually warrant attention from 22 panels
// of data. Without this you have to scan the whole board to find out whether
// anything changed — which is the real failure mode of a dashboard this dense.

const A = (sev, panel, text) => ({ sev, panel, text });

export function deriveAlerts(data) {
  const out = [];
  const d = (id) => data[id]?.data;

  // Upstreams that are themselves broken come first — a blind panel outranks
  // whatever the other panels are reporting.
  const broken = Object.entries(data).filter(([, p]) => p.state === 'FAULT');
  if (broken.length) {
    out.push(A('warn', broken[0][0],
      `${broken.length} SOURCE${broken.length > 1 ? 'S' : ''} FAULTED`));
  }

  const hp = d('honeypot');
  if (hp?.infocon && hp.infocon !== 'green') {
    out.push(A('crit', 'honeypot', `INFOCON ${hp.infocon.toUpperCase()}`));
  }

  const root = d('rootdns');
  if (root && root.reachable < root.total) {
    out.push(A('crit', 'rootdns',
      `${root.total - root.reachable}/${root.total} ROOT NAMESERVERS UNREACHABLE`));
  }

  const out_ = d('outages');
  if (out_?.ongoing > 0) {
    const first = out_.events.find((e) => e.ongoing);
    out.push(A('crit', 'outages',
      `${out_.ongoing} ONGOING OUTAGE${out_.ongoing > 1 ? 'S' : ''}${first?.cc ? ' · ' + first.cc + ' ' + first.cause : ''}`));
  } else if (out_?.events?.length) {
    const e = out_.events[0];
    out.push(A('info', 'outages', `LAST OUTAGE ${e.cc ?? ''} ${e.cause}`));
  }

  const bgp = d('bgp');
  if (bgp?.highConfidence > 0) {
    const h = bgp.hijacks[0];
    out.push(A('warn', 'bgp',
      `${bgp.highConfidence} HIGH-CONFIDENCE HIJACKS${h ? ' · ' + h.prefix : ''}`));
  }

  const cf = d('cloudflare');
  if (cf && cf.indicator !== 'none') {
    out.push(A(cf.indicator === 'critical' || cf.indicator === 'major' ? 'crit' : 'warn',
      'cloudflare', `CLOUDFLARE: ${cf.description.toUpperCase()}`));
  }

  const kev = d('kev');
  const fresh = kev?.items?.filter((v) => v.ageDays <= 2) ?? [];
  if (fresh.length) {
    out.push(A('warn', 'kev', `${fresh.length} NEW KEV · ${fresh[0].cve}`));
  }

  const rw = d('ransomware');
  if (rw?.last24h > 25) {
    out.push(A('warn', 'ransomware', `${rw.last24h} RANSOMWARE VICTIMS IN 24H`));
  }

  const sp = d('space');
  if (sp?.kp >= 5) {
    out.push(A('warn', 'space', `GEOMAGNETIC ${sp.kpImpact} · KP ${sp.kp.toFixed(1)}`));
  }

  const q = d('quakes');
  if (q?.strongest && q.strongest.mag >= 6.5) {
    out.push(A('warn', 'quakes', `M${q.strongest.mag.toFixed(1)} · ${q.strongest.place}`));
  }

  if (!out.length) out.push(A('ok', null, 'ALL MONITORED SYSTEMS NOMINAL'));
  return out;
}
