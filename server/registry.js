// Panel sources are auto-discovered: drop a file in sources/ and it exists.
// That is the whole modularity contract — no central list to keep in sync.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.js';

const dir = join(ROOT, 'server', 'sources');

export const sources = new Map();

for (const file of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
  const mod = await import(new URL(`./sources/${file}`, import.meta.url).href);
  const src = mod.default;
  if (!src?.id || typeof src.fetch !== 'function') {
    console.warn(`[registry] skipping ${file}: needs { id, fetch }`);
    continue;
  }
  sources.set(src.id, { ttl: 300, label: src.id.toUpperCase(), ...src });
}

console.log(`[registry] ${sources.size} sources: ${[...sources.keys()].join(' ')}`);
