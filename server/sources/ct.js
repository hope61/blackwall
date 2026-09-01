import { getJSON } from '../fetchers.js';

// Certificate Transparency firehose.
//
// Calidog's public CertStream is retired, so we tail a CT log directly:
// get-sth for the current tree size, then get-entries for the newest leaves.
// Each leaf is a MerkleTreeLeaf; we walk the DER far enough to pull the
// subject CN and the SAN dNSNames, which is all the panel needs.
const LOG = 'https://ct.googleapis.com/logs/us1/argon2026h2/ct/v1';

// ── minimal DER helpers ─────────────────────────────────────────────────────
const OID_SAN = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x11]);   // 2.5.29.17
const OID_CN  = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]);   // 2.5.4.3

/** Read a DER length at `p`; returns [length, bytesConsumed]. */
function derLen(buf, p) {
  const first = buf[p];
  if (first < 0x80) return [first, 1];
  const n = first & 0x7f;
  if (n === 0 || n > 4 || p + 1 + n > buf.length) return [-1, 1];
  let len = 0;
  for (let i = 0; i < n; i++) len = (len << 8) | buf[p + 1 + i];
  return [len, 1 + n];
}

/** Pull dNSName entries out of a SubjectAltName extension value. */
function namesFromSAN(buf, start, end) {
  const out = [];
  let p = start;
  while (p < end - 1) {
    const tag = buf[p];
    const [len, used] = derLen(buf, p + 1);
    if (len < 0 || p + 1 + used + len > end) break;
    // context-specific [2] primitive = dNSName
    if (tag === 0x82 && len > 0 && len < 256) {
      const s = buf.toString('latin1', p + 1 + used, p + 1 + used + len);
      if (/^[\x20-\x7e]+$/.test(s) && s.includes('.')) out.push(s);
    }
    p += 1 + used + len;
  }
  return out;
}

function parseCert(der) {
  const names = new Set();
  let cn = null;

  // SubjectAltName: OID, optional BOOLEAN, then OCTET STRING wrapping a SEQUENCE.
  let i = der.indexOf(OID_SAN);
  while (i !== -1) {
    let p = i + OID_SAN.length;
    if (der[p] === 0x01) p += 3;                 // skip critical BOOLEAN
    if (der[p] === 0x04) {                       // OCTET STRING
      const [, u1] = derLen(der, p + 1);
      let q = p + 1 + u1;
      if (der[q] === 0x30) {                     // SEQUENCE OF GeneralName
        const [slen, u2] = derLen(der, q + 1);
        const s = q + 1 + u2;
        for (const n of namesFromSAN(der, s, Math.min(s + slen, der.length))) names.add(n);
      }
    }
    i = der.indexOf(OID_SAN, i + 1);
  }

  // Subject CN, for the rare cert with no SAN. Issuer appears before subject
  // in a TBSCertificate, so the LAST CommonName is the one we want -- taking
  // the first yields the CA's name instead of the site's.
  let c = der.lastIndexOf(OID_CN);
  while (c !== -1 && cn == null) {
    let p = c + OID_CN.length;
    if (der[p] === 0x0c || der[p] === 0x13 || der[p] === 0x16) {  // UTF8/Printable/IA5
      const [len, used] = derLen(der, p + 1);
      if (len > 0 && len < 256) {
        const s = der.toString('utf8', p + 1 + used, p + 1 + used + len);
        // Must look like a hostname, else we picked up an org unit or CA name.
        if (/^[\x20-\x7e]+$/.test(s) && s.includes('.') && !/\s/.test(s)) {
          cn = s;
          names.add(s);
        }
      }
    }
    c = der.lastIndexOf(OID_CN, c - 1);
  }
  return { cn, names: [...names] };
}

/** MerkleTreeLeaf -> { timestamp, precert, der } */
function parseLeaf(b64) {
  const b = Buffer.from(b64, 'base64');
  if (b.length < 15) return null;
  const timestamp = Number(b.readBigUInt64BE(2));
  const entryType = b.readUInt16BE(10);          // 0 = x509, 1 = precert
  let p = 12;
  if (entryType === 1) p += 32;                  // skip issuer_key_hash
  const len = (b[p] << 16) | (b[p + 1] << 8) | b[p + 2];
  p += 3;
  if (len <= 0 || p + len > b.length) return null;
  return { timestamp, precert: entryType === 1, der: b.subarray(p, p + len) };
}

const registrable = (d) => {
  const parts = d.replace(/^\*\./, '').split('.');
  return parts.slice(-2).join('.');
};

export default {
  id: 'ct',
  label: 'CERTIFICATE TRANSPARENCY',
  ttl: 60,
  span: 2,
  async fetch() {
    const sth = await getJSON(`${LOG}/get-sth`, { timeout: 15000 });
    const size = sth.tree_size;

    const COUNT = 48;
    const start = Math.max(0, size - COUNT);
    const res = await getJSON(`${LOG}/get-entries?start=${start}&end=${size - 1}`, { timeout: 25000 });

    const rawEntries = res.entries ?? [];
    const certs = [];
    for (const e of rawEntries) {
      const leaf = parseLeaf(e.leaf_input);
      if (!leaf) continue;
      const { cn, names } = parseCert(leaf.der);
      if (!names.length) continue;
      certs.push({
        cn: names[0] ?? cn,
        names: names.slice(0, 8),
        extra: Math.max(0, names.length - 8),
        precert: leaf.precert,
        ts: leaf.timestamp,
      });
    }
    certs.reverse();   // newest first

    // Which registrable domains dominate this slice of the firehose.
    const tally = {};
    for (const c of certs) for (const n of c.names) {
      const r = registrable(n);
      tally[r] = (tally[r] ?? 0) + 1;
    }

    return {
      log: 'argon2026h2',
      treeSize: size,
      sthTimestamp: sth.timestamp,
      returned: rawEntries.length,
      sampled: certs.length,
      certs: certs.slice(0, 30),
      topDomains: Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => ({ k, n })),
      uniqueNames: new Set(certs.flatMap((c) => c.names)).size,
    };
  },
};
