#!/usr/bin/env node
/**
 * Generates the app icons (PNG) and favicon.svg from a single SVG definition, rendered with
 * Playwright's chromium. Run:  node scripts/make-icons.mjs
 * (set CHROMIUM_PATH to use a specific chromium binary).
 *
 * The mark: a sky-blue airliner climbing away from its departure point along a smooth amber flight
 * path (a circular arc that leaves the ringed departure dot almost level and curves up to meet the
 * plane's heading) — on a night-sky tile. Bold shapes only, so it still reads at 16×16; every
 * important shape sits inside the maskable safe zone (80% circle).
 *
 * Outputs (committed):
 *   public/favicon.svg, public/icons/icon.svg
 *   public/icons/icon-192.png, icon-512.png            rounded tile, transparent corners ("any")
 *   public/icons/icon-maskable-512.png                 full-bleed, art in the safe zone ("maskable")
 *   public/icons/icon-monochrome-512.png               white glyph on transparent ("monochrome")
 *   public/icons/apple-touch-icon.png (180)            full-bleed (iOS applies its own mask)
 *   public/icons/favicon-32.png, favicon-64.png
 *   public/icons/shortcut-add-192.png, shortcut-stats-192.png   manifest shortcut icons
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'public', 'icons');

/** Chunky top-down airliner, nose up, in a 100×100 box (thick fuselage so it survives 16px). */
const PLANE =
  'M50 4C55 4 57 9 57 16V36L95 58V66L57 56V76L72 86V93L54 89L52 96H48L46 89L28 93V86L43 76V56L5 66V58L43 36V16C43 9 45 4 50 4Z';

const AMBER = '#ffb547';
const NIGHT = '#0c1631'; // tile edge colour; also the departure dot's centre

// Geometry on a 512 canvas. Optically centred: the bounding box sits a touch up-left of centre
// because the arc's belly and the big plane pull the visual weight down-right.
const PLANE_LEN = 224;
const PX = 327; // plane centre
const PY = 176;
const PLANE_ANGLE = 18; // degrees clockwise from nose-up
const BX = 127; // departure dot centre
const BY = 382;
const DOT_R = 44;
const TRAIL_W = 56;
const GAP = 10; // knock-out between plane and trail
const S = PLANE_LEN / 100;
const PLANE_T = `translate(${PX} ${PY}) rotate(${PLANE_ANGLE}) scale(${S}) translate(-50 -50)`;
// Knock-out outline: the plane plus a smooth fairing from tailplane tip to tailplane tip, so the trail
// ends in one clean curve behind the tail instead of notching around the tail cone.
const KNOCKOUT = PLANE + 'M28 86H72V93Q50 99 28 93Z';

/**
 * The flight path: the circular arc through the departure dot that arrives tangent to the plane's
 * heading. It ends under the tail (hidden by the knock-out), so the trail flows straight out of it.
 */
function flightPath() {
  const a = (PLANE_ANGLE * Math.PI) / 180;
  const h = [Math.sin(a), -Math.cos(a)]; // heading (unit)
  const back = 0.62 * 46 * S; // from plane centre towards the tail
  const E = [PX - h[0] * back, PY - h[1] * back];
  const v = [BX - E[0], BY - E[1]];
  let n = [-h[1], h[0]];
  let dn = v[0] * n[0] + v[1] * n[1];
  if (dn < 0) [n, dn] = [[-n[0], -n[1]], -dn];
  const r = (v[0] ** 2 + v[1] ** 2) / (2 * dn); // circle tangent to h at E, through the dot
  const sweep = h[0] * n[1] - h[1] * n[0] > 0 ? 1 : 0; // travel direction at the plane = heading
  const f = (x) => +x.toFixed(2);
  return `M${BX} ${BY}A${f(r)} ${f(r)} 0 0 ${sweep} ${f(E[0])} ${f(E[1])}`;
}

const defs = `
  <radialGradient id="fj-bg" cx=".66" cy=".26" r=".95">
    <stop offset="0" stop-color="#2a4c96"/><stop offset=".5" stop-color="#16295a"/><stop offset="1" stop-color="${NIGHT}"/>
  </radialGradient>
  <linearGradient id="fj-plane" gradientUnits="userSpaceOnUse" x1="0" y1="4" x2="0" y2="96">
    <stop offset="0" stop-color="#d2f3ff"/><stop offset=".45" stop-color="#6fd0ff"/><stop offset="1" stop-color="#3a8dff"/>
  </linearGradient>
  <mask id="fj-ko" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
    <rect width="512" height="512" fill="#fff"/>
    <path transform="${PLANE_T}" d="${KNOCKOUT}" fill="#000" stroke="#000" stroke-width="${(GAP * 2) / S}" stroke-linejoin="round"/>
  </mask>`;

/** Foreground art. mono = single-colour silhouette (holes transparent) for themed icons. */
function art({ mono = false } = {}) {
  const trail = mono ? '#fff' : AMBER;
  const dotHole = `<circle cx="${BX}" cy="${BY}" r="${DOT_R * 0.36}" fill="${mono ? '#000' : NIGHT}"/>`;
  const trailGroup = `
    <path d="${flightPath()}" fill="none" stroke="${trail}" stroke-width="${TRAIL_W}" stroke-linecap="round"/>
    <circle cx="${BX}" cy="${BY}" r="${DOT_R}" fill="${trail}"/>`;
  const plane = `<path transform="${PLANE_T}" d="${PLANE}" fill="${mono ? '#fff' : 'url(#fj-plane)'}" stroke="${mono ? '#fff' : 'url(#fj-plane)'}" stroke-width="3" stroke-linejoin="round"/>`;
  if (mono) {
    // Cut the knock-out gap and the dot's centre out of the silhouette.
    return `<mask id="fj-mono" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><g mask="url(#fj-ko)">${trailGroup}</g>${dotHole}</mask>
      <rect width="512" height="512" fill="#fff" mask="url(#fj-mono)"/>${plane}`;
  }
  return `<g mask="url(#fj-ko)">${trailGroup}${dotHole}</g>${plane}`;
}

const scaled = (scale, inner) => `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${inner}</g>`;

/**
 * @param {{ shape: 'tile' | 'bleed' | 'none', scale: number, mono?: boolean }} o
 *   tile  = rounded square with transparent corners (favicon / "any")
 *   bleed = full-bleed square (maskable / apple-touch)
 *   none  = no background (monochrome)
 */
function svg({ shape, scale, mono = false }) {
  const bg =
    shape === 'tile' ? `<rect width="512" height="512" rx="112" fill="url(#fj-bg)"/>` : shape === 'bleed' ? `<rect width="512" height="512" fill="url(#fj-bg)"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${defs}</defs>${bg}${scaled(scale, art({ mono }))}</svg>`;
}

/** Shortcut icon: night circle with a bold glyph (24px-grid stroke path). */
function shortcutSvg(path, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><defs>${defs}</defs>
  <circle cx="96" cy="96" r="96" fill="url(#fj-bg)"/>
  <g transform="translate(96 96) scale(4.4) translate(-12 -12)"><path d="${path}" fill="none" stroke="${color}" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
}

const favicon = svg({ shape: 'tile', scale: 1 }); // biggest glyph: favicon + in-app brand mark
const anyIcon = svg({ shape: 'tile', scale: 0.94 });
const maskable = svg({ shape: 'bleed', scale: 0.82 });
const apple = svg({ shape: 'bleed', scale: 0.88 });
const mono = svg({ shape: 'none', scale: 0.82, mono: true });
const shortcutAdd = shortcutSvg('M12 5v14M5 12h14', AMBER);
const shortcutStats = shortcutSvg('M5 19V11M12 19V5M19 19v-6', '#6fd0ff');

await mkdir(iconsDir, { recursive: true });
await writeFile(join(root, 'public', 'favicon.svg'), favicon + '\n');
await writeFile(join(iconsDir, 'icon.svg'), anyIcon + '\n');

/** [file, markup, size, transparent background] */
const jobs = [
  ['icon-192.png', anyIcon, 192, true],
  ['icon-512.png', anyIcon, 512, true],
  ['icon-maskable-512.png', maskable, 512, false],
  ['icon-monochrome-512.png', mono, 512, true],
  ['apple-touch-icon.png', apple, 180, false],
  ['favicon-32.png', favicon, 32, true],
  ['favicon-64.png', favicon, 64, true],
  ['shortcut-add-192.png', shortcutAdd, 192, true],
  ['shortcut-stats-192.png', shortcutStats, 192, true],
];

const bundled = '/opt/pw-browsers/chromium';
const executablePath = process.env.CHROMIUM_PATH || (existsSync(bundled) ? bundled : undefined);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, markup, size, transparent] of jobs) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`,
    );
    await page.screenshot({ path: join(iconsDir, name), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote', join('public/icons', name));
  }
} finally {
  await browser.close();
}
