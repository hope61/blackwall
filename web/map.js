// Hero map. Canvas, equirectangular, white hairlines on black — the analogue
// of the console reference's 3D city: one large spatial object anchoring the
// field of small data panels.
import { el } from './ui.js';

const TAU = Math.PI * 2;

export class WorldMap {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = null;
    this.data = {};
    this.layer = (location.hash.match(/layer=(\w+)/) || [])[1] || 'threat';
    this.zoom = 1;
    this.cx = 0;          // centre longitude
    this.cy = 8;          // centre latitude, biased north where the land is
    this.t = 0;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);

    this._drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      this._drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this._drag) return;
      const s = this.scale();
      this.cx = this._drag.cx - (e.clientX - this._drag.x) / s;
      while (this.cx > 180) this.cx -= 360;
      while (this.cx < -180) this.cx += 360;
      this.cy = this._drag.cy + (e.clientY - this._drag.y) / s;
      this.cy = Math.max(-70, Math.min(80, this.cy));
    });
    const end = () => { this._drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    }, { passive: false });

    // Pan and zoom were pointer-only, which left the map's entire content
    // unreachable without a mouse. Arrows pan, +/- zoom, 0 resets.
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label',
      'World map. Arrow keys pan, plus and minus zoom, 0 resets the view.');
    canvas.addEventListener('keydown', (e) => {
      const step = (e.shiftKey ? 24 : 8) / this.zoom;
      const pan = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (pan) {
        this.cx += pan[0]; this.cy += pan[1];
        while (this.cx > 180) this.cx -= 360;
        while (this.cx < -180) this.cx += 360;
        this.cy = Math.max(-70, Math.min(80, this.cy));
      } else if (e.key === '+' || e.key === '=') this.setZoom(this.zoom * 1.3);
      else if (e.key === '-' || e.key === '_') this.setZoom(this.zoom / 1.3);
      else if (e.key === '0') { this.setZoom(1); this.cx = 0; this.cy = 8; }
      else return;
      e.preventDefault();
    });

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setZoom(z) { this.zoom = Math.max(1, Math.min(8, z)); }

  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width) return;
    // Re-read DPR on every resize: dragging the window to a monitor with a
    // different pixel ratio changes it, and a stale value renders soft.
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width; this.h = r.height;
    this.c.width = Math.round(r.width * this.dpr);
    this.c.height = Math.round(r.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Base scale fits the full world into the panel; zoom multiplies it. */
  fitScale() { return Math.min(this.w / 360, this.h / 165); }
  scale() { return this.fitScale() * this.zoom; }

  /** Raw projection. Longitude is NOT wrapped, so callers can draw the world
   *  at -360/0/+360 offsets for seamless panning. Used for land geometry. */
  proj(lon, lat) {
    const s = this.scale();
    return [this.w / 2 + (lon - this.cx) * s, this.h / 2 - (lat - this.cy) * s];
  }

  /** Point projection: picks whichever world copy is nearest the view centre.
   *  Used for markers, arcs and overlays, which are single points not paths. */
  projPt(lon, lat) {
    let dx = lon - this.cx;
    while (dx > 180) dx -= 360;
    while (dx < -180) dx += 360;
    const s = this.scale();
    return [this.w / 2 + dx * s, this.h / 2 - (lat - this.cy) * s];
  }

  async load() {
    this.world = await (await fetch('assets/world.json')).json();
    // Centroid per ISO code, so country-coded data can be placed without a join table.
    this.centroids = {};
    for (const f of this.world) {
      if (!f.cc) continue;
      let sx = 0, sy = 0, n = 0;
      for (const poly of f.p) for (const [x, y] of poly[0]) { sx += x; sy += y; n++; }
      if (n) this.centroids[f.cc] = [sx / n, sy / n];
    }
  }

  update(data) { this.data = data; }

  setLayer(l) {
    this.layer = l;
    // Cable geometry is half a megabyte; fetch it the first time it is asked
    // for rather than on every page load.
    if (l === 'cables' && !this.cableGeo && !this._cableLoading) {
      this._cableLoading = true;
      fetch('/api/geo/cables')
        .then((r) => r.json())
        .then((j) => { this.cableGeo = j.data; })
        .catch((e) => console.warn('[map] cable geometry', e))
        .finally(() => { this._cableLoading = false; });
    }
  }

  centroid(cc) { return this.centroids?.[String(cc ?? '').toUpperCase()] ?? null; }

  /* ── drawing ─────────────────────────────────────────────────────────── */

  draw(t) {
    const { ctx, w, h } = this;
    if (!w) return;
    this.t = t;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, w, h);

    this.grid();
    this.land();

    const L = this.layer;
    if (L === 'threat') this.threat();
    else if (L === 'cables') this.cables();
    else if (L === 'tor') this.tor();
    else if (L === 'outage') this.outages();
    else if (L === 'orbit') this.orbit();

    this.egress();
  }

  grid() {
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(255,255,255,.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Meridians are relative to the current centre so they survive panning.
    const base = Math.round(this.cx / 30) * 30;
    for (let lon = base - 180; lon <= base + 180; lon += 30) {
      const [x] = this.proj(lon, 0);
      if (x < -20 || x > this.w + 20) continue;
      ctx.moveTo(x, 0); ctx.lineTo(x, this.h);
    }
    for (let lat = -60; lat <= 80; lat += 30) {
      const [, y] = this.proj(0, lat);
      ctx.moveTo(0, y); ctx.lineTo(this.w, y);
    }
    ctx.stroke();

    // equator, slightly hotter
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath();
    const [, ye] = this.proj(0, 0);
    ctx.moveTo(0, ye); ctx.lineTo(this.w, ye);
    ctx.stroke();
  }

  land() {
    const { ctx } = this;
    if (!this.world) return;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.30)';
    ctx.fillStyle = 'rgba(255,255,255,.030)';

    // Draw at three longitude offsets so panning wraps seamlessly.
    for (const shift of [-360, 0, 360]) {
      for (const f of this.world) {
        for (const poly of f.p) {
          for (const ring of poly) {
            ctx.beginPath();
            let started = false, visible = false, prevLon = null;
            for (const [lon, lat] of ring) {
              const [x, y] = this.proj(lon + shift, lat);
              if (x > -60 && x < this.w + 60) visible = true;
              // Countries spanning the antimeridian (Russia, Fiji) would other-
              // wise draw a straight line across the whole map. Break the path.
              const jump = prevLon != null && Math.abs(lon - prevLon) > 180;
              if (!started || jump) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
              prevLon = lon;
            }
            if (!visible) continue;
            ctx.fill();
            ctx.stroke();
          }
        }
      }
    }
  }

  /** Marker: hollow square + label, from the console reference. */
  marker(lon, lat, label, tone = '#f2f2f2', size = 4) {
    const { ctx } = this;
    const [x, y] = this.projPt(lon, lat);
    if (x < -40 || x > this.w + 40 || y < -20 || y > this.h + 20) return;
    ctx.strokeStyle = tone;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - size / 2, y - size / 2, size, size);
    if (label && this.zoom > 1.15) {
      ctx.fillStyle = 'rgba(242,242,242,.75)';
      ctx.font = '7px JBM, monospace';
      ctx.fillText(label, x + size, y - size);
    }
  }

  /** Great-circle-ish arc with a travelling pulse. */
  arc(a, b, tone, phase = 0) {
    const { ctx } = this;
    const [x1, y1] = this.projPt(a[0], a[1]);
    const [x2, y2] = this.projPt(b[0], b[1]);
    if (Math.abs(x2 - x1) > this.w * 1.5) return;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.22;

    ctx.strokeStyle = tone;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(mx, my, x2, y2);
    ctx.stroke();

    // pulse travelling along the arc
    const p = ((this.t / 2600) + phase) % 1;
    const q = 1 - p;
    const px = q * q * x1 + 2 * q * p * mx + p * p * x2;
    const py = q * q * y1 + 2 * q * p * my + p * p * y2;
    ctx.fillStyle = '#e8b93a';
    ctx.beginPath();
    ctx.arc(px, py, 1.6, 0, TAU);
    ctx.fill();
  }

  /* ── layers ──────────────────────────────────────────────────────────── */

  threat() {
    const { ctx } = this;
    const atk = this.data.attacks?.data;
    const rw = this.data.ransomware?.data;

    // Attack origin -> target arcs, weighted by Radar's share percentages.
    if (atk?.origins?.length && atk?.targets?.length) {
      const tg = atk.targets.slice(0, 3);
      atk.origins.slice(0, 8).forEach((o, i) => {
        const a = this.centroid(o.cc);
        if (!a) return;
        tg.forEach((t, j) => {
          const b = this.centroid(t.cc);
          if (!b || t.cc === o.cc) return;
          this.arc(a, b, `rgba(232,185,58,${0.10 + Math.min(0.30, o.pct / 60)})`, (i * 0.13 + j * 0.31));
        });
      });
      for (const o of atk.origins.slice(0, 10)) {
        const c = this.centroid(o.cc);
        if (c) this.marker(c[0], c[1], `${o.cc} ${o.pct}%`, 'rgba(232,185,58,.8)');
      }
    }

    // Ransomware victim density
    if (rw?.geo) {
      for (const g of rw.geo.slice(0, 22)) {
        const c = this.centroid(g.cc);
        if (!c) continue;
        const [x, y] = this.projPt(c[0], c[1]);
        const r = 2 + Math.min(9, Math.sqrt(g.count) * 1.7);
        ctx.strokeStyle = 'rgba(196,72,63,.55)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      }
    }
  }

  cables() {
    const cb = this.cableGeo;
    const { ctx } = this;
    if (!cb) {
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.font = '9px JBM, monospace';
      ctx.fillText('LOADING CABLE GEOMETRY…', 18, this.h - 18);
      return;
    }

    // Cable routes as hairlines, drawn at three world offsets so trans-Pacific
    // systems stay continuous when the view wraps.
    if (cb.routes) {
      ctx.strokeStyle = 'rgba(150,190,220,.34)';
      ctx.lineWidth = 1;
      for (const shift of [-360, 0, 360]) {
        ctx.beginPath();
        for (const line of cb.routes) {
          let started = false, visible = false, prevLon = null;
          for (const [lon, lat] of line) {
            const [x, y] = this.proj(lon + shift, lat);
            if (x > -40 && x < this.w + 40) visible = true;
            const jump = prevLon != null && Math.abs(lon - prevLon) > 180;
            if (!started || jump) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
            prevLon = lon;
          }
          if (!visible) continue;
        }
        ctx.stroke();
      }
    }

    if (!cb.landings) return;
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    for (const p of cb.landings) {
      const [x, y] = this.projPt(p.lon, p.lat);
      if (x < -10 || x > this.w + 10 || y < -10 || y > this.h + 10) continue;
      ctx.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
    }
    if (this.zoom > 2) {
      for (const p of cb.landings.slice(0, 400)) this.marker(p.lon, p.lat, p.place, 'rgba(255,255,255,.25)', 3);
    }
  }

  tor() {
    const t = this.data.tor?.data;
    if (!t?.geo) return;
    const { ctx } = this;
    const max = Math.max(...t.geo.map((g) => g.count), 1);
    // The US alone holds ~a third of all exits, so a linear scale renders every
    // other country at a couple of near-transparent pixels. Square-root the
    // ratio and floor the radius and alpha so small operators stay legible.
    for (const g of t.geo) {
      const c = this.centroid(g.cc);
      if (!c) continue;
      const [x, y] = this.projPt(c[0], c[1]);
      const k = Math.sqrt(g.count / max);
      const r = 3.5 + k * 17;
      const a = 0.34 + k * 0.46;
      ctx.fillStyle = `rgba(120,200,160,${a * 0.30})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(120,200,160,${a})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      if (this.zoom > 1.15) this.marker(c[0], c[1], `${g.cc} ${g.count}`, 'rgba(120,200,160,.55)', 3);
    }
  }

  outages() {
    const o = this.data.outages?.data;
    if (!o?.geo?.length) return;
    const { ctx } = this;
    const pulse = 0.5 + 0.5 * Math.sin(this.t / 420);
    for (const g of o.geo) {
      const c = this.centroid(g.cc);
      if (!c) continue;
      const [x, y] = this.projPt(c[0], c[1]);
      const tone = g.cause === 'STATE DIRECTED' ? '196,72,63' : '232,185,58';
      ctx.strokeStyle = `rgba(${tone},${g.ongoing ? 0.35 + pulse * 0.5 : 0.35})`;
      ctx.lineWidth = 1;
      for (const r of [7, 13, 19]) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
      this.marker(c[0], c[1], `${g.cc} ${g.cause}`, `rgba(${tone},.9)`, 5);
    }
  }

  orbit() {
    const o = this.data.orbital?.data;
    if (!o?.iss) return;
    const { ctx } = this;
    const { lat, lon } = o.iss;

    // Approximate ground track: 51.6° inclination sine wave through the ISS.
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let first = true, prevX = null;
    for (let d = -180; d <= 180; d += 2) {
      const l = lon + d;
      const la = 51.6 * Math.sin(((l - lon) * Math.PI) / 180 + Math.asin(Math.max(-1, Math.min(1, lat / 51.6))));
      const [x, y] = this.projPt(l, la);
      // projPt wraps into the nearest world copy, so the track teleports across
      // the view when it passes the edge. The jump is half a WORLD wide, which
      // can be much less than half the viewport when zoomed out -- comparing
      // against viewport width silently misses it.
      const wrapped = prevX != null && Math.abs(x - prevX) > 180 * this.scale();
      if (first || wrapped) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      prevX = x;
    }
    ctx.stroke();

    // Footprint
    const [x, y] = this.projPt(lon, lat);
    const fr = (o.iss.footprint / 2 / 111) * this.scale();
    ctx.strokeStyle = 'rgba(232,185,58,.35)';
    ctx.beginPath(); ctx.arc(x, y, fr, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(232,185,58,.07)';
    ctx.fill();

    this.marker(lon, lat, `ISS ${Math.round(o.iss.altitude)}KM`, '#e8b93a', 7);
  }

  egress() {
    const e = this.data.egress?.data;
    if (!e?.lat) return;
    const { ctx } = this;
    const [x, y] = this.projPt(e.lon, e.lat);
    const pulse = (this.t / 1800) % 1;
    ctx.strokeStyle = `rgba(75,163,107,${0.6 * (1 - pulse)})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, 4 + pulse * 16, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#4ba36b';
    ctx.fillRect(x - 2, y - 2, 4, 4);
    ctx.fillStyle = 'rgba(242,242,242,.8)';
    ctx.font = '7px JBM, monospace';
    ctx.fillText('YOU', x + 6, y - 4);
  }
}

export const LEGENDS = {
  threat: [['#e8b93a', 'ATTACK ORIGIN'], ['#c4483f', 'RANSOMWARE DENSITY']],
  cables: [['#ffffff', 'CABLE LANDING']],
  tor:    [['#78c8a0', 'EXIT NODE DENSITY']],
  outage: [['#c4483f', 'STATE DIRECTED'], ['#e8b93a', 'OTHER CAUSE']],
  orbit:  [['#e8b93a', 'ISS + FOOTPRINT']],
};
