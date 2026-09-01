import { getJSON } from '../fetchers.js';

export default {
  id: 'cloudflare',
  label: 'CLOUDFLARE EDGE',
  ttl: 120,
  async fetch() {
    const j = await getJSON('https://www.cloudflarestatus.com/api/v2/summary.json');

    const comps = (j.components ?? []).filter((c) => !c.group);
    const degraded = comps.filter((c) => c.status !== 'operational');

    return {
      indicator: j.status?.indicator ?? 'none',      // none|minor|major|critical
      description: j.status?.description ?? 'UNKNOWN',
      total: comps.length,
      operational: comps.length - degraded.length,
      degraded: degraded.map((c) => ({ name: c.name, status: c.status })).slice(0, 24),
      incidents: (j.incidents ?? []).slice(0, 6).map((i) => ({
        name: i.name,
        status: i.status,
        impact: i.impact,
        updated: i.updated_at,
        body: i.incident_updates?.[0]?.body?.slice(0, 200) ?? '',
      })),
      maintenance: (j.scheduled_maintenances ?? []).slice(0, 4).map((m) => ({
        name: m.name, status: m.status, scheduled_for: m.scheduled_for,
      })),
    };
  },
};
