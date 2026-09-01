// Heavy map geometry, served on demand.
//
// Cable routes are ~500KB — 70% of what /api/all used to weigh — for a map
// layer that is off by default. Keeping it out of the panel payload means the
// first paint no longer pays for it; the map fetches it when you pick the layer.
import { getJSON, settle } from './fetchers.js';
import { cached } from './cache.js';

const SCM = 'https://www.submarinecablemap.com/api/v3';
const r2 = (n) => Math.round(n * 100) / 100;

async function cableGeometry() {
  const r = await settle({
    geo:    getJSON(`${SCM}/cable/cable-geo.json`, { timeout: 40000 }),
    points: getJSON(`${SCM}/landing-point/landing-point-geo.json`, { timeout: 30000 }),
  });

  // Round to ~1km and drop consecutive duplicates: halves the payload with no
  // visible loss at the zoom levels this map supports.
  const routes = [];
  for (const f of (r.geo?.features ?? [])) {
    const g = f.geometry;
    if (!g) continue;
    const lines = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
    for (const line of lines) {
      const out = [];
      let prev = null;
      for (const pt of line) {
        const q = [r2(pt[0]), r2(pt[1])];
        if (!prev || q[0] !== prev[0] || q[1] !== prev[1]) { out.push(q); prev = q; }
      }
      if (out.length > 1) routes.push(out);
    }
  }

  const landings = (r.points?.features ?? []).map((f) => {
    const name = f.properties?.name ?? '';
    const comma = name.lastIndexOf(',');
    return {
      place: comma === -1 ? name : name.slice(0, comma).trim(),
      lon: r2(f.geometry?.coordinates?.[0] ?? 0),
      lat: r2(f.geometry?.coordinates?.[1] ?? 0),
    };
  }).filter((p) => p.lat || p.lon);

  return { routes, landings, routeCount: routes.length };
}

export const geoSets = {
  cables: { ttl: 604800, fetch: cableGeometry },
};

export async function getGeo(name) {
  const set = geoSets[name];
  if (!set) return null;
  return cached(`geo:${name}`, set.ttl, set.fetch);
}
