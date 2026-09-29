#!/usr/bin/env node
/**
 * Mobile screenshots of app routes for visual QA.
 *   node scripts/screenshot.mjs --url http://localhost:5173 --out .scratch/shots [--seed] [--dark|--light] [routes...]
 * Routes are hash paths, e.g. "/" "/stats" "/flights/new". --seed loads sample flights first.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const flag = (name) => {
  const i = args.indexOf(name);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const url = opt('--url', 'http://localhost:5173');
const out = opt('--out', '.scratch/shots');
const width = Number(opt('--width', '390'));
const height = Number(opt('--height', '844'));
const seed = flag('--seed');
const scheme = flag('--light') ? 'light' : 'dark';
const routes = args.length ? args : ['/', '/stats', '/map', '/flights/new', '/import', '/settings'];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('pageerror:', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
await page.goto(`${url}/#/`);
if (seed) {
  await page.waitForFunction(() => window.__seedSampleFlights, null, { timeout: 15000 });
  await page.evaluate(() => window.__seedSampleFlights());
}
for (const r of routes) {
  await page.goto(`${url}/#${r}`);
  await page.waitForTimeout(1500);
  const name = r.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home';
  await page.screenshot({ path: `${out}/${name}-${scheme}.png`, fullPage: flag('--viewport-only') ? false : true });
  console.log(`${out}/${name}-${scheme}.png`);
}
await browser.close();
