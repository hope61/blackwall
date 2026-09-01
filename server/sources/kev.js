import { getJSON, settle } from '../fetchers.js';

const KEV = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

export default {
  id: 'kev',
  label: 'EXPLOITED IN THE WILD',
  ttl: 3600,
  span: 2,
  async fetch() {
    const kev = await getJSON(KEV, { timeout: 30000 });
    const all = kev.vulnerabilities ?? [];

    const recent = [...all]
      .sort((a, b) => Date.parse(b.dateAdded) - Date.parse(a.dateAdded))
      .slice(0, 25);

    // Ask EPSS for exploitation probability on just the recent slice.
    const ids = recent.map((v) => v.cveID).join(',');
    const { epss } = await settle({
      epss: getJSON(`https://api.first.org/data/v1/epss?cve=${ids}`, { timeout: 20000 }),
    });
    const score = new Map((epss?.data ?? []).map((d) => [d.cve, { epss: +d.epss, percentile: +d.percentile }]));

    const now = Date.now();
    const items = recent.map((v) => ({
      cve: v.cveID,
      vendor: v.vendorProject,
      product: v.product,
      name: v.vulnerabilityName,
      dateAdded: v.dateAdded,
      dueDate: v.dueDate,
      ransomware: v.knownRansomwareCampaignUse === 'Known',
      action: v.requiredAction?.slice(0, 160) ?? '',
      epss: score.get(v.cveID)?.epss ?? null,
      percentile: score.get(v.cveID)?.percentile ?? null,
      ageDays: Math.floor((now - Date.parse(v.dateAdded)) / 86400e3),
    }));

    const byVendor = {};
    for (const v of all) byVendor[v.vendorProject] = (byVendor[v.vendorProject] ?? 0) + 1;

    return {
      total: all.length,
      addedLast30d: all.filter((v) => now - Date.parse(v.dateAdded) < 30 * 86400e3).length,
      ransomwareLinked: all.filter((v) => v.knownRansomwareCampaignUse === 'Known').length,
      items,
      topVendors: Object.entries(byVendor).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => ({ k, n })),
      catalogVersion: kev.catalogVersion ?? null,
    };
  },
};
