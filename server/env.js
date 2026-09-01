// Minimal .env loader. No dependencies, no surprises.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function parse(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val !== '') out[key] = val;
  }
  return out;
}

const file = join(ROOT, '.env');
const fromFile = existsSync(file) ? parse(readFileSync(file, 'utf8')) : {};

// Real environment wins over the file, so you can override at launch.
export const env = { ...fromFile, ...process.env };

export const PORT = Number(env.PORT) || 8787;

// Loopback by default. The proxy holds your API credentials and will spend
// your Radar quota for anyone who can reach it, so it must not land on the LAN
// by accident. Containers set HOST=0.0.0.0 and publish to the host loopback.
export const HOST = env.HOST || '127.0.0.1';

/** True if a credential is present and non-empty. Panels use this to self-upgrade. */
export const has = (key) => typeof env[key] === 'string' && env[key].trim().length > 0;
