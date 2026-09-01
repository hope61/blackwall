import { el, esc, ago, zulu, field, compact, safeHref, clickable, trapFocus } from './ui.js';
import { renderers } from './panels.js';
import { WorldMap, LEGENDS } from './map.js';
import { deriveAlerts } from './alerts.js';
import { buildBrief, KIND_LABEL, ORIGIN } from './brief.js';
import { listViews, saveView, deleteView, lastView, rememberLast } from './views.js';

const $ = (s) => document.querySelector(s);
const LAST_SEEN = 'blackwall.lastSeen';

const state = {
  config: null, manifest: null, data: {},
  panels: new Map(), sections: [],
  filter: '', digestOpen: false, focused: null,
  mode: new URLSearchParams(location.search).get('mode')
        || localStorage.getItem('blackwall.mode') || 'read',
  lastSeen: Number(localStorage.getItem(LAST_SEEN)) || null,
  history: null,
};

/* ── ordered dithering ─────────────────────────────────────────────────────
   The reference's signature texture: a white-to-black gradient resolved with a
   4x4 Bayer matrix, so it breaks into hard pixels instead of a smooth ramp.
   Generated once rather than shipped as an image. */
const BAYER4 = [
  [0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5],
];

function makeDither() {
  const w = 460, h = 280;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Diagonal ramp: white at the top-left, dissolving toward black at the
      // bottom-right, matching the reference's field.
      const d = (x / w) * 0.82 + (y / h) * 0.30;
      // Floor the ramp so even the lightest corner stays dithered instead of
      // blowing out to solid white — a white slab is glaring on a black UI.
      const t = Math.min(1, 0.26 + d * 0.92);
      const threshold = (BAYER4[y & 3][x & 3] + 0.5) / 16;
      const v = t > threshold ? 0 : 255;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  document.documentElement.style.setProperty('--dither', `url(${c.toDataURL()})`);
}

/* ═══ MORNING BRIEF ═══════════════════════════════════════════════════════ */
function greetingFor(h) {
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

let briefSig = '';

function renderBrief() {
  const now = new Date();
  $('#greeting').textContent = greetingFor(now.getHours());
  $('#datel').textContent = now.toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).toUpperCase();

  const brief = buildBrief(state.data, state.lastSeen);

  // ── hero card ──
  const total = state.manifest?.panels?.length ?? Object.keys(state.data).length;
  const live = Object.values(state.data).filter((p) => p.state === 'NOMINAL').length;
  $('#hero-new').textContent = state.lastSeen
    ? `${brief.newCount} · since ${ago(state.lastSeen)} ago`
    : 'first visit';
  $('#hero-src').textContent = `${live}/${total}`;

  // Block meter mirrors the reference's segmented progress bar.
  const meter = $('#hero-meter');
  meter.replaceChildren();
  const TICKS = 34;
  const on = Math.round((live / Math.max(1, total)) * TICKS);
  for (let i = 0; i < TICKS; i++) {
    meter.appendChild(el('i', i < on ? (live < total ? 'on warn' : 'on') : ''));
  }

  const alerts = deriveAlerts(state.data).filter((a) => a.sev === 'crit' || a.sev === 'warn');
  $('#hero-msg').textContent = alerts.length
    ? `${alerts.length} item${alerts.length > 1 ? 's' : ''} need attention — ${alerts[0].text.toLowerCase()}`
    : 'All monitored systems nominal';

  // Re-rendering the digest under someone who is reading it is hostile, and it
  // also cancels any in-flight scroll. Only rebuild when the content changes.
  const sig = brief.items.map((i) => `${i.kind}${i.ts}${i.title}`).join('|')
    + `|${state.digestOpen}|${brief.headline.map((h) => h.n).join(',')}`
    + `|${(state.data.world?.data?.hn ?? []).map((h) => h.score + h.title).join(',')}`
    + `|${(state.data.rootdns?.data?.servers ?? []).map((r) => r.letter + r.status).join(',')}`
    + `|${Object.values(state.data).map((p) => p.state).join('')}`
    + `|${state.history?.to ?? ''}|${state.history?.days ?? 0}`;
  if (sig === briefSig) return;
  briefSig = sig;

  const hl = $('#headline');
  hl.replaceChildren();
  for (const h of brief.headline) {
    const c = el('div', 'hl');
    c.appendChild(el('div', `n ${h.tone ?? ''}`, esc(h.n)));
    const right = el('div');
    right.appendChild(el('div', 'l', esc(h.l)));
    const d = delta(h.metric);
    if (d) right.appendChild(d);
    c.appendChild(right);
    hl.appendChild(c);
  }

  const host = $('#digest');
  host.replaceChildren();
  // Split by origin, not by rank. Two columns of the same stream differing only
  // in position is not a distinction a reader can see — this one is.
  const reported = brief.items.filter((i) => ORIGIN[i.kind] !== 'detected');
  const detected = brief.items.filter((i) => ORIGIN[i.kind] === 'detected');

  const MAIN = 7;
  const shown = state.digestOpen ? reported : reported.slice(0, MAIN);
  shown.forEach((it, i) => {
    const row = el('div', 'dg' + (i === 0 ? ' lead' : ''));
    row.dataset.sev = it.sev ?? 'info';

    // Source, age and NEW live on one quiet line above the headline, instead of
    // a cramped gutter that pushed the text off its natural left margin.
    const meta = el('div', 'meta');
    meta.appendChild(el('span', 'kind', esc(KIND_LABEL[it.kind] ?? it.kind.toUpperCase())));
    meta.appendChild(el('span', 'sep'));
    meta.appendChild(el('span', '', ago(it.ts) + ' ago'));
    const srcs = it.sources?.length ? it.sources : (it.source ? [it.source] : []);
    if (srcs.length) {
      meta.appendChild(el('span', 'sep'));
      meta.appendChild(el('span', '', esc(
        srcs.length > 1 ? `${srcs[0]} +${srcs.length - 1} more` : srcs[0])));
    }
    if (it.isNew) meta.appendChild(el('span', 'new', 'New'));
    row.appendChild(meta);

    row.appendChild(el('div', 't', esc(it.title)));
    if (it.why) row.appendChild(el('div', 'w', esc(it.why)));

    clickable(row, () => {
      const safe = safeHref(it.href);
      if (safe) window.open(safe, '_blank', 'noopener');
      else if (it.panel) { setMode('ops'); focusPanel(it.panel); }
    }, it.title);
    host.appendChild(row);
  });

  // ── second column: machine-detected events, not journalism ──
  const also = $('#also');
  also.className = 'also';
  also.replaceChildren();
  const rest = detected.slice(0, 12);
  for (const it of rest) {
    const row = el('div', 'al');
    row.dataset.sev = it.sev ?? 'info';
    const m = el('div', 'm');
    m.appendChild(el('span', 'kind', esc(KIND_LABEL[it.kind] ?? it.kind.toUpperCase())));
    m.appendChild(el('span', '', ago(it.ts)));
    row.appendChild(m);
    row.appendChild(el('div', 't', esc(it.title)));
    clickable(row, () => {
      const safe = safeHref(it.href);
      if (safe) window.open(safe, '_blank', 'noopener');
      else if (it.panel) { setMode('ops'); focusPanel(it.panel); }
    }, it.title);
    also.appendChild(row);
  }
  $('.secondary').hidden = rest.length === 0;

  // ── Hacker News, straight into the rail ──
  const hn = state.data.world?.data?.hn ?? [];
  $('#hn-block').hidden = hn.length === 0;
  const hnHost = $('#hn');
  hnHost.replaceChildren();
  for (const h of hn.slice(0, 6)) {
    const row = el('div', 'hn-row');
    row.appendChild(el('div', 'pts', String(h.score)));
    row.appendChild(el('div', 't', esc(h.title)));
    const safe = safeHref(h.link);
    clickable(row, () => { if (safe) window.open(safe, '_blank', 'noopener'); }, h.title);
    hnHost.appendChild(row);
  }

  // ── 13 root nameserver lights: compact, visual, on-brand ──
  const root = state.data.rootdns?.data;
  $('#root-block').hidden = !root;
  if (root) {
    const rl = $('#rootlights');
    rl.replaceChildren();
    for (const sv of root.servers) {
      const c = el('div', 'rl');
      c.title = `${sv.letter} · ${sv.operator} · ${sv.rtt ?? '—'} ms`;
      c.appendChild(el('span', 'dot ' + (sv.status === 'NOMINAL' ? 'ok' : sv.status === 'DEGRADED' ? 'warn' : 'bad')));
      c.appendChild(el('b', '', sv.letter));
      rl.appendChild(c);
    }
  }

  const more = $('#digest-more');
  if (reported.length > MAIN) {
    more.hidden = false;
    more.textContent = state.digestOpen
      ? 'Show less'
      : `Show all ${reported.length} stories`;
  } else {
    more.hidden = true;
  }
}

/** Movement against the trailing week. An absolute number tells you little;
 *  "14% above the 7-day average" is the part worth reading. */
function delta(key) {
  const m = state.history?.metrics?.[key];
  if (!m || m.pctVsAvg == null || !Number.isFinite(m.pctVsAvg)) return null;
  const pct = m.pctVsAvg;
  if (Math.abs(pct) < 1.5) return el('div', 'chg flat', 'level vs 7d avg');

  const up = pct > 0;
  // "Bad" depends on the metric: more attacks is bad, less IPv6 adoption is bad.
  const bad = m.dir === 'up' ? up : m.dir === 'down' ? !up : false;
  const n = el('div', `chg ${bad ? 'bad' : 'good'}`,
    `${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(pct < 10 ? 1 : 0)}% vs 7d avg`);
  return n;
}

/** Sparklines for the rail — only meaningful once a few days exist. */
function renderTrends() {
  const host = $('#trends');
  const block = $('#trend-block');
  if (!host || !block) return;
  const h = state.history;
  if (!h || h.days < 2) {
    block.hidden = false;
    host.replaceChildren(el('div', 'msg',
      h ? `Collecting — ${h.days} day${h.days === 1 ? '' : 's'} recorded` : 'Collecting'));
    return;
  }
  block.hidden = false;
  host.replaceChildren();
  for (const key of ['attacks', 'ransomware', 'kev', 'torExits']) {
    const m = h.metrics[key];
    if (!m || m.series.length < 2) continue;
    const row = el('div', 'trend');
    const top = el('div', 'trend-top');
    top.appendChild(el('span', 'tl', esc(m.label)));
    top.appendChild(el('span', 'tv', compact(m.value)));
    row.appendChild(top);
    row.appendChild(field(m.series.map((x) => x.v), { tone: 'hi' }));
    host.appendChild(row);
  }
}

/* ═══ ALERTS ══════════════════════════════════════════════════════════════ */
let alertSig = '';

function renderAlerts() {
  const alerts = deriveAlerts(state.data);
  const sig = alerts.map((a) => a.sev + a.text).join('|');
  if (sig === alertSig) return;
  alertSig = sig;

  const host = $('#alerts');
  host.replaceChildren();
  for (const a of alerts) {
    const n = el('div', 'alert');
    n.dataset.sev = a.sev;
    n.appendChild(el('span', 'dot'));
    n.appendChild(el('span', '', esc(a.text)));
    if (a.panel) clickable(n, () => focusPanel(a.panel), a.text);
    host.appendChild(n);
  }
}

/* ═══ PANELS ══════════════════════════════════════════════════════════════ */
function buildPanel(cfg, meta, index) {
  const p = el('section', `panel bracket span-${cfg.span ?? 1}`);
  p.dataset.id = cfg.id;
  p.dataset.state = 'LOADING';

  const head = el('div', 'p-head');
  head.appendChild(el('div', 'p-idx', String(index).padStart(2, '0')));
  head.appendChild(el('div', 'p-title', esc(meta?.label ?? cfg.id.toUpperCase())));

  const st = el('div', 'p-state');
  const act = el('button', 'p-act', 'Expand');
  act.title = 'Open this panel full-screen';
  act.setAttribute('aria-expanded', 'false');
  act.setAttribute('aria-label', `Expand ${meta?.label ?? cfg.id}`);
  act.onclick = (e) => {
    e.stopPropagation();
    // Inside the overlay this is the only visible control, so it closes.
    if (state.focused === cfg.id) closeFocus(); else focusPanel(cfg.id);
  };
  const age = el('div', 'p-age', '——');
  st.append(act, age, el('span', 'dot off'));
  head.appendChild(st);

  head.onclick = () => (state.focused === cfg.id ? closeFocus() : focusPanel(cfg.id));

  const body = el('div', 'p-body');
  body.appendChild(el('div', 'msg', 'AWAITING UPSTREAM'));
  const foot = el('div', 'p-foot', 'INITIALISING');

  p.append(head, body, foot);
  state.panels.set(cfg.id, {
    root: p, head, body, foot, age, act, dot: st.querySelector('.dot'),
    label: meta?.label ?? cfg.id.toUpperCase(),
  });
  return p;
}

function paint(id, payload) {
  const ref = state.panels.get(id);
  if (!ref) return;
  const { root, body, foot, age, dot } = ref;

  root.dataset.state = payload.state ?? 'FAULT';
  age.textContent = payload.fetchedAt ? ago(payload.fetchedAt) : '——';
  dot.className = 'dot ' + ({ NOMINAL: 'ok', STALE: 'warn', FAULT: 'bad' }[payload.state] ?? 'off');

  if (!payload.data) {
    body.replaceChildren(el('div', 'msg', payload.error ? 'UPSTREAM FAULT' : 'NO DATA'));
    foot.textContent = payload.error ? String(payload.error).slice(0, 120).toUpperCase() : 'NO RECORDS RETURNED';
    return;
  }

  const fn = renderers[id];
  if (!fn) {
    body.replaceChildren(el('div', 'msg', 'NO RENDERER'));
    foot.textContent = `SOURCE ${id.toUpperCase()} HAS NO FRONTEND RENDERER`;
    return;
  }

  try {
    const out = fn(payload.data);
    body.replaceChildren(out.body);
    foot.textContent = out.foot ?? '';
    root.classList.add('refreshing');
    setTimeout(() => root.classList.remove('refreshing'), 720);
  } catch (err) {
    root.dataset.state = 'FAULT';
    body.replaceChildren(el('div', 'msg', 'RENDER FAULT'));
    foot.textContent = String(err.message ?? err).slice(0, 120).toUpperCase();
    console.error(`[panel:${id}]`, err);
  }
}

/* ── focus: move the live node, never clone it, so refreshes keep landing ── */
let releaseFocusTrap = null, focusReturn = null;

function focusPanel(id) {
  const ref = state.panels.get(id);
  if (!ref) return;
  const returnTo = state.focused ? focusReturn : document.activeElement;
  closeFocus();
  focusReturn = returnTo;
  ref.placeholder = document.createComment(`panel:${id}`);
  ref.root.replaceWith(ref.placeholder);
  const host = $('#focus-host');
  host.replaceChildren(ref.root);
  const overlay = $('#focus');
  overlay.hidden = false;
  state.focused = id;
  ref.act.textContent = 'Close';
  ref.act.title = 'Close (Esc)';
  ref.act.setAttribute('aria-expanded', 'true');
  overlay.setAttribute('aria-label', `${ref.label} — expanded`);
  releaseFocusTrap = trapFocus(overlay);
  ref.act.focus();
}

function closeFocus() {
  if (!state.focused) return;
  const ref = state.panels.get(state.focused);
  if (ref) {
    ref.act.textContent = 'Expand';
    ref.act.title = 'Open this panel full-screen';
    ref.act.setAttribute('aria-expanded', 'false');
  }
  if (ref?.placeholder) {
    ref.placeholder.replaceWith(ref.root);
    ref.placeholder = null;
  }
  $('#focus').hidden = true;
  state.focused = null;
  releaseFocusTrap?.(); releaseFocusTrap = null;
  // Send focus back where it came from, or the keyboard user is dumped at the
  // top of the document every time they close a panel.
  if (focusReturn?.isConnected) focusReturn.focus();
  focusReturn = null;
}

/* ═══ LAYOUT ══════════════════════════════════════════════════════════════ */
function layout() {
  const host = $('#sections');
  host.replaceChildren();
  state.panels.clear();
  state.sections = [];

  const metaById = new Map((state.manifest?.panels ?? []).map((p) => [p.id, p]));
  let index = 1;

  for (const sec of state.config.sections) {
    const panels = sec.panels.filter((p) => p.on !== false && metaById.has(p.id));
    if (!panels.length) continue;

    const header = el('div', 'section');
    header.id = sec.id;
    header.appendChild(el('div', 'num', sec.num));
    header.appendChild(el('div', 'name', esc(sec.name)));
    header.appendChild(el('div', 'rule'));
    header.appendChild(el('div', 'meta', `${panels.length} PANELS`));
    host.appendChild(header);

    const grid = el('div', 'grid');
    for (const cfg of panels) grid.appendChild(buildPanel(cfg, metaById.get(cfg.id), index++));
    host.appendChild(grid);

    state.sections.push({ ...sec, header, grid, ids: panels.map((p) => p.id) });
  }

  buildNav();
  for (const [id, payload] of Object.entries(state.data)) paint(id, payload);
  applyFilter();
}

/** Scroll instantly.
 *  Both animated approaches failed in practice — native `behavior:'smooth'` is
 *  cancelled by any content change mid-flight, and a rAF tween gets throttled;
 *  measured, four of five nav buttons ended at scrollTop 0. Navigation that
 *  works every time beats a 400ms ease, so this assigns scrollTop directly. */
function jump(top) {
  $('#body').scrollTop = Math.max(0, top);
}

function scrollTo(target, { flash = false } = {}) {
  const body = $('#body');
  jump(target.getBoundingClientRect().top - body.getBoundingClientRect().top
       + body.scrollTop - 12);
  // Landing somewhere with no visible change reads as "the button is broken".
  if (flash) {
    target.classList.add('flash');
    setTimeout(() => target.classList.remove('flash'), 900);
  }
}

/** Named navigation.
 *  The icon rail listed sections as "TH" "NE" "IN" "AM" — unreadable and
 *  unpredictable. This spells out every section AND every panel inside it, so
 *  a destination is picked by reading rather than by guessing. */
function buildNav() {
  const host = $('#nav');
  host.replaceChildren();

  for (const sec of state.sections) {
    const wrap = el('div', 'nav-sec');
    wrap.dataset.section = sec.id;

    const h = el('div', 'h');
    h.appendChild(el('span', '', esc(sec.name)));
    h.appendChild(el('span', 'n', String(sec.ids.length)));
    h.onclick = () => scrollTo(sec.header);
    wrap.appendChild(h);

    const list = el('div', 'nav-list');
    for (const id of sec.ids) {
      const ref = state.panels.get(id);
      const b = el('button', 'nav-item');
      b.dataset.panel = id;
      b.appendChild(el('span', 'dot off'));
      b.appendChild(el('span', '', esc(ref?.label ?? id)));
      b.onclick = () => { const r = state.panels.get(id); if (r) scrollTo(r.root, { flash: true }); };
      list.appendChild(b);
    }
    wrap.appendChild(list);
    host.appendChild(wrap);
  }
  spy();
}

/** Mirror each panel's health onto its nav entry. */
function syncNavDots() {
  for (const [id, ref] of state.panels) {
    const b = $(`.nav-item[data-panel="${id}"] .dot`);
    if (b) b.className = ref.dot.className;
  }
}

function spy() {
  const mark = (id) => document.querySelectorAll('.nav-sec')
    .forEach((n) => n.classList.toggle('active', n.dataset.section === id));

  const obs = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) mark(e.target.id);
  }, { root: $('#body'), rootMargin: '-5% 0px -80% 0px' });
  for (const sec of state.sections) obs.observe(sec.header);
}

/** Read = brief + map. Console = map + the instrument grid.
 *  Switching used to change a region the user could not see, so the mode now
 *  also resets scroll, toggles the sidebar, and states what the view is. */
function setMode(m) {
  state.mode = m;
  localStorage.setItem('blackwall.mode', m);
  for (const b of $('#modes').children) {
    const on = b.dataset.mode === m;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  }
  applyFilter();
  jump(0);
  $('#view-label').textContent = m === 'read'
    ? 'Morning brief — what changed while you were away'
    : `Console — ${state.panels.size} live panels across ${state.sections.length} sections`;
}

/* ── saved views ───────────────────────────────────────────────────────────
   Everything that makes up "where the operator was looking". The map may not
   be built yet on first paint, so its half is optional in both directions. */
function snapshot() {
  return {
    mode: state.mode,
    filter: state.filter,
    layer: map?.layer ?? null,
    cx: map?.cx ?? null, cy: map?.cy ?? null, zoom: map?.zoom ?? null,
  };
}

function applyView(v) {
  if (!v) return;
  if (v.mode) setMode(v.mode);
  const f = $('#filter');
  f.value = v.filter ?? '';
  state.filter = v.filter ?? '';
  $('#filter-wrap').classList.toggle('has-value', !!state.filter);
  applyFilter();
  if (map && v.layer) setLayer(v.layer);
  if (map && v.zoom != null) {
    map.setZoom(v.zoom);
    map.cx = v.cx ?? 0;
    map.cy = v.cy ?? 8;
  }
}

/* Persist on the way out rather than on every keystroke and map drag. */
function rememberView() {
  try { rememberLast(snapshot()); } catch { /* private mode / quota — not fatal */ }
}

/* ── filter ───────────────────────────────────────────────────────────────── */
function applyFilter() {
  const q = state.filter.trim().toLowerCase();
  $('#filter-wrap').classList.toggle('has-value', !!q);
  let visible = 0;

  // Stories are searched by their actual text, not just the panel they came
  // from — the filter used to match panel labels only, which made it useless
  // in Brief mode.
  let storyHits = 0;
  for (const row of document.querySelectorAll('#digest .dg, #also .al')) {
    const hit = !q || row.textContent.toLowerCase().includes(q);
    row.hidden = !hit;
    if (hit) storyHits++;
  }

  for (const sec of state.sections) {
    let secVisible = 0;
    for (const id of sec.ids) {
      const ref = state.panels.get(id);
      if (!ref) continue;
      const hay = `${id} ${ref.label} ${ref.foot.textContent}`.toLowerCase();
      const show = !q || hay.includes(q);
      ref.root.hidden = !show;
      if (show) { secVisible++; visible++; }
    }
    sec.header.hidden = q ? secVisible === 0 : false;
    sec.grid.hidden = secVisible === 0;
  }

  // The two modes are distinct destinations, not a disclosure toggle:
  // Read is the brief and the map, Console is the map and the instrument grid.
  const reading = state.mode === 'read';
  // Filtering no longer hides the brief; it searches it.
  $('#brief').hidden = !reading;
  $('#console').hidden = reading;
  $('#side').hidden = reading;
  $('#hero').hidden = !!q;
  $('.hero-wrap').hidden = !!q;
  $('#view-label').hidden = !!q;

  if (reading) visible = storyHits;
  $('#no-results').textContent = reading
    ? 'No stories match that filter' : 'No panels match that filter';
  $('#no-results').hidden = !(q && visible === 0);
}

/* ═══ DATA ════════════════════════════════════════════════════════════════ */
function afterData() {
  syncNavDots();
  renderAlerts();
  renderTrends();
  renderBrief();
  syncHeader();
  map?.update(state.data);
  applyFilter();
}

async function loadHistory() {
  try {
    state.history = await (await fetch('/api/history')).json();
    briefSig = '';            // deltas changed, so the brief must re-render
    renderBrief();
    renderTrends();
  } catch (err) {
    console.warn('[history]', err);
  }
}

async function loadAll() {
  const j = await (await fetch('/api/all')).json();
  state.data = j;
  for (const [id, payload] of Object.entries(j)) paint(id, payload);
  afterData();
}

async function refresh(id, force = false) {
  const ref = state.panels.get(id);
  if (force && ref) ref.root.classList.add('refreshing');
  try {
    const j = await (await fetch(`/api/panel/${id}`)).json();
    state.data[id] = j;
    paint(id, j);
    afterData();
  } catch (err) {
    console.warn(`[refresh:${id}]`, err);
  }
}

function refreshAll() {
  const btn = $('#refresh-all');
  btn.classList.add('on');
  Promise.all(state.manifest.panels.map((p) => refresh(p.id)))
    .finally(() => setTimeout(() => btn.classList.remove('on'), 600));
}

function schedule() {
  for (const p of state.manifest.panels) {
    const period = Math.max(30, p.ttl) * 1000;
    setTimeout(() => {
      refresh(p.id);
      setInterval(() => refresh(p.id), period);
    }, Math.random() * period * 0.25 + period * 0.5);
  }
}

function syncHeader() {
  const hp = state.data.honeypot?.data;
  if (hp?.infocon) {
    $('#infocon').dataset.level = hp.infocon;
    $('#infocon-t').textContent = hp.infocon.toUpperCase();
  }
  const eg = state.data.egress?.data;
  if (eg) $('#geo').textContent = [eg.city, eg.cc].filter(Boolean).join(', ').toUpperCase() || '———';
}

/* ═══ COMMAND PALETTE ═════════════════════════════════════════════════════ */
function commands() {
  const c = [];
  for (const [id, ref] of state.panels) {
    c.push({ kind: 'PANEL', label: ref.label, hint: id, run: () => focusPanel(id) });
  }
  for (const b of $('#map-layers').children) {
    c.push({
      kind: 'MAP', label: `Map layer — ${b.dataset.layer}`, hint: b.querySelector('i')?.textContent ?? '',
      run: () => setLayer(b.dataset.layer),
    });
  }
  for (const v of listViews()) {
    c.push({ kind: 'VIEW', label: v.name, hint: 'saved view', run: () => applyView(v) });
  }
  c.push({
    kind: 'VIEW', label: 'Save current view as…', hint: '',
    run: () => {
      const name = prompt('Name this view (mode, filter and map position):');
      if (name && saveView(name, snapshot())) drawPalette();
    },
  });
  if (listViews().length) {
    c.push({
      kind: 'VIEW', label: 'Delete a saved view…', hint: '',
      run: () => {
        const name = prompt(`Delete which view?\n\n${listViews().map((v) => v.name).join('\n')}`);
        if (name) deleteView(name);
      },
    });
  }
  c.push({ kind: 'ACTION', label: 'Refresh every panel', hint: 'R', run: refreshAll });
  c.push({ kind: 'ACTION', label: 'Mark everything as read', hint: '', run: markRead });
  c.push({ kind: 'ACTION', label: 'Scroll to top', hint: 'G', run: () => jump(0) });
  return c;
}

let palItems = [], palSel = 0;
/* Only the first 40 matches are rendered, so selection must stop there too —
   otherwise the highlight and aria-activedescendant point at nothing. */
const PAL_MAX = 40;
const palShown = () => Math.min(palItems.length, PAL_MAX);

let releasePalTrap = null, palReturn = null;

function openPalette() {
  palReturn = document.activeElement;
  const overlay = $('#palette');
  overlay.hidden = false;
  const input = $('#pal-input');
  input.value = '';
  renderPalette('');
  releasePalTrap = trapFocus(overlay);
  input.focus();
}

function closePalette() {
  $('#palette').hidden = true;
  releasePalTrap?.(); releasePalTrap = null;
  if (palReturn?.isConnected) palReturn.focus();
  palReturn = null;
}

function renderPalette(q) {
  const ql = q.trim().toLowerCase();
  palItems = commands().filter((c) => !ql || `${c.label} ${c.hint} ${c.kind}`.toLowerCase().includes(ql));
  palSel = 0;
  drawPalette();
}

function drawPalette() {
  const host = $('#pal-list');
  host.replaceChildren();
  palItems.slice(0, PAL_MAX).forEach((c, i) => {
    const row = el('div', 'pal-item' + (i === palSel ? ' sel' : ''));
    row.id = `pal-opt-${i}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(i === palSel));
    row.appendChild(el('div', 'kind', c.kind));
    row.appendChild(el('div', 'lbl', esc(c.label)));
    if (c.hint) row.appendChild(el('div', 'hint', esc(c.hint)));
    row.onclick = () => { closePalette(); c.run(); };
    host.appendChild(row);
  });
  // The input keeps DOM focus, so the active option must be named explicitly
  // or a screen reader announces nothing as the user arrows through the list.
  $('#pal-input').setAttribute('aria-activedescendant',
    palItems.length ? `pal-opt-${palSel}` : '');
  // Keyboard selection must stay visible; the list scrolls at 44vh.
  host.children[palSel]?.scrollIntoView({ block: 'nearest' });
}

/* ═══ MAP ═════════════════════════════════════════════════════════════════ */
let map = null;

function setLayer(l) {
  map.setLayer(l);
  for (const b of $('#map-layers').children) {
    const on = b.dataset.layer === l;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  drawLegend(l);
}

function drawLegend(k) {
  const legend = $('#map-legend');
  legend.replaceChildren();
  for (const [color, label] of LEGENDS[k] ?? []) {
    const s = el('span');
    const d = el('span', 'dot');
    d.style.background = color;
    s.append(d, document.createTextNode(label));
    legend.appendChild(s);
  }
}

function initMap() {
  map = new WorldMap($('#map'));
  map.load().then(() => map.update(state.data));
  setLayer(map.layer);

  $('#map-layers').onclick = (e) => {
    const b = e.target.closest('button');
    if (b) setLayer(b.dataset.layer);
  };
  $('#zin').onclick = () => map.setZoom(map.zoom * 1.3);
  $('#zout').onclick = () => map.setZoom(map.zoom / 1.3);
  $('#zreset').onclick = () => { map.setZoom(1); map.cx = 0; map.cy = 8; };

  const loop = (t) => { map.draw(t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

/* ═══ CHROME ══════════════════════════════════════════════════════════════ */
function markRead() {
  state.lastSeen = Date.now();
  localStorage.setItem(LAST_SEEN, String(state.lastSeen));
  renderBrief();
}

function initChrome() {
  const tick = () => { $('#zulu').textContent = zulu(); };
  tick();
  setInterval(tick, 1000);

  setInterval(() => {
    for (const [id, ref] of state.panels) {
      const p = state.data[id];
      if (p?.fetchedAt) ref.age.textContent = ago(p.fetchedAt);
    }
  }, 5000);

  $('#digest-more').onclick = () => { state.digestOpen = !state.digestOpen; briefSig = ''; renderBrief(); };
  $('#modes').onclick = (e) => { const b = e.target.closest('.mode'); if (b) setMode(b.dataset.mode); };
  $('#hero-cta').onclick = () => setMode('ops');
  $('#refresh-all').onclick = refreshAll;
  $('#cmd-btn').onclick = openPalette;
  $('#focus').onclick = (e) => { if (e.target.id === 'focus') closeFocus(); };

  const filter = $('#filter');
  filter.oninput = () => { state.filter = filter.value; applyFilter(); };
  $('#filter-clear').onclick = () => { filter.value = ''; state.filter = ''; applyFilter(); };

  $('#pal-input').oninput = (e) => renderPalette(e.target.value);

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);

    if (!$('#palette').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palSel + 1, palShown() - 1); drawPalette(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(palSel - 1, 0); drawPalette(); }
      else if (e.key === 'Enter') { e.preventDefault(); const c = palItems[palSel]; closePalette(); c?.run(); }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (e.key === 'Escape') { closeFocus(); filter.blur(); return; }
    if (typing) return;

    if (e.key === '/') { e.preventDefault(); filter.focus(); }
    else if (e.key >= '1' && e.key <= '5') {
      const b = $('#map-layers').children[+e.key - 1];
      if (b) setLayer(b.dataset.layer);
    }
    else if (e.key.toLowerCase() === 'r') refreshAll();
    else if (e.key.toLowerCase() === 'g') jump(0);
    else if (e.key.toLowerCase() === 'c') setMode(state.mode === 'read' ? 'ops' : 'read');
    else if (e.key.toLowerCase() === 'm') scrollTo($('#hero'));
  });

  // "Seen" must mean read, not merely opened.
  //
  // This previously wrote the marker on every unload, so a two-second glance
  // cleared every NEW badge and the feature never fired. The marker now only
  // advances once you have actually engaged: scrolled, used the keyboard,
  // opened a story, or left the page in front of you for half a minute.
  let engaged = false;
  const engage = () => { engaged = true; };
  $('#body').addEventListener('scroll', engage, { passive: true, once: true });
  $('#digest').addEventListener('click', engage, { once: true });
  document.addEventListener('keydown', engage, { once: true });
  const dwell = setTimeout(() => {
    if (document.visibilityState === 'visible') engaged = true;
  }, 30000);

  const commit = () => {
    if (engaged) localStorage.setItem(LAST_SEEN, String(Date.now()));
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { commit(); rememberView(); }
  });
  window.addEventListener('pagehide', () => { clearTimeout(dwell); commit(); rememberView(); });
}

/* ═══ BOOT ════════════════════════════════════════════════════════════════ */
(async function boot() {
  makeDither();
  initChrome();
  initMap();

  const [cfg, manifest] = await Promise.all([
    fetch('/panels.config.json').then((r) => r.json()),
    fetch('/api/panels').then((r) => r.json()),
  ]);
  state.config = cfg;
  state.manifest = manifest;

  layout();
  setMode(state.mode);
  // Restore where the operator last was — but an explicit ?mode= in the URL
  // is a deliberate override and must win.
  if (!new URLSearchParams(location.search).get('mode')) applyView(lastView());
  await loadAll();
  await loadHistory();
  setInterval(loadHistory, 3600 * 1000);
  schedule();

})();
