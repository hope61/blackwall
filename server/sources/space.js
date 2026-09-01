import { getJSON, settle } from '../fetchers.js';

const SWPC = 'https://services.swpc.noaa.gov';

// Kp drives HF propagation and satellite operations — the reason this belongs
// on a network board rather than in a weather app.
const kpImpact = (kp) =>
  kp == null || Number.isNaN(kp) ? 'UNKNOWN'
  : kp >= 7 ? 'SEVERE' : kp >= 5 ? 'STORM' : kp >= 4 ? 'ACTIVE' : 'QUIET';

export default {
  id: 'space',
  label: 'SPACE WEATHER',
  ttl: 900,
  async fetch() {
    const r = await settle({
      kp:     getJSON(`${SWPC}/products/noaa-planetary-k-index.json`),
      flare:  getJSON(`${SWPC}/json/goes/primary/xray-flares-latest.json`),
      alerts: getJSON(`${SWPC}/products/alerts.json`),
      speed:  getJSON(`${SWPC}/products/summary/solar-wind-speed.json`),
      mag:    getJSON(`${SWPC}/products/summary/solar-wind-mag-field.json`),
    });

    // This product is an array of objects (not SWPC's header-row format).
    const kpRows = Array.isArray(r.kp) ? r.kp : [];
    const kpSeries = kpRows.slice(-32)
      .map((x) => ({ t: x.time_tag, kp: Number(x.Kp) }))
      .filter((x) => Number.isFinite(x.kp));
    const kpNow = kpSeries.at(-1)?.kp ?? null;

    const flare = Array.isArray(r.flare) ? r.flare[0] : r.flare;
    const speed = Array.isArray(r.speed) ? r.speed[0] : null;
    const mag = Array.isArray(r.mag) ? r.mag[0] : null;

    return {
      kp: kpNow,
      kpImpact: kpImpact(kpNow),
      kpSeries,
      kpMax24h: kpSeries.length ? Math.max(...kpSeries.slice(-8).map((x) => x.kp)) : null,
      flare: flare ? {
        class: flare.max_class ?? null,
        begin: flare.begin_time ?? null,
        max: flare.max_time ?? null,
        end: flare.end_time ?? null,
      } : null,
      solarWind: speed ? {
        speed: speed.proton_speed,          // km/s
        bt: mag?.bt ?? null,                // total field, nT
        bz: mag?.bz_gsm ?? null,            // southward Bz drives coupling
        at: speed.time_tag,
      } : null,
      alerts: (Array.isArray(r.alerts) ? r.alerts : []).slice(0, 6).map((a) => ({
        issued: a.issue_datetime,
        message: (a.message ?? '').split('\n').filter(Boolean)[0]?.slice(0, 160) ?? '',
      })),
    };
  },
};
