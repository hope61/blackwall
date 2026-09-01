import { getFeed, settle } from '../fetchers.js';

const FEEDS = [
  ['CISA',    'https://www.cisa.gov/cybersecurity-advisories/all.xml'],
  ['KREBS',   'https://krebsonsecurity.com/feed/'],
  ['BLEEPING','https://www.bleepingcomputer.com/feed/'],
  ['THN',     'https://feeds.feedburner.com/TheHackersNews'],
];

const BREACH = /\b(breach|leak|exposed|stolen|data of|records|compromis|hacked|ransom|extort)/i;

export default {
  id: 'news',
  label: 'SECURITY INCIDENTS',
  ttl: 900,
  span: 2,
  async fetch() {
    const got = await settle(Object.fromEntries(
      FEEDS.map(([name, url]) => [name, getFeed(url, { source: name, limit: 20 })]),
    ));

    const items = FEEDS.flatMap(([name]) => got[name] ?? [])
      .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));

    return {
      items: items.slice(0, 40),
      breaches: items.filter((i) => BREACH.test(i.title + ' ' + i.summary)).slice(0, 20),
      feeds: FEEDS.map(([name]) => ({ name, ok: Array.isArray(got[name]), count: got[name]?.length ?? 0 })),
    };
  },
};
