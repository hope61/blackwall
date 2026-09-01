import { getJSON, settle } from '../fetchers.js';

const SCM = 'https://www.submarinecablemap.com/api/v3';

// The physical internet. Static reference data — long TTL, and the map panel
// draws the routes as hairlines under everything else.
export default {
  id: 'cables',
  label: 'SUBMARINE CABLES',
  ttl: 604800,
  async fetch() {
    const r = await settle({
      cables: getJSON(`${SCM}/cable/all.json`, { timeout: 30000 }),
      points: getJSON(`${SCM}/landing-point/landing-point-geo.json`, { timeout: 30000 }),

    });

    // The index endpoint carries only id and name -- length/RFS would cost one
    // request per cable, which is not worth 703 round trips for a map underlay.
    const cables = (r.cables ?? []).map((c) => ({ id: c.id, name: c.name }));

    // Landing points carry no country field, but the name is "City, Country".
    const points = (r.points?.features ?? []).map((f) => {
      const name = f.properties?.name ?? '';
      const comma = name.lastIndexOf(',');
      return {
        name,
        place: comma === -1 ? name : name.slice(0, comma).trim(),
        country: comma === -1 ? null : name.slice(comma + 1).trim(),
        lon: f.geometry?.coordinates?.[0] ?? null,
        lat: f.geometry?.coordinates?.[1] ?? null,
        tbd: !!f.properties?.is_tbd,
      };
    }).filter((p) => p.lat != null && p.lon != null);

    return {
      cableCount: cables.length,
      landingCount: points.length,
      // Landing density per country -- which coastlines actually carry traffic.
      byCountry: Object.entries(
        points.reduce((acc, p) => { if (p.country) acc[p.country] = (acc[p.country] ?? 0) + 1; return acc; }, {}),
      ).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => ({ k, n })),
    };
  },
};
