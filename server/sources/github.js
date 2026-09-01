import { getJSON } from '../fetchers.js';

export default {
  id: 'github',
  label: 'GITHUB TRENDING',
  ttl: 3600,
  span: 2,
  async fetch({ env, has }) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (has('GITHUB_TOKEN')) headers.Authorization = `Bearer ${env.GITHUB_TOKEN.trim()}`;

    const since = new Date(Date.now() - 14 * 86400e3).toISOString().slice(0, 10);
    const q = encodeURIComponent(`created:>${since}`);
    const j = await getJSON(
      `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=25`,
      { headers, timeout: 20000 },
    );

    const repos = (j.items ?? []).map((r) => ({
      name: r.full_name,
      desc: (r.description ?? '').slice(0, 140),
      stars: r.stargazers_count,
      forks: r.forks_count,
      lang: r.language,
      url: r.html_url,
      created: r.created_at,
      topics: (r.topics ?? []).slice(0, 4),
      // stars/day since creation — a better "trending" signal than raw count
      velocity: Math.round(r.stargazers_count / Math.max(1, (Date.now() - Date.parse(r.created_at)) / 86400e3)),
    }));

    const langs = {};
    for (const r of repos) if (r.lang) langs[r.lang] = (langs[r.lang] ?? 0) + 1;

    return {
      repos: [...repos].sort((a, b) => b.velocity - a.velocity),
      windowDays: 14,
      authenticated: has('GITHUB_TOKEN'),
      topLangs: Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ k, n })),
    };
  },
};
