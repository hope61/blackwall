import { getJSON, settle } from '../fetchers.js';

// Where this machine appears from the outside. The only panel that is about you.
export default {
  id: 'egress',
  label: 'EGRESS POSTURE',
  ttl: 300,
  async fetch({ env }) {
    const r = await settle({
      ip:  getJSON('https://ipinfo.io/json', { timeout: 10000 }),
      dns: getJSON('https://edns.ip-api.com/json', { timeout: 10000 }),
    });

    const i = r.ip ?? {};
    const [lat, lon] = (i.loc ?? ',').split(',');

    const asn = (i.org ?? '').match(/^AS(\d+)\s+(.*)$/);

    return {
      ip: i.ip ?? null,
      city: i.city ?? null,
      region: i.region ?? null,
      cc: i.country ?? null,
      asn: asn ? Number(asn[1]) : null,
      asName: asn ? asn[2] : (i.org ?? null),
      hostname: i.hostname ?? null,
      lat: lat ? Number(lat) : (env.OPERATOR_LAT ? Number(env.OPERATOR_LAT) : null),
      lon: lon ? Number(lon) : (env.OPERATOR_LON ? Number(env.OPERATOR_LON) : null),
      timezone: i.timezone ?? null,
      // Which resolver actually egresses your DNS — reveals VPN/DoH split.
      resolver: r.dns?.dns ? { ip: r.dns.dns.ip, cc: r.dns.dns.geo ?? null } : null,
      privacy: {
        // ipinfo's free tier omits the privacy block; infer what we can.
        hostingLikely: /hosting|cloud|amazon|google|microsoft|digitalocean|hetzner|ovh|linode|vultr/i.test(i.org ?? ''),
        torExit: false,   // joined against the tor panel client-side
      },
    };
  },
};
