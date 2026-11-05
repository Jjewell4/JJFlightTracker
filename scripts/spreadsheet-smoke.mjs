/** Full CSV export → browser file import → IndexedDB, with a clean disposable profile. */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://127.0.0.1:5173/#/settings');
  const original = { id: 'export-one', date: '2026-01-02', datePrecision: 'day', from: 'KSAN', to: 'KLAX', depTime: '00:00', arrTime: '01:30', arrDayOffset: 0, durationMin: 90, tripId: 'saved-trip', tripName: 'Wedding weekend', occasion: 'wedding', occasion2: 'vacation', note: '=literal note', source: 'screenshot', createdAt: 100, updatedAt: 200 };
  await page.evaluate(async f => {
    const { db } = await import('/src/lib/db.ts');
    await db.flights.bulkPut([f, { ...f, id: 'export-two', date: '2026-01-04', from: 'KLAX', to: 'KSAN' }]);
  }, original);
  const downloadReady = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Export CSV/ }).click();
  const download = await downloadReady;
  const csv = await readFile(await download.path(), 'utf8');
  assert(csv.includes('Trip ID,Trip name')); assert(csv.includes('Second occasion')); assert(csv.includes("'=literal note"));
  await page.evaluate(async () => { const { db } = await import('/src/lib/db.ts'); await db.flights.clear(); });
  await page.goto('http://127.0.0.1:5173/#/import');
  await page.locator('input[type=file]').setInputFiles({ name: download.suggestedFilename(), mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByText('Window Seat export detected', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Import 2 flights', exact: true }).click();
  await page.getByRole('link', { name: 'See your stats', exact: true }).first().waitFor();
  const saved = await page.evaluate(async () => { const { db } = await import('/src/lib/db.ts'); return db.flights.toArray(); });
  assert.equal(saved.length, 2);
  for (const f of saved) {
    assert.equal(f.tripId, original.tripId); assert.equal(f.tripName, original.tripName);
    assert.equal(f.occasion2, original.occasion2); assert.equal(f.note, original.note);
    assert.equal(f.depTime, '00:00'); assert.equal(f.source, 'screenshot');
  }
  await page.goto('http://127.0.0.1:5173/#/settings');
  await page.getByRole('button', { name: /^Export CSV/ }).waitFor();
  await page.goto('http://127.0.0.1:5173/#/import');
  await page.locator('input[type=file]').setInputFiles({ name: 'again.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Nothing to import', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Nothing to import', exact: true }).isDisabled(), true);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  console.log('PASS: mobile CSV download/upload, automatic mapping, saved trip and field restoration, duplicate skip.');
} finally { await browser.close(); }
