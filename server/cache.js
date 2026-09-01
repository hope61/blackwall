// TTL cache with stale-while-revalidate and on-disk spill.
//
// The contract that matters for the UI: we ALWAYS hand back the last good
// value if we have one, tagged with how old it is. A panel must be able to
// tell "upstream is down, here is stale data" apart from "upstream says zero".
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.js';

const DIR = join(ROOT, '.cache');
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

const mem = new Map();          // id -> { data, at, error }
const inflight = new Map();     // id -> Promise

const diskPath = (id) => join(DIR, `${id.replace(/[^a-z0-9_-]/gi, '_')}.json`);

function loadDisk(id) {
  try {
    if (!existsSync(diskPath(id))) return null;
    return JSON.parse(readFileSync(diskPath(id), 'utf8'));
  } catch { return null; }
}

function saveDisk(id, entry) {
  try { writeFileSync(diskPath(id), JSON.stringify(entry)); } catch { /* disk cache is best-effort */ }
}

/**
 * @param {string} id       cache key
 * @param {number} ttl      seconds before the value is considered due for refresh
 * @param {Function} producer  async () => data
 * @returns {{data:any, age:number, state:'NOMINAL'|'STALE'|'FAULT', fetchedAt:string, error?:string}}
 */
export async function cached(id, ttl, producer) {
  let entry = mem.get(id) ?? loadDisk(id);
  if (entry) mem.set(id, entry);

  const now = Date.now();
  const age = entry ? (now - entry.at) / 1000 : Infinity;

  // Fresh enough — serve immediately.
  if (entry && age < ttl && !entry.error) {
    return shape(entry, age, ttl);
  }

  // Stale but present: kick off a background refresh and serve what we have.
  // Only block when we have nothing at all to show.
  const refresh = () => {
    if (inflight.has(id)) return inflight.get(id);
    const p = (async () => {
      try {
        const data = await producer();
        const next = { data, at: Date.now(), error: null };
        mem.set(id, next); saveDisk(id, next);
        return next;
      } catch (err) {
        const prev = mem.get(id);
        const next = prev
          ? { ...prev, error: String(err?.message ?? err) }   // keep last good data
          : { data: null, at: Date.now(), error: String(err?.message ?? err) };
        mem.set(id, next); saveDisk(id, next);
        return next;
      } finally {
        inflight.delete(id);
      }
    })();
    inflight.set(id, p);
    return p;
  };

  if (!entry || entry.data == null) {
    const fresh = await refresh();
    return shape(fresh, 0, ttl);
  }

  refresh(); // fire and forget
  return shape(entry, age, ttl);
}

function shape(entry, age, ttl) {
  const a = Number.isFinite(age) ? age : (Date.now() - entry.at) / 1000;
  let state = 'NOMINAL';
  if (entry.error && entry.data == null) state = 'FAULT';
  else if (entry.error || a > ttl * 2) state = 'STALE';
  return {
    data: entry.data,
    age: Math.round(a),
    state,
    fetchedAt: new Date(entry.at).toISOString(),
    ...(entry.error ? { error: entry.error } : {}),
  };
}

export function peek(id) { return mem.get(id) ?? loadDisk(id); }
