import { getJSON, settle } from '../fetchers.js';

const ISC = 'https://isc.sans.edu/api';
const opts = { headers: { Accept: 'application/json' } };
const day = (offset = 0) => new Date(Date.now() - offset * 86400e3).toISOString().slice(0, 10);

// ISC returns index-keyed objects ({"0":{...},"1":{...},date,limit}) for some
// endpoints and plain arrays for others. Normalise both to an array of rows.
const rows = (x) => {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    return Object.entries(x)
      .filter(([k]) => /^\d+$/.test(k))
      .sort((a, b) => +a[0] - +b[0])
      .map(([, v]) => v);
  }
  return [];
};

export default {
  id: 'honeypot',
  label: 'HONEYPOT ATTACKS',
  ttl: 600,
  span: 2,
  async fetch() {
    // The current UTC day is always partial — port rankings only settle
    // for completed days, so rank on yesterday and report today separately.
    const settled = day(1);

    const r = await settle({
      ports:   getJSON(`${ISC}/topports/records/12/${settled}?json`, opts),
      sources: getJSON(`${ISC}/sources/attacks/20/${settled}?json`, opts),
      infocon: getJSON(`${ISC}/infocon?json`, opts),
      summary: getJSON(`${ISC}/dailysummary/${day(14)}/${day(0)}?json`, opts),
    });

    const ports = rows(r.ports).map((p) => ({
      port: Number(p.targetport ?? 0),
      rank: Number(p.rank ?? 0),
      records: Number(p.records ?? 0),
      targets: Number(p.targets ?? 0),
      sources: Number(p.sources ?? 0),
    })).filter((p) => p.port);

    const sources = rows(r.sources).map((s) => ({
      ip: s.ip ?? '',
      attacks: Number(s.attacks ?? 0),   // distinct targets hit
      records: Number(s.count ?? 0),     // total packets logged
      firstSeen: s.firstseen ?? null,
      lastSeen: s.lastseen ?? null,
    })).filter((s) => s.ip);

    // Trend series for the bar-field component; last entry is today (partial).
    const series = rows(r.summary).map((d) => ({
      date: d.date,
      records: Number(d.records ?? 0),
      sources: Number(d.sources ?? 0),
      targets: Number(d.targets ?? 0),
    }));
    const complete = series.filter((d) => d.date !== day(0));
    const latest = complete.at(-1) ?? null;

    return {
      infocon: r.infocon?.status ?? 'unknown',
      settledDate: settled,
      ports,
      sources,
      series,
      totals: latest
        ? { records: latest.records, sources: latest.sources, targets: latest.targets }
        : { records: 0, sources: 0, targets: 0 },
      today: series.find((d) => d.date === day(0)) ?? null,
    };
  },
};
