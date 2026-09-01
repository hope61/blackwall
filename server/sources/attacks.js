import { getJSON, settle } from '../fetchers.js';

const CF = 'https://api.cloudflare.com/client/v4/radar';

export default {
  id: 'attacks',
  label: 'ATTACK TRAFFIC',
  ttl: 1800,
  span: 2,
  async fetch({ env, has }) {
    if (!has('CF_RADAR_TOKEN')) {
      return { available: false, note: 'CF_RADAR_TOKEN absent — attack telemetry unavailable' };
    }
    const headers = { Authorization: `Bearer ${env.CF_RADAR_TOKEN.trim()}` };

    const r = await settle({
      series:  getJSON(`${CF}/attacks/layer7/timeseries?dateRange=7d&aggInterval=1h`, { headers }),
      origin:  getJSON(`${CF}/attacks/layer7/top/locations/origin?dateRange=7d&limit=15`, { headers }),
      target:  getJSON(`${CF}/attacks/layer7/top/locations/target?dateRange=7d&limit=15`, { headers }),
      vector:  getJSON(`${CF}/attacks/layer7/summary/mitigation_product?dateRange=7d`, { headers }),
      l3:      getJSON(`${CF}/attacks/layer3/summary/protocol?dateRange=7d`, { headers }),
    });

    const s = r.series?.result?.serie_0 ?? {};
    const loc = (x) => (x?.result?.top_0 ?? []).map((v) => ({
      cc: v.originCountryAlpha2 ?? v.targetCountryAlpha2,
      name: v.originCountryName ?? v.targetCountryName,
      pct: +Number(v.value).toFixed(2),
      rank: v.rank ?? null,
    })).filter((v) => v.cc);

    return {
      available: true,
      series: (s.timestamps ?? []).map((t, i) => ({ t, v: Number(s.values?.[i] ?? 0) })),
      origins: loc(r.origin),
      targets: loc(r.target),
      mitigation: r.vector?.result?.summary_0 ?? null,
      l3Protocol: r.l3?.result?.summary_0 ?? null,
      window: '7d',
    };
  },
};
