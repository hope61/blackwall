import dgram from 'node:dgram';

// The 13 root server letters. We do not scrape anyone's status page for this —
// we send real DNS queries and time the responses ourselves.
const ROOTS = [
  ['A', '198.41.0.4',     'Verisign'],
  ['B', '170.247.170.2',  'USC-ISI'],
  ['C', '192.33.4.12',    'Cogent'],
  ['D', '199.7.91.13',    'U. Maryland'],
  ['E', '192.203.230.10', 'NASA Ames'],
  ['F', '192.5.5.241',    'ISC'],
  ['G', '192.112.36.4',   'US DoD NIC'],
  ['H', '198.97.190.53',  'US Army'],
  ['I', '192.36.148.17',  'Netnod'],
  ['J', '192.58.128.30',  'Verisign'],
  ['K', '193.0.14.129',   'RIPE NCC'],
  ['L', '199.7.83.42',    'ICANN'],
  ['M', '202.12.27.33',   'WIDE'],
];

// Query for "." NS — the smallest meaningful thing a root server can answer.
function query(id) {
  const b = Buffer.alloc(17);
  b.writeUInt16BE(id, 0);
  b.writeUInt16BE(0x0100, 2);  // standard query, recursion desired off is fine
  b.writeUInt16BE(1, 4);       // QDCOUNT
  b.writeUInt8(0, 12);         // root label
  b.writeUInt16BE(2, 13);      // QTYPE = NS
  b.writeUInt16BE(1, 15);      // QCLASS = IN
  return b;
}

function probe(ip, timeout = 3000) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const id = Math.floor(Math.random() * 65535);
    const t0 = process.hrtime.bigint();
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.close(); } catch { /* already closed */ }
      resolve(result);
    };

    const timer = setTimeout(() => finish({ ok: false, rtt: null, error: 'timeout' }), timeout);

    sock.on('message', (msg) => {
      if (msg.length < 12 || msg.readUInt16BE(0) !== id) return;
      const rtt = Number(process.hrtime.bigint() - t0) / 1e6;
      const answers = msg.readUInt16BE(6);
      finish({ ok: true, rtt: +rtt.toFixed(1), answers });
    });
    sock.on('error', (e) => finish({ ok: false, rtt: null, error: e.message }));

    try { sock.send(query(id), 53, ip); }
    catch (e) { finish({ ok: false, rtt: null, error: e.message }); }
  });
}

export default {
  id: 'rootdns',
  label: 'ROOT NAMESERVERS',
  ttl: 120,
  span: 2,
  async fetch() {
    const results = await Promise.all(ROOTS.map(async ([letter, ip, operator]) => {
      const r = await probe(ip);
      return {
        letter, ip, operator,
        status: r.ok ? (r.rtt > 250 ? 'DEGRADED' : 'NOMINAL') : 'UNREACHABLE',
        rtt: r.rtt,
        answers: r.answers ?? 0,
        error: r.error ?? null,
      };
    }));

    const up = results.filter((r) => r.status !== 'UNREACHABLE');
    const rtts = up.map((r) => r.rtt).filter((x) => x != null).sort((a, b) => a - b);

    return {
      servers: results,
      reachable: up.length,
      total: results.length,
      medianRtt: rtts.length ? rtts[Math.floor(rtts.length / 2)] : null,
      fastest: up.length ? up.reduce((a, b) => (a.rtt <= b.rtt ? a : b)) : null,
      probedAt: new Date().toISOString(),
    };
  },
};
