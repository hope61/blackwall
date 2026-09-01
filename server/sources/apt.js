import { getJSON } from '../fetchers.js';

// MITRE ATT&CK intrusion sets. The full bundle is ~40MB, so this runs on a
// 30-day TTL and only the distilled extract is ever cached to disk.
const REPO = 'https://api.github.com/repos/mitre-attack/attack-stix-data/contents/enterprise-attack';

const verOf = (n) => {
  const m = n.match(/enterprise-attack-(\d+)\.(\d+)\.json/);
  return m ? [+m[1], +m[2]] : null;
};

export default {
  id: 'apt',
  label: 'THREAT ACTORS',
  ttl: 2592000,
  span: 2,
  async fetch() {
    const files = await getJSON(REPO, { timeout: 30000, headers: { Accept: 'application/vnd.github+json' } });

    const latest = files
      .map((f) => ({ f, v: verOf(f.name) }))
      .filter((x) => x.v)
      .sort((a, b) => (b.v[0] - a.v[0]) || (b.v[1] - a.v[1]))[0];
    if (!latest) throw new Error('no versioned ATT&CK bundle found');

    const bundle = await getJSON(latest.f.download_url, { timeout: 120000 });
    const objects = bundle.objects ?? [];

    // Count techniques attributed to each group via relationship objects.
    const techCount = new Map();
    for (const o of objects) {
      if (o.type === 'relationship' && o.relationship_type === 'uses'
          && o.source_ref?.startsWith('intrusion-set--')
          && o.target_ref?.startsWith('attack-pattern--')) {
        techCount.set(o.source_ref, (techCount.get(o.source_ref) ?? 0) + 1);
      }
    }

    const groups = objects
      .filter((o) => o.type === 'intrusion-set' && !o.revoked && !o.x_mitre_deprecated)
      .map((o) => {
        const ref = (o.external_references ?? []).find((r) => r.source_name === 'mitre-attack');
        return {
          id: ref?.external_id ?? null,
          name: o.name,
          aliases: (o.aliases ?? []).filter((a) => a !== o.name).slice(0, 6),
          description: (o.description ?? '').replace(/\(Citation:[^)]*\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 300),
          techniques: techCount.get(o.id) ?? 0,
          created: o.created ?? null,
          modified: o.modified ?? null,
          url: ref?.url ?? null,
        };
      })
      .filter((g) => g.id);

    return {
      version: latest.f.name.replace(/^enterprise-attack-|\.json$/g, ''),
      total: groups.length,
      groups: [...groups].sort((a, b) => b.techniques - a.techniques).slice(0, 40),
      recentlyUpdated: [...groups]
        .sort((a, b) => Date.parse(b.modified ?? 0) - Date.parse(a.modified ?? 0))
        .slice(0, 12),
      totalTechniqueLinks: [...techCount.values()].reduce((a, b) => a + b, 0),
    };
  },
};
