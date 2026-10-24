// Read activity files exported from Garmin Connect: .fit, .zip (Export Original), .gpx, .tcx.

const FIT_EPOCH = Date.UTC(1989, 11, 31) / 1000;
const FIT_SPORTS = {
  0: 'Workout', 1: 'Run', 2: 'Ride', 4: 'Workout', 5: 'Swim', 6: 'Basketball', 7: 'Soccer', 8: 'Tennis',
  10: 'WeightTraining', 11: 'Walk', 12: 'NordicSki', 13: 'AlpineSki', 14: 'Snowboard', 15: 'Rowing',
  16: 'Mountaineering', 17: 'Hike', 19: 'Paddle', 21: 'InlineSkate', 22: 'RockClimbing', 31: 'RockClimbing',
  37: 'StandUpPaddling', 53: 'Swim', 62: 'HighIntensityIntervalTraining', 63: 'Padel', 64: 'Pickleball',
};

// Minimal FIT decoder: walks every record, keeps the session messages.
export function parseFit(buf) {
  const dv = new DataView(buf);
  const headerSize = dv.getUint8(0);
  const sig = String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11));
  if (sig !== '.FIT') throw new Error('Not a FIT file');
  const dataSize = dv.getUint32(4, true);
  const end = Math.min(headerSize + dataSize, buf.byteLength);
  const defs = {};
  const sessions = [];
  let pos = headerSize;

  const readField = (p, size, base, little) => {
    const t = base & 0x1f;
    switch (t) {
      case 0: case 2: case 10: case 13: return size === 1 ? dv.getUint8(p) : null;
      case 1: return dv.getInt8(p);
      case 3: return size >= 2 ? dv.getInt16(p, little) : null;
      case 4: case 11: return size >= 2 ? dv.getUint16(p, little) : null;
      case 5: return size >= 4 ? dv.getInt32(p, little) : null;
      case 6: case 12: return size >= 4 ? dv.getUint32(p, little) : null;
      case 8: return size >= 4 ? dv.getFloat32(p, little) : null;
      default: return null;
    }
  };
  const INVALID = { 2: 0xff, 0: 0xff, 4: 0xffff, 6: 0xffffffff, 11: 0, 12: 0, 3: 0x7fff, 5: 0x7fffffff, 1: 0x7f };

  while (pos < end) {
    const h = dv.getUint8(pos++);
    if (h & 0x80) {
      // compressed timestamp header: data message
      const local = (h >> 5) & 0x03;
      const def = defs[local];
      if (!def) throw new Error('Bad FIT file');
      pos += def.size;
      continue;
    }
    const local = h & 0x0f;
    if (h & 0x40) {
      // definition message
      const hasDev = h & 0x20;
      const little = dv.getUint8(pos + 1) === 0;
      const global = dv.getUint16(pos + 2, little);
      const n = dv.getUint8(pos + 4);
      pos += 5;
      const fields = [];
      let size = 0;
      for (let i = 0; i < n; i++) {
        const f = { num: dv.getUint8(pos), size: dv.getUint8(pos + 1), base: dv.getUint8(pos + 2), off: size };
        fields.push(f);
        size += f.size;
        pos += 3;
      }
      if (hasDev) {
        const nd = dv.getUint8(pos++);
        for (let i = 0; i < nd; i++) { size += dv.getUint8(pos + 1); pos += 3; }
      }
      defs[local] = { global, little, fields, size };
    } else {
      const def = defs[local];
      if (!def) throw new Error('Bad FIT file');
      if (def.global === 18) {
        const m = {};
        for (const f of def.fields) {
          const v = readField(pos + f.off, f.size, f.base, def.little);
          if (v != null && v !== INVALID[f.base & 0x1f]) m[f.num] = v;
        }
        sessions.push(m);
      }
      pos += def.size;
    }
  }
  return sessions.map(s => ({
    start: s[2] != null ? (s[2] + FIT_EPOCH) * 1000 : null,
    type: FIT_SPORTS[s[5]] || 'Workout',
    durationSec: s[8] != null ? s[8] / 1000 : (s[7] != null ? s[7] / 1000 : null),
    distanceM: s[9] != null ? s[9] / 100 : null,
    kcal: s[11] ?? null,
    avgHr: s[16] ?? null,
    maxHr: s[17] ?? null,
    elevGain: s[22] ?? null,
  })).filter(s => s.start);
}

// Unzip (Garmin's "Export Original" is a .zip with one .fit inside).
async function unzipFirstFit(buf) {
  const dv = new DataView(buf);
  let p = 0;
  while (p + 30 <= buf.byteLength && dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true);
    let csize = dv.getUint32(p + 18, true);
    const nlen = dv.getUint16(p + 26, true), xlen = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 30, nlen));
    const start = p + 30 + nlen + xlen;
    if (dv.getUint16(p + 6, true) & 0x08 && csize === 0) {
      // sizes live in the central directory
      csize = centralSize(dv, name) ?? (buf.byteLength - start);
    }
    const data = buf.slice(start, start + csize);
    if (/\.fit$/i.test(name)) {
      if (method === 0) return data;
      if (method === 8) {
        if (!('DecompressionStream' in window)) throw new Error('This browser cannot open .zip files. Unzip it first.');
        const s = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return await new Response(s).arrayBuffer();
      }
    }
    p = start + csize;
  }
  throw new Error('No .fit file inside that zip.');
}

function centralSize(dv, want) {
  for (let p = dv.byteLength - 22; p >= 0; p--) {
    if (dv.getUint32(p, true) !== 0x06054b50) continue;
    let c = dv.getUint32(p + 16, true);
    const n = dv.getUint16(p + 10, true);
    for (let i = 0; i < n; i++) {
      const csize = dv.getUint32(c + 20, true);
      const nlen = dv.getUint16(c + 28, true), xlen = dv.getUint16(c + 30, true), clen = dv.getUint16(c + 32, true);
      const name = new TextDecoder().decode(new Uint8Array(dv.buffer, c + 46, nlen));
      if (name === want) return csize;
      c += 46 + nlen + xlen + clen;
    }
  }
  return null;
}

function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const pts = [...doc.getElementsByTagName('trkpt')].map(p => ({
    lat: +p.getAttribute('lat'), lon: +p.getAttribute('lon'),
    t: Date.parse((p.getElementsByTagName('time')[0] || {}).textContent),
    ele: parseFloat((p.getElementsByTagName('ele')[0] || {}).textContent),
  }));
  if (!pts.length) throw new Error('No track points in that GPX file.');
  let dist = 0, gain = 0;
  for (let i = 1; i < pts.length; i++) {
    dist += haversine(pts[i - 1], pts[i]);
    const d = pts[i].ele - pts[i - 1].ele;
    if (d > 0) gain += d;
  }
  const type = ((doc.getElementsByTagName('type')[0] || {}).textContent || '').toLowerCase();
  const name = (doc.querySelector('trk > name') || doc.getElementsByTagName('name')[0] || {}).textContent;
  return [{
    start: pts[0].t, name,
    type: /run/.test(type) ? 'Run' : /cycl|bik|ride/.test(type) ? 'Ride' : /walk/.test(type) ? 'Walk' : /hik/.test(type) ? 'Hike' : 'Workout',
    durationSec: (pts[pts.length - 1].t - pts[0].t) / 1000 || null,
    distanceM: dist, elevGain: isNaN(gain) ? null : gain, kcal: null, avgHr: null,
  }];
}

function parseTcx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  return [...doc.getElementsByTagName('Activity')].map(a => {
    const laps = [...a.getElementsByTagName('Lap')];
    const sum = tag => laps.reduce((n, l) => n + (parseFloat((l.getElementsByTagName(tag)[0] || {}).textContent) || 0), 0);
    const hrs = laps.map(l => parseFloat((l.querySelector('AverageHeartRateBpm Value') || {}).textContent)).filter(x => x > 0);
    const sport = (a.getAttribute('Sport') || '').toLowerCase();
    return {
      start: Date.parse(laps[0] ? laps[0].getAttribute('StartTime') : (a.getElementsByTagName('Id')[0] || {}).textContent),
      type: sport === 'running' ? 'Run' : sport === 'biking' ? 'Ride' : 'Workout',
      durationSec: sum('TotalTimeSeconds'), distanceM: sum('DistanceMeters'), kcal: sum('Calories') || null,
      avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b) / hrs.length) : null, elevGain: null,
    };
  }).filter(x => x.start);
}

export async function readActivityFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.gpx')) return parseGpx(await file.text());
  if (name.endsWith('.tcx')) return parseTcx(await file.text());
  let buf = await file.arrayBuffer();
  if (name.endsWith('.zip')) buf = await unzipFirstFit(buf);
  return parseFit(buf);
}
