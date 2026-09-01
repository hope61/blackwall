import { getJSON, settle } from '../fetchers.js';

const CF = 'https://api.cloudflare.com/client/v4/radar';

// APNIC publishes this only as scraped HTML and Google's JSON endpoint is
// retired, so Cloudflare Radar is the source here. Requires the Radar token.
export default {
  id: 'ipv6',
  label: 'IPV6 ADOPTION',
  ttl: 43200,
  async fetch({ env, has }) {
    if (!has('CF_RADAR_TOKEN')) {
      return { available: false, note: 'CF_RADAR_TOKEN absent — IPv6 telemetry unavailable' };
    }
    const headers = { Authorization: `Bearer ${env.CF_RADAR_TOKEN.trim()}` };

    const r = await settle({
      summary: getJSON(`${CF}/http/summary/ip_version?dateRange=7d`, { headers }),
      top:     getJSON(`${CF}/http/top/locations/ip_version/IPv6?dateRange=7d&limit=30`, { headers }),
      series:  getJSON(`${CF}/http/timeseries_groups/ip_version?dateRange=28d&aggInterval=1d`, { headers }),
    });

    const s = r.summary?.result?.summary_0 ?? {};
    const rows = r.top?.result?.top_0 ?? [];
    const ser = r.series?.result?.serie_0 ?? {};

    return {
      available: true,
      global: s.IPv6 != null ? +Number(s.IPv6).toFixed(2) : null,
      ipv4: s.IPv4 != null ? +Number(s.IPv4).toFixed(2) : null,
      countries: rows.map((x) => ({
        cc: x.clientCountryAlpha2,
        name: x.clientCountryName,
        pct: +Number(x.value).toFixed(1),
      })),
      series: (ser.timestamps ?? []).map((t, i) => ({ t, pct: +Number(ser.IPv6?.[i] ?? 0).toFixed(2) })),
      geo: rows.map((x) => ({ cc: x.clientCountryAlpha2, pct: +Number(x.value).toFixed(1) })),
      window: '7d',
    };
  },
};
