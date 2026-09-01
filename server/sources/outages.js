import { getJSON, settle } from '../fetchers.js';

const CF = 'https://api.cloudflare.com/client/v4/radar';

const causeLabel = {
  GOVERNMENT_DIRECTED: 'STATE DIRECTED',
  POWER_OUTAGE: 'POWER LOSS',
  CABLE_CUT: 'CABLE CUT',
  MILITARY_ACTION: 'MILITARY ACTION',
  NATURAL_DISASTER: 'NATURAL DISASTER',
  TECHNICAL_PROBLEM: 'TECHNICAL',
  CYBERATTACK: 'CYBERATTACK',
  UNKNOWN: 'UNATTRIBUTED',
};

export default {
  id: 'outages',
  label: 'INTERNET OUTAGES',
  ttl: 600,
  span: 2,
  async fetch({ env, has }) {
    if (!has('CF_RADAR_TOKEN')) {
      return { upgraded: false, events: [], note: 'CF_RADAR_TOKEN absent — national outage detection unavailable' };
    }
    const headers = { Authorization: `Bearer ${env.CF_RADAR_TOKEN.trim()}` };

    const { ann } = await settle({
      ann: getJSON(`${CF}/annotations/outages?dateRange=28d&limit=40`, { headers }),
    });

    const events = (ann?.result?.annotations ?? []).map((a) => {
      const locs = (a.locationsDetails ?? []).map((l) => ({ cc: l.code, name: l.name }));
      return {
        id: a.id,
        description: a.description || 'UNDESCRIBED EVENT',
        cause: causeLabel[a.outage?.outageCause] ?? (a.outage?.outageCause ?? 'UNATTRIBUTED'),
        scope: a.outage?.outageType ?? null,
        start: a.startDate,
        end: a.endDate,
        ongoing: !a.endDate,
        locations: locs,
        cc: locs[0]?.cc ?? (a.locations?.[0] ?? null),
        asns: (a.asnsDetails ?? []).slice(0, 8).map((x) => ({ asn: Number(x.asn), name: x.name })),
        asnCount: (a.asns ?? []).length,
        link: a.linkedUrl ?? null,
      };
    }).sort((x, y) => Date.parse(y.start) - Date.parse(x.start));

    const byCause = {};
    for (const e of events) byCause[e.cause] = (byCause[e.cause] ?? 0) + 1;

    return {
      upgraded: true,
      events,
      ongoing: events.filter((e) => e.ongoing).length,
      window: '28d',
      byCause,
      geo: events.filter((e) => e.cc).map((e) => ({ cc: e.cc, cause: e.cause, ongoing: e.ongoing })),
    };
  },
};
