// Component primitives. Every panel is assembled from these, which is what
// keeps 22 different data shapes looking like one instrument.

export const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Feed links are third-party content — RSS <link> elements and user-submitted
 *  Hacker News URLs — so they reach us as attacker-controlled strings. esc()
 *  stops an attribute breakout but not a `javascript:` scheme, which would run
 *  in this origin from an <a> click or window.open(). Allow http(s) only. */
export function safeHref(u) {
  if (!u) return null;
  try {
    const url = new URL(String(u), location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

// ── formatting ──────────────────────────────────────────────────────────────
export const num = (n) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-US'));

export function compact(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(1) + 'T';
  if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

export function bytes(n) {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 ? 1 : 0) + u[i];
}

/** Compact relative age: 12s, 4m, 3h, 6d. */
export function ago(ts) {
  if (!ts) return '—';
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return Math.floor(s) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 86400 * 30) return Math.floor(s / 86400) + 'd';
  return Math.floor(s / 2592000) + 'mo';
}

export const zulu = (d = new Date()) =>
  d.toISOString().slice(11, 19) + 'Z';

// ── primitives ──────────────────────────────────────────────────────────────

/** Label-left / value-right rows. Accepts [label, value] or {k,v,sub,cls}. */
export function rows(items) {
  const wrap = el('div', 'rows');
  for (const it of items) {
    if (!it) continue;
    const { k, v, sub, cls = '', href } = Array.isArray(it) ? { k: it[0], v: it[1] } : it;
    const r = el('div', sub ? 'row tall' : 'row');
    const left = el('div', 'kx');
    left.appendChild(el('div', 'k', esc(k)));
    if (sub) left.appendChild(el('div', 'sub', esc(sub)));
    r.appendChild(left);
    const val = el('div', `v ${cls}`, esc(v));
    val.title = String(v ?? '');   // values ellipsize when narrow; keep them readable
    const safe = safeHref(href);
    if (safe) {
      const a = el('a', '', esc(v));
      a.href = safe; a.target = '_blank'; a.rel = 'noopener';
      val.innerHTML = ''; val.appendChild(a);
    }
    r.appendChild(val);
    wrap.appendChild(r);
  }
  return wrap;
}

/** Discrete-stroke gauge. pct 0-100. */
export function meter(pct, { ticks = 14, tone = '' } = {}) {
  const m = el('div', 'meter');
  const on = Math.round((Math.max(0, Math.min(100, pct)) / 100) * ticks);
  for (let i = 0; i < ticks; i++) {
    m.appendChild(el('i', i < on ? `on ${tone}` : ''));
  }
  return m;
}

/** A labelled meter row: name ... |||||··· value */
export function meterRow(k, pct, v, opts = {}) {
  const r = el('div', 'meter-row');
  r.appendChild(el('div', 'k', esc(k)));
  r.appendChild(meter(pct, opts));
  r.appendChild(el('div', 'v', esc(v)));
  return r;
}

/** The stroke-field: histogram, sparkline, and skeleton loader in one.
 *
 *  Bars always fill the container: they flex to share whatever width the card
 *  gives them, so the chart never packs to one side and never scrolls sideways.
 *  Very long series are bucketed down to MAX_BARS first — below ~1px a bar is
 *  invisible anyway, and 167 sub-pixel strokes only read as noise. */
const MAX_BARS = 96;

/** Reduce a series to at most `cap` buckets, keeping each bucket's peak.
 *  Returns [value, originalIndex] pairs so index-sensitive tone callbacks
 *  (e.g. "highlight the last sample") still line up with the source data. */
function bucket(values, cap) {
  if (values.length <= cap) return values.map((v, i) => [v, i]);
  const out = [];
  for (let b = 0; b < cap; b++) {
    const lo = Math.floor((b * values.length) / cap);
    const hi = Math.max(lo + 1, Math.floor(((b + 1) * values.length) / cap));
    let peak = -Infinity, at = lo;
    for (let i = lo; i < hi; i++) {
      const v = Number.isFinite(values[i]) ? values[i] : 0;
      if (v >= peak) { peak = v; at = i; }
    }
    out.push([peak, hi - 1 === values.length - 1 ? values.length - 1 : at]);
  }
  return out;
}

export function field(values, { tone = null, cap } = {}) {
  const wrap = el('div', 'field-wrap');
  const f = el('div', 'field');
  const pairs = bucket(values, MAX_BARS);
  f.style.setProperty('--n', pairs.length);
  const max = Math.max(1, ...pairs.map(([v]) => (Number.isFinite(v) ? v : 0)));
  for (const [v, srcIdx] of pairs) {
    const b = el('i');
    const h = Math.max(1, ((Number.isFinite(v) ? v : 0) / max) * 100);
    b.style.height = h + '%';
    const t = typeof tone === 'function' ? tone(v, srcIdx) : tone;
    if (t) b.classList.add(t);
    b.title = String(v);
    f.appendChild(b);
  }
  wrap.appendChild(f);
  if (cap) {
    const c = el('div', 'field-cap');
    c.appendChild(el('span', '', esc(cap[0] ?? '')));
    c.appendChild(el('span', '', esc(cap[1] ?? '')));
    wrap.appendChild(c);
  }
  return wrap;
}

export function loadingField(n = 28) {
  const f = el('div', 'field loading');
  f.style.setProperty('--n', n);
  for (let i = 0; i < n; i++) {
    const b = el('i');
    b.style.height = (18 + Math.random() * 70) + '%';
    b.style.animationDelay = (i * 45) + 'ms';
    f.appendChild(b);
  }
  return f;
}

/** Oversized figure, ID-card treatment. */
export function figure(n, unit, { small = false } = {}) {
  const f = el('div', 'figure' + (small ? ' sm' : ''));
  f.appendChild(el('div', 'n', esc(n)));
  if (unit) f.appendChild(el('div', 'u', esc(unit)));
  return f;
}

/** Grid of small figures. cells = [{n, l}] */
export function figGrid(cells) {
  const g = el('div', 'fig-grid');
  for (const c of cells) {
    const d = el('div', 'fig-cell');
    d.appendChild(el('div', `n ${c.cls ?? ''}`, esc(c.n)));
    d.appendChild(el('div', 'l', esc(c.l)));
    g.appendChild(d);
  }
  return g;
}

export function statusDot(tone, label, { pulse = false } = {}) {
  const s = el('div', 'stat');
  s.appendChild(el('span', `dot ${tone}${pulse ? ' pulse' : ''}`));
  if (label) s.appendChild(el('span', '', esc(label)));
  return s;
}

/** Scrolling event list. items = [{when, title, sub, tag, tagCls, href}] */
export function list(items, { maxHeight } = {}) {
  const l = el('div', 'list');
  if (maxHeight) l.style.setProperty('--lh', maxHeight + 'px');
  if (!items.length) { l.appendChild(el('div', 'msg', 'NO RECORDS')); return l; }
  for (const it of items) {
    const row = el('div', 'item');
    row.appendChild(el('div', 'when', esc(it.when ?? '')));
    const t = el('div', 'txt');
    const safe = safeHref(it.href);
    const title = el('div', 't', safe
      ? `<a href="${esc(safe)}" target="_blank" rel="noopener">${esc(it.title)}</a>`
      : esc(it.title));
    t.appendChild(title);
    if (it.sub) t.appendChild(el('div', 's', esc(it.sub)));
    row.appendChild(t);
    if (it.tag) row.appendChild(el('div', `tagx ${it.tagCls ?? ''}`, esc(it.tag)));
    l.appendChild(row);
  }
  return l;
}

/** Horizontal chip rail. chips = [{tone, k, v}] */
export function chips(items) {
  const c = el('div', 'chips');
  for (const it of items) {
    const chip = el('div', 'chip');
    if (it.tone) chip.appendChild(el('span', `dot ${it.tone}`));
    chip.appendChild(el('span', '', `${esc(it.k)}${it.v != null ? ' ' : ''}`));
    if (it.v != null) chip.appendChild(el('b', '', esc(it.v)));
    c.appendChild(chip);
  }
  return c;
}

export function segmented(options, active, onPick) {
  const s = el('div', 'seg');
  for (const o of options) {
    const b = el('button', o.value === active ? 'on' : '', esc(o.label));
    b.onclick = () => onPick(o.value);
    s.appendChild(b);
  }
  return s;
}

/** Make a div behave like a button for keyboard and screen-reader users.
 *  Several rows here are clickable divs; without this they are mouse-only. */
export function clickable(node, fn, label) {
  node.tabIndex = 0;
  node.setAttribute('role', 'button');
  if (label) node.setAttribute('aria-label', label);
  node.onclick = fn;
  node.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); }
  };
  return node;
}

/** Keep Tab inside an open overlay. Returns a release function.
 *  Without this, tabbing out of a modal lands on the page behind it, which is
 *  still there and still interactive but visually covered. */
export function trapFocus(container) {
  const SEL = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const f = [...container.querySelectorAll(SEL)].filter((n) => n.getClientRects().length);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}

export const msg = (text) => el('div', 'msg', esc(text));

/** Stack children with spacing. */
export function stack(children, gap = 9) {
  const s = el('div');
  s.style.display = 'flex';
  s.style.flexDirection = 'column';
  s.style.gap = gap + 'px';
  for (const c of children) if (c) s.appendChild(c);
  return s;
}
