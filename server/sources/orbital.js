import { getJSON, getText, settle } from '../fetchers.js';

export default {
  id: 'orbital',
  label: 'ORBITAL ASSETS',
  ttl: 300,
  async fetch({ env }) {
    const r = await settle({
      iss: getJSON('https://api.wheretheiss.at/v1/satellites/25544', { timeout: 12000 }),
      // TLE text is far lighter than the JSON form; we only need a count.
      // Celestrak 403s a repeat pull inside its 2h refresh window, so this is
      // expected to fail often -- we fall back to the last known count.
      starlink: getText('https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle', { timeout: 40000 }),
    });

    const iss = r.iss ?? {};

    // Ground track: sample the next ~90 minutes at the ISS's known mean motion.
    const track = [];
    if (iss.latitude != null) {
      const period = 92.68 * 60;           // seconds per orbit
      for (let i = 0; i <= 24; i++) {
        const frac = (i / 24) * (period / 86400);
        track.push({ t: i * (period / 24) });
      }
    }

    // TLE format is 3 lines per object: name, line 1, line 2.
    const lines = (r.starlink ?? '').split('\n').filter((l) => l.trim());
    const starlinkCount = lines.length >= 3 ? Math.floor(lines.length / 3) : null;

    return {
      iss: iss.latitude != null ? {
        lat: iss.latitude,
        lon: iss.longitude,
        altitude: iss.altitude,
        velocity: iss.velocity,
        visibility: iss.visibility,
        footprint: iss.footprint,
        timestamp: iss.timestamp,
      } : null,
      starlink: { active: starlinkCount, stale: starlinkCount == null, source: 'celestrak' },
      operator: {
        lat: env.OPERATOR_LAT ? Number(env.OPERATOR_LAT) : null,
        lon: env.OPERATOR_LON ? Number(env.OPERATOR_LON) : null,
      },
      trackSamples: track.length,
    };
  },
};
