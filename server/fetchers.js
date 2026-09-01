// Shared upstream helpers. Every outbound request goes through here so that
// timeouts, user-agent, and error shape are consistent across all 23 sources.
const UA = 'blackwall/0.1 (osint console; contact: local)';

export async function raw(url, opts = {}) {
  const { timeout = 15000, headers = {}, retries = 1, ...rest } = opts;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(url, {
        ...rest,
        signal: ac.signal,
        headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate', ...headers },
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${url.slice(0, 90)}`);
        err.status = res.status;
        throw err;
      }
      return res;
    } catch (err) {
      lastErr = err;
      // Retry only transient connection failures. An HTTP status, a rate limit
      // or our own timeout will not improve by asking again immediately.
      const transient = err.status === undefined && err.name !== 'AbortError';
      if (!transient || attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export const getJSON = async (url, opts) => (await raw(url, opts)).json();
export const getText = async (url, opts) => (await raw(url, opts)).text();

/** Run promises in parallel, never reject; failures come back as null. */
export async function settle(map) {
  const keys = Object.keys(map);
  const vals = await Promise.allSettled(keys.map((k) => map[k]));
  const out = {};
  keys.forEach((k, i) => { out[k] = vals[i].status === 'fulfilled' ? vals[i].value : null; });
  return out;
}

// ── RSS / Atom ──────────────────────────────────────────────────────────────
// Deliberately a small regex parser rather than an XML dependency. Feeds we
// consume are well-formed and we only want four fields from each item.
const strip = (s = '') => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? strip(m[1]) : '';
};

export function parseFeed(xml, { source = '', limit = 20 } = {}) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  return blocks.slice(0, limit).map((b) => {
    let link = tag(b, 'link');
    if (!link) {
      const m = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = m ? m[1] : '';
    }
    const date = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || '';
    const ts = date ? Date.parse(date) : NaN;
    return {
      title: tag(b, 'title'),
      link,
      summary: (tag(b, 'description') || tag(b, 'summary')).slice(0, 280),
      ts: Number.isNaN(ts) ? null : ts,
      source,
    };
  }).filter((x) => x.title);
}

export async function getFeed(url, opts = {}) {
  return parseFeed(await getText(url, opts), opts);
}
