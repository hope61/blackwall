import { getJSON } from '../fetchers.js';

const iso = (d) => d.toISOString().slice(0, 23);

export default {
  id: 'cve',
  label: 'CVE WATERFALL',
  ttl: 1800,
  span: 2,
  async fetch() {
    const end = new Date();
    const start = new Date(end.getTime() - 3 * 86400e3);
    const url = 'https://services.nvd.nist.gov/rest/json/cves/2.0'
      + `?pubStartDate=${iso(start)}&pubEndDate=${iso(end)}&resultsPerPage=200`;

    const j = await getJSON(url, { timeout: 30000 });

    const items = (j.vulnerabilities ?? []).map(({ cve }) => {
      const m = cve.metrics ?? {};
      const c = m.cvssMetricV31?.[0] ?? m.cvssMetricV30?.[0] ?? m.cvssMetricV2?.[0];
      const d = c?.cvssData ?? {};
      return {
        cve: cve.id,
        published: cve.published,
        score: d.baseScore ?? null,
        severity: (d.baseSeverity ?? c?.baseSeverity ?? 'NONE').toUpperCase(),
        vector: d.attackVector ?? null,
        desc: (cve.descriptions?.find((x) => x.lang === 'en')?.value ?? '').slice(0, 200),
      };
    });

    const scored = items.filter((x) => x.score != null);
    const buckets = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 };
    for (const x of items) buckets[x.severity] = (buckets[x.severity] ?? 0) + 1;

    // 10-wide histogram of base scores, for the bar-field component
    const histogram = Array.from({ length: 10 }, (_, i) =>
      scored.filter((x) => x.score >= i && x.score < i + 1).length);

    return {
      total: j.totalResults ?? items.length,
      windowDays: 3,
      buckets,
      histogram,
      worst: scored.sort((a, b) => b.score - a.score).slice(0, 15),
      newest: items.slice(0, 15),
    };
  },
};
