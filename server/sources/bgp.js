import { getJSON, settle } from '../fetchers.js';

const CF = 'https://api.cloudflare.com/client/v4/radar';

// RIPE RIS Live would give a raw stream, but it needs a websocket client
// dependency. Radar already correlates and scores hijacks for us.
export default {
  id: 'bgp',
  label: 'BGP ANOMALIES',
  ttl: 900,
  span: 2,
  async fetch({ env, has }) {
    if (!has('CF_RADAR_TOKEN')) {
      return { available: false, note: 'CF_RADAR_TOKEN absent — BGP anomaly detection unavailable' };
    }
    const headers = { Authorization: `Bearer ${env.CF_RADAR_TOKEN.trim()}` };

    const r = await settle({
      hijacks: getJSON(`${CF}/bgp/hijacks/events?perPage=30&dateRange=7d`, { headers, timeout: 20000 }),
      leaks:   getJSON(`${CF}/bgp/leaks/events?perPage=20&dateRange=7d`, { headers, timeout: 20000 }),
    });

    // asn_info is an index-keyed map of ASN -> org; flatten it to a lookup so
    // the UI can print "AS8190 Comcast" instead of a bare number.
    const orgs = new Map();
    for (const src of [r.hijacks, r.leaks]) {
      for (const v of Object.values(src?.result?.asn_info ?? {})) {
        if (v?.asn) orgs.set(v.asn, { name: v.org_name, cc: v.country_code });
      }
    }
    const org = (asn) => (asn == null ? null : (orgs.get(asn)?.name ?? null));

    const hijacks = (r.hijacks?.result?.events ?? []).map((e) => ({
      id: e.id,
      prefixes: e.prefixes ?? [],
      prefix: e.prefixes?.[0] ?? null,
      hijackerAsn: e.hijacker_asn ?? null,
      hijackerName: org(e.hijacker_asn),
      hijackerCc: e.hijacker_country ?? null,
      victimAsns: e.victim_asns ?? [],
      victimAsn: e.victim_asns?.[0] ?? null,
      victimName: org(e.victim_asns?.[0]),
      victimCc: e.victim_countries?.[0] ?? null,
      confidence: e.confidence_score ?? 0,
      duration: e.duration ?? null,
      messages: e.hijack_msgs_count ?? 0,
      peers: e.peer_ip_count ?? 0,
      start: e.min_hijack_ts ? `${e.min_hijack_ts}Z` : null,
      end: e.max_hijack_ts ? `${e.max_hijack_ts}Z` : null,
      ongoing: !e.is_stale,
      // Only the positive-scoring signals are worth showing.
      tags: (e.tags ?? []).filter((t) => t.score > 0).map((t) => t.name),
    })).filter((e) => e.prefix)
      .sort((a, b) => (b.confidence - a.confidence) || Date.parse(b.start ?? 0) - Date.parse(a.start ?? 0));

    const leaks = (r.leaks?.result?.events ?? []).map((e) => ({
      id: e.id,
      leakerAsn: e.leak_asn ?? null,
      leakerName: org(e.leak_asn),
      countries: e.countries ?? [],
      path: e.leak_seg ?? [],
      prefixes: e.prefix_count ?? 0,
      routes: e.leak_count ?? 0,
      peers: e.peer_count ?? 0,
      start: e.min_ts ? `${e.min_ts}Z` : null,
      end: e.max_ts ? `${e.max_ts}Z` : null,
      ongoing: e.finished === false,
    })).sort((a, b) => b.routes - a.routes);

    return {
      available: true,
      hijacks,
      leaks,
      ongoingHijacks: hijacks.filter((h) => h.ongoing).length,
      ongoingLeaks: leaks.filter((l) => l.ongoing).length,
      // Radar scores 0-10; >=3 is where the signals stop being noise.
      highConfidence: hijacks.filter((h) => h.confidence >= 3).length,
      window: '7d',
    };
  },
};
