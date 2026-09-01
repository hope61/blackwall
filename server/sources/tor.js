import { getJSON } from '../fetchers.js';

const ONIONOO = 'https://onionoo.torproject.org/details'
  + '?type=relay&running=true&flag=Exit&fields=nickname,country,country_name,or_addresses,observed_bandwidth,first_seen,as_name,as';

export default {
  id: 'tor',
  label: 'TOR EXIT NODES',
  ttl: 900,
  async fetch() {
    const j = await getJSON(ONIONOO, { timeout: 25000 });
    const relays = j.relays ?? [];

    const byCountry = new Map();
    let bandwidth = 0;
    for (const r of relays) {
      const cc = (r.country ?? '??').toUpperCase();
      const e = byCountry.get(cc) ?? { cc, name: r.country_name ?? cc, count: 0, bw: 0 };
      e.count++;
      e.bw += r.observed_bandwidth ?? 0;
      byCountry.set(cc, e);
      bandwidth += r.observed_bandwidth ?? 0;
    }

    const countries = [...byCountry.values()].sort((a, b) => b.count - a.count);

    // Newest exits are the interesting ones — sudden appearances matter.
    const newest = relays
      .filter((r) => r.first_seen)
      .sort((a, b) => Date.parse(b.first_seen) - Date.parse(a.first_seen))
      .slice(0, 12)
      .map((r) => ({
        nickname: r.nickname,
        cc: (r.country ?? '??').toUpperCase(),
        as: r.as_name ?? r.as ?? '',
        ip: (r.or_addresses?.[0] ?? '').replace(/:\d+$/, ''),
        firstSeen: r.first_seen,
        bw: r.observed_bandwidth ?? 0,
      }));

    return {
      total: relays.length,
      countries: countries.slice(0, 20),
      countryCount: countries.length,
      bandwidth,                       // bytes/sec observed, aggregate
      newest,
      // lat/lon-free; the map panel joins on country code
      geo: countries.map(({ cc, count, bw }) => ({ cc, count, bw })),
    };
  },
};
