#!/usr/bin/env node
/**
 * Builds public/data/basemap.json — the offline basemap for the map screen — from
 * Natural Earth (public domain) 1:50m admin-0 countries + admin-1 lines.
 *
 *   node src/features/map/scripts/build-basemap.mjs [--tolerance 0.035] [--src dir]
 *
 * Downloads from raw.githubusercontent.com unless --src points at local copies.
 * Output (compact, decoded by src/features/map/basemap.ts):
 *   { v: 1, scale: 100, countries: [{ c: ISO-A2, p: [polygon[ring]] }], lines: [ring] }
 * where each ring is a flat delta-encoded integer array in 1/100°. Geometry is
 * Douglas-Peucker simplified; islands below --min-area are dropped.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const TOL = Number(opt('--tolerance', '0.035'));
/** Islands smaller than this (deg²) are dropped – keeps Oahu/Maui, drops specks. */
const MIN_AREA = Number(opt('--min-area', '0.01'));
const SRC = opt('--src', null);
const OUT = opt('--out', 'public/data/basemap.json');
const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';

async function load(name) {
  if (SRC) return JSON.parse(await readFile(join(SRC, `${name}.geojson`), 'utf8'));
  const res = await fetch(`${BASE}${name}.geojson`);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json();
}

function sqSegDist(p, a, b) {
  let [x, y] = a;
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) [x, y] = b;
    else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const sq = tol * tol;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = sqSegDist(pts[i], pts[s], pts[e]);
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > sq) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const r2 = (n) => Math.round(n * 100) / 100;
function cleanLine(line, tol, minPts) {
  const s = simplify(line, tol).map(([x, y]) => [r2(x), r2(y)]);
  const out = s.filter((p, i) => i === 0 || p[0] !== s[i - 1][0] || p[1] !== s[i - 1][1]);
  return out.length >= minPts ? out : null;
}

function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return Math.abs(a / 2);
}

function cleanPolygon(rings) {
  if (ringArea(rings[0]) < MIN_AREA) return null;
  const out = [];
  for (const [i, ring] of rings.entries()) {
    if (i > 0 && ringArea(ring) < MIN_AREA) continue;
    const r = cleanLine(ring, TOL, 4);
    if (r) out.push(r);
    else if (i === 0) return null; // outer ring collapsed – drop the polygon
  }
  return out;
}

/** Flat, delta-encoded integer ring: [x0, y0, dx1, dy1, ...] in 1/100 degrees. */
function encode(line) {
  const out = [];
  let px = 0;
  let py = 0;
  for (const [x, y] of line) {
    const ix = Math.round(x * 100);
    const iy = Math.round(y * 100);
    out.push(ix - px, iy - py);
    px = ix;
    py = iy;
  }
  return out;
}

const countries = await load('ne_50m_admin_0_countries');
const states = await load('ne_50m_admin_1_states_provinces_lines');
const out = { v: 1, scale: 100, countries: [], lines: [] };
let points = 0;

for (const f of countries.features) {
  const p = f.properties;
  let code = p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2;
  if (!code || code === '-99') code = '';
  const g = f.geometry;
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(cleanPolygon).filter(Boolean);
  if (!polys.length) continue;
  points += polys.flat(2).length;
  out.countries.push({ c: code, p: polys.map((rings) => rings.map(encode)) });
}

for (const f of states.features) {
  const g = f.geometry;
  const lines = (g.type === 'LineString' ? [g.coordinates] : g.coordinates).map((l) => cleanLine(l, TOL, 2)).filter(Boolean);
  points += lines.flat().length;
  for (const l of lines) out.lines.push(encode(l));
}

const json = JSON.stringify(out);
await writeFile(OUT, json);
console.log(`${OUT}: ${out.countries.length} countries, ${out.lines.length} admin-1 lines, ${points} points, ${(json.length / 1024).toFixed(0)} KB`);

// ---------- glyphs ----------
// MapLibre symbol layers need SDF glyph PBFs. We only label airports with IATA
// codes, so we bundle the printable-ASCII subset of one font as base64 JSON
// (JSON so the PWA precache picks it up) and serve it via a custom protocol.
const FONT = 'Open Sans Semibold';
const GLYPHS_OUT = opt('--glyphs-out', 'public/data/map-glyphs.json');

function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  let b;
  do {
    b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
  } while (b & 0x80);
  return [result, pos];
}
function writeVarint(n) {
  const out = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}
/** Iterates protobuf fields: yields [fieldNo, wireType, value(Buffer|number), rawBytes]. */
function* fields(buf) {
  let pos = 0;
  while (pos < buf.length) {
    const start = pos;
    let key;
    [key, pos] = readVarint(buf, pos);
    const no = Math.floor(key / 8);
    const wt = key & 7;
    let val;
    if (wt === 0) [val, pos] = readVarint(buf, pos);
    else if (wt === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      val = buf.subarray(pos, pos + len);
      pos += len;
    } else throw new Error(`unsupported wire type ${wt}`);
    yield [no, wt, val, buf.subarray(start, pos)];
  }
}
const lenField = (no, payload) => Buffer.concat([writeVarint(no * 8 + 2), writeVarint(payload.length), payload]);

async function buildGlyphs() {
  const src = SRC ? join(SRC, `${FONT}.pbf`) : null;
  let buf;
  if (src) buf = await readFile(src);
  else {
    const res = await fetch(`https://raw.githubusercontent.com/openmaptiles/fonts/gh-pages/${encodeURIComponent(FONT)}/0-255.pbf`);
    if (!res.ok) throw new Error(`glyphs: ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const stacks = [];
  let kept = 0;
  for (const [no, , stack] of fields(buf)) {
    if (no !== 1) continue;
    const parts = [];
    for (const [fno, , val, raw] of fields(stack)) {
      if (fno !== 3) {
        parts.push(raw);
        continue;
      }
      let id = -1;
      for (const [gno, , gval] of fields(val)) if (gno === 1) id = gval;
      if (id >= 32 && id <= 126) {
        parts.push(raw);
        kept++;
      }
    }
    stacks.push(lenField(1, Buffer.concat(parts)));
  }
  const outBuf = Buffer.concat(stacks);
  await writeFile(GLYPHS_OUT, JSON.stringify({ font: FONT, range: '0-255', pbf: outBuf.toString('base64') }));
  console.log(`${GLYPHS_OUT}: ${kept} glyphs, ${(outBuf.length / 1024).toFixed(0)} KB pbf`);
}
await buildGlyphs();
