import { getJSON, getFeed, settle } from '../fetchers.js';

const HN = 'https://hacker-news.firebaseio.com/v0';

const FEEDS = [
  ['BBC WORLD', 'https://feeds.bbci.co.uk/news/world/rss.xml'],
  ['NYT WORLD', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml'],
  ['ARS TECHNICA', 'https://feeds.arstechnica.com/arstechnica/index'],
];

export default {
  id: 'world',
  label: 'WORLD & TECH',
  ttl: 900,
  span: 2,
  async fetch() {
    const jobs = Object.fromEntries(FEEDS.map(([n, u]) => [n, getFeed(u, { source: n, limit: 15 })]));
    jobs.hnIds = getJSON(`${HN}/topstories.json`, { timeout: 15000 });
    const r = await settle(jobs);

    // Hacker News needs one request per story; 15 is plenty for a morning read.
    const ids = (r.hnIds ?? []).slice(0, 15);
    const stories = (await Promise.allSettled(
      ids.map((id) => getJSON(`${HN}/item/${id}.json`, { timeout: 10000 })),
    )).filter((x) => x.status === 'fulfilled').map((x) => x.value).filter(Boolean);

    const hn = stories.map((s) => ({
      title: s.title,
      link: s.url ?? `https://news.ycombinator.com/item?id=${s.id}`,
      comments: `https://news.ycombinator.com/item?id=${s.id}`,
      score: s.score ?? 0,
      descendants: s.descendants ?? 0,
      ts: (s.time ?? 0) * 1000,
      source: 'HACKER NEWS',
    })).sort((a, b) => b.score - a.score);

    const press = FEEDS.flatMap(([n]) => r[n] ?? []).sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));

    return {
      hn,
      press,
      feeds: [
        ...FEEDS.map(([name]) => ({ name, ok: Array.isArray(r[name]), count: r[name]?.length ?? 0 })),
        { name: 'HACKER NEWS', ok: hn.length > 0, count: hn.length },
      ],
    };
  },
};
