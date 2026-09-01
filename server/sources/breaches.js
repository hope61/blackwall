import { getJSON } from '../fetchers.js';

export default {
  id: 'breaches',
  label: 'DATA BREACHES',
  ttl: 21600,
  span: 2,
  async fetch() {
    const all = await getJSON('https://haveibeenpwned.com/api/v3/breaches', { timeout: 30000 });

    const norm = all.map((b) => ({
      name: b.Name,
      title: b.Title,
      domain: b.Domain || null,
      date: b.BreachDate,
      added: b.AddedDate,
      count: b.PwnCount ?? 0,
      classes: (b.DataClasses ?? []).slice(0, 6),
      verified: !!b.IsVerified,
      sensitive: !!b.IsSensitive,
      stealer: !!b.IsStealerLog,
    }));

    const recent = [...norm].sort((a, b) => Date.parse(b.added) - Date.parse(a.added)).slice(0, 25);
    const biggest = [...norm].sort((a, b) => b.count - a.count).slice(0, 15);
    const totalAccounts = norm.reduce((n, b) => n + b.count, 0);

    // What gets stolen most often — drives a bar-meter stack.
    const classFreq = {};
    for (const b of norm) for (const c of b.classes) classFreq[c] = (classFreq[c] ?? 0) + 1;

    const year = new Date().getFullYear();
    const byYear = {};
    for (const b of norm) {
      const y = +(b.date ?? '').slice(0, 4);
      if (y >= year - 9) byYear[y] = (byYear[y] ?? 0) + 1;
    }

    return {
      totalBreaches: norm.length,
      totalAccounts,
      recent,
      biggest,
      topClasses: Object.entries(classFreq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => ({ k, n })),
      byYear: Object.entries(byYear).sort((a, b) => +a[0] - +b[0]).map(([y, n]) => ({ year: +y, n })),
    };
  },
};
