#!/usr/bin/env node
/**
 * Generates the app icons (PNG) and favicon.svg from a single SVG definition, rendered with
 * Playwright's chromium. Run:  node scripts/make-icons.mjs
 *
 * Outputs (committed):
 *   public/favicon.svg
 *   public/icons/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png (180),
 *   public/icons/favicon-32.png, favicon-64.png
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'public', 'icons');

// Same plane glyph as the in-app icon set (24px grid, nose up).
const PLANE = 'M10.2 21 12 19.5 13.8 21v-1.5l-1-1.2V13l8.2 3v-2L12.8 9V4.5a.8.8 0 0 0-1.6 0V9L3 14v2l8.2-3v5.3l-1 1.2z';

// A flight arc rising from bottom-left to top-right, plane at the far end.
const START = [108, 404];
const CTRL = [170, 214];
const END = [346, 172];

const heading = (() => {
  const dx = END[0] - CTRL[0];
  const dy = END[1] - CTRL[1];
  return (Math.atan2(dx, -dy) * 180) / Math.PI; // clockwise from "up"
})();

/**
 * @param {{ rounded: boolean, scale: number }} o  rounded = squircle-ish corners with transparent
 *   outside (any-purpose icon); otherwise a full-bleed square (maskable / apple-touch).
 *   scale shrinks the artwork toward the center to respect safe zones.
 */
function svg({ rounded, scale }) {
  const s = scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="sky" x2="1" y2="1"><stop stop-color="#9fe1ff"/><stop offset="1" stop-color="#2f7bff"/></linearGradient></defs>
  <rect width="512" height="512" ${rounded ? 'rx="116"' : ''} fill="#101829"/>
  <g transform="translate(256 256) scale(${s}) translate(-256 -256)">
    <circle cx="256" cy="256" r="166" fill="none" stroke="#5cc8ff" stroke-opacity=".22" stroke-width="12"/>
    <path d="M118 353 Q179 407 330 300" fill="none" stroke="#ffb547" stroke-width="20" stroke-linecap="round"/>
    <g transform="translate(274 239) rotate(38) scale(14) translate(-12 -12)"><path d="${PLANE}" fill="url(#sky)"/></g>
  </g></svg>`;
}

const anyIcon = svg({ rounded: true, scale: 0.94 });
const maskable = svg({ rounded: false, scale: 0.72 });
const apple = svg({ rounded: false, scale: 0.86 });

await mkdir(iconsDir, { recursive: true });
await writeFile(join(root, 'public', 'favicon.svg'), anyIcon);
await writeFile(join(iconsDir, 'icon.svg'), anyIcon);

const jobs = [
  ['icon-192.png', anyIcon, 192, true],
  ['icon-512.png', anyIcon, 512, true],
  ['icon-maskable-512.png', maskable, 512, false],
  ['apple-touch-icon.png', apple, 180, false],
  ['favicon-32.png', anyIcon, 32, true],
  ['favicon-64.png', anyIcon, 64, true],
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
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
