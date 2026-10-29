#!/usr/bin/env node
/**
 * Generates the app icons (PNG) and favicon.svg from a single SVG definition, rendered with
 * Playwright's chromium. Run:  node scripts/make-icons.mjs
 * (set CHROMIUM_PATH to use a specific chromium binary).
 *
 * The mark ("Window Seat"): a plane window looking down on a dotted map of the Americas, a few
 * dots lit up like places you've been, with the wing and an amber winglet in front. Small sizes
 * use a simplified drawing (solid land, fewer and bigger lit dots) so it still reads at 16×16.
 *
 * Outputs (committed):
 *   public/favicon.svg (simplified, browser tabs), public/icons/mark.svg (full, in-app brand),
 *   public/icons/icon.svg
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

const TILE = '#13285a';
const FRAME = '#e8f1ff';
const NIGHT = '#0c1631';
const DOT = '#5b8fe6';
const LAND = '#2f5aa8'; // solid land at small sizes
const LIT = '#a6e3ff';
const AMBER = '#ffb547';
const FLAP = '#b9cce8';

/** North America (Alaska, Hudson Bay, Florida, the Gulf, Central America) on the 512 canvas. */
const NORTH =
  'M140 140L160 128L184 126L200 120L224 116L244 112L262 106L284 104L300 112L304 128L296 140L290 156L300 166L314 160L316 142L326 128L340 122L352 136L356 154L348 170L336 180L330 192L324 206L318 220L310 232L306 246L310 262L306 272L300 268L296 254L288 248L276 250L264 248L256 254L252 266L254 280L264 290L272 296L278 304L286 312L292 318L286 322L276 316L266 308L256 300L244 292L232 282L222 270L214 256L206 240L200 222L196 204L190 190L180 180L168 172L156 166L148 158L140 156Z';
/** South America, east of North America as on a real map. */
const SOUTH = 'M290 322L304 320L320 326L334 334L350 344L362 356L354 372L342 386L330 400L318 414L308 432L296 432L292 414L288 396L284 378L282 360L280 344L284 332Z';
/** Lit places on the 16px dot grid: Seattle, LA, Denver, Chicago, New York, Atlanta, Rio. */
const PLACES = [
  [216, 184],
  [216, 248],
  [248, 216],
  [280, 200],
  [312, 200],
  [296, 232],
  [312, 360],
];

const WING = 'M140 340L318 292L330 308L140 392Z';
const WING_FLAP = 'M140 378L328 304L330 308L140 392Z';
const WINGLET = 'M318 292L330 252L342 255L330 308Z';
// Chunkier wing for small sizes.
const WING_SM = 'M140 334L318 286L336 312L140 400Z';
const WINGLET_SM = 'M318 286L330 242L348 247L336 312Z';

const defs = `
  <clipPath id="ws-pane"><rect x="156" y="96" width="200" height="320" rx="88"/></clipPath>
  <pattern id="ws-dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="3.4" fill="${DOT}"/></pattern>`;

/** Window art. detail: 'full' (dotted map), 'small' (solid land, 2 lit dots) or 'tiny' (land + wing). */
function art(detail = 'full') {
  const land = detail === 'full' ? 'url(#ws-dots)' : LAND;
  const places =
    detail === 'full'
      ? PLACES.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.8" fill="${LIT}"/>`).join('')
      : detail === 'small'
        ? `<circle cx="216" cy="192" r="13" fill="${LIT}"/><circle cx="304" cy="208" r="13" fill="${LIT}"/>`
        : '';
  const wing =
    detail === 'full'
      ? `<path d="${WING}" fill="${FRAME}"/><path d="${WING_FLAP}" fill="${FLAP}"/><path d="${WINGLET}" fill="${AMBER}"/>`
      : `<path d="${WING_SM}" fill="${FRAME}"/><path d="${WINGLET_SM}" fill="${AMBER}"/>`;
  return `<rect x="124" y="64" width="264" height="384" rx="120" fill="${FRAME}"/>
    <g clip-path="url(#ws-pane)"><rect x="140" y="80" width="232" height="352" fill="${NIGHT}"/>
    <path d="${NORTH}" fill="${land}"/><path d="${SOUTH}" fill="${land}"/>${places}${wing}</g>`;
}

/** Single-colour silhouette for themed icons: the window frame and the wing. */
function monoArt() {
  return `<path fill-rule="evenodd" fill="#fff" d="M244 64h24a120 120 0 0 1 120 120v144a120 120 0 0 1-120 120h-24a120 120 0 0 1-120-120V184A120 120 0 0 1 244 64ZM244 96a88 88 0 0 0-88 88v144a88 88 0 0 0 88 88h24a88 88 0 0 0 88-88V184a88 88 0 0 0-88-88Z"/>
    <g clip-path="url(#ws-pane)"><path d="${WING_SM}" fill="#fff"/><path d="${WINGLET_SM}" fill="#fff"/></g>`;
}

const scaled = (scale, inner) => `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${inner}</g>`;

/**
 * @param {{ shape: 'tile' | 'bleed' | 'none', scale: number, detail?: 'full' | 'small' | 'tiny', mono?: boolean }} o
 *   tile  = rounded square with transparent corners (favicon / "any")
 *   bleed = full-bleed square (maskable / apple-touch)
 *   none  = no background (monochrome)
 */
function svg({ shape, scale, detail = 'full', mono = false }) {
  const bg = shape === 'tile' ? `<rect width="512" height="512" rx="112" fill="${TILE}"/>` : shape === 'bleed' ? `<rect width="512" height="512" fill="${TILE}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${defs}</defs>${bg}${scaled(scale, mono ? monoArt() : art(detail))}</svg>`;
}

/** Shortcut icon: navy circle with a bold glyph (24px-grid stroke path). */
function shortcutSvg(path, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <circle cx="96" cy="96" r="96" fill="${TILE}"/>
  <g transform="translate(96 96) scale(4.4) translate(-12 -12)"><path d="${path}" fill="none" stroke="${color}" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
}

const favicon = svg({ shape: 'tile', scale: 1.26, detail: 'small' }); // tab icon + in-app brand mark (≤32px)
const favicon64 = svg({ shape: 'tile', scale: 1.22 });
/** In-app brand mark (header, welcome): the full dotted map, shown at 40–64px. */
const mark = svg({ shape: 'tile', scale: 1.22 });
const tiny = svg({ shape: 'tile', scale: 1.28, detail: 'tiny' });
const anyIcon = svg({ shape: 'tile', scale: 1.16 });
const maskable = svg({ shape: 'bleed', scale: 0.82 });
const apple = svg({ shape: 'bleed', scale: 1.04 });
const mono = svg({ shape: 'none', scale: 0.82, mono: true });
const shortcutAdd = shortcutSvg('M12 5v14M5 12h14', AMBER);
const shortcutStats = shortcutSvg('M5 19V11M12 19V5M19 19v-6', LIT);

await mkdir(iconsDir, { recursive: true });
await writeFile(join(root, 'public', 'favicon.svg'), favicon + '\n');
await writeFile(join(iconsDir, 'icon.svg'), anyIcon + '\n');
await writeFile(join(iconsDir, 'mark.svg'), mark + '\n');

/** [file, markup, size, transparent background] */
const jobs = [
  ['icon-192.png', anyIcon, 192, true],
  ['icon-512.png', anyIcon, 512, true],
  ['icon-maskable-512.png', maskable, 512, false],
  ['icon-monochrome-512.png', mono, 512, true],
  ['apple-touch-icon.png', apple, 180, false],
  ['favicon-32.png', tiny, 32, true],
  ['favicon-64.png', favicon64, 64, true],
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
