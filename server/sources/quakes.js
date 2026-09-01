import { getJSON } from '../fetchers.js';

export default {
  id: 'quakes',
  label: 'SEISMIC ACTIVITY',
  ttl: 900,
  async fetch() {
    const j = await getJSON('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson');

    const events = (j.features ?? []).map((f) => ({
      mag: f.properties.mag,
      place: f.properties.place,
      time: f.properties.time,
      depth: f.geometry.coordinates[2],
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      tsunami: !!f.properties.tsunami,
      url: f.properties.url,
    })).sort((a, b) => b.time - a.time);

    return {
      events,
      count: events.length,
      strongest: events.length ? [...events].sort((a, b) => b.mag - a.mag)[0] : null,
      // Coastal quakes are the ones that threaten submarine cable landings.
      tsunamiFlags: events.filter((e) => e.tsunami).length,
      window: '24h',
      threshold: 4.5,
    };
  },
};
