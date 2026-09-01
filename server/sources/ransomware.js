import { getJSON } from '../fetchers.js';

export default {
  id: 'ransomware',
  label: 'RANSOMWARE ACTIVITY',
  ttl: 900,
  span: 2,
  async fetch() {
    const v = await getJSON('https://api.ransomware.live/v2/recentvictims', { timeout: 25000 });
    const list = Array.isArray(v) ? v : (v.victims ?? []);

    const victims = list.map((x) => ({
      victim: x.victim ?? x.post_title ?? 'UNKNOWN',
      group: x.group ?? x.group_name ?? '?',
      country: x.country ?? null,
      sector: x.activity ?? null,
      discovered: x.discovered ?? x.published ?? null,
      published: x.published ?? null,
      url: x.url ?? x.website ?? null,
      claimUrl: x.post_url ?? null,
    })).sort((a, b) => Date.parse(b.discovered ?? 0) - Date.parse(a.discovered ?? 0));

    const now = Date.now();
    const within = (h) => victims.filter((x) => x.discovered && now - Date.parse(x.discovered) < h * 3600e3).length;

    const byGroup = {};
    const byCountry = {};
    for (const x of victims.slice(0, 400)) {
      byGroup[x.group] = (byGroup[x.group] ?? 0) + 1;
      if (x.country) byCountry[x.country] = (byCountry[x.country] ?? 0) + 1;
    }
    const rank = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ k, n }));

    return {
      victims: victims.slice(0, 60),
      last24h: within(24),
      last7d: within(24 * 7),
      totalTracked: victims.length,
      topGroups: rank(byGroup).slice(0, 12),
      geo: rank(byCountry).slice(0, 30).map(({ k, n }) => ({ cc: k, count: n })),
    };
  },
};
