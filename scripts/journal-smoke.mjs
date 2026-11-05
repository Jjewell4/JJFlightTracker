import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    isMobile: true,
    hasTouch: true,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173');
  await page.evaluate(async () => {
    localStorage.setItem('flightlog.onboarded', '1');
    const { db } = await import('/src/lib/db.ts');
    await db.flights.clear();
    await db.history.clear();
    await db.kv.clear();
    await db.flights.bulkPut([
      {
        id: 'a',
        date: '2025-04-01',
        datePrecision: 'day',
        from: 'KSFO',
        to: 'KORD',
        source: 'manual',
        createdAt: 1,
        updatedAt: 1,
        flightNumber: 'UA123',
        depTime: '08:00',
        arrTime: '14:00',
        durationMin: 240,
      },
      {
        id: 'b',
        date: '2025-04-07',
        datePrecision: 'day',
        from: 'KORD',
        to: 'KSFO',
        source: 'manual',
        createdAt: 2,
        updatedAt: 2,
        flightNumber: 'UA124',
      },
    ]);
  });
  await page.goto('http://127.0.0.1:5173/#/flights');
  await page.locator('#splash').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Select flights', exact: true }).click();
  await page.getByRole('button', { name: 'Select matching flights' }).click();
  await page.getByRole('button', { name: 'Edit selected', exact: true }).click();
  await page.getByLabel('Trip name', { exact: true }).fill('Chicago wedding');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await page.getByRole('heading', { name: 'Edit 2 flights' }).waitFor({ state: 'hidden' });
  const trip = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    return (await db.flights.get('a')).tripId;
  });
  assert(trip);
  await page.goto('http://127.0.0.1:5173/#/trips/' + trip);
  await page.locator('#splash').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Edit notes & cover' }).click();
  await page.getByLabel('Notes', { exact: true }).fill('A wonderful weekend with friends');
  await page.getByRole('button', { name: 'Save journal entry' }).click();
  await page.getByRole('heading', { name: 'Remember this trip' }).waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(async () => {
      const { db } = await import('/src/lib/db.ts');
      return (await db.flights.get('b')).tripDetails.note;
    }),
    'A wonderful weekend with friends',
  );
  await page.evaluate(() => Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false }));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Share trip recap' }).click();
  assert.equal((await download).suggestedFilename(), 'trip-recap.png');
  await page.goto('http://127.0.0.1:5173/#/flights');
  await page.locator('#splash').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Select flights', exact: true }).click();
  await page.getByRole('button', { name: 'Select matching flights' }).click();
  await page.getByRole('button', { name: 'Edit selected', exact: true }).click();
  await page.getByLabel('Action', { exact: true }).selectOption('delete');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await page.getByRole('button', { name: 'Delete flights', exact: true }).click();
  await page.waitForFunction(async () => {
    const { db } = await import('/src/lib/db.ts');
    return (await db.flights.count()) === 0;
  });
  await page.goto('http://127.0.0.1:5173/#/history');
  await page.locator('#splash').waitFor({ state: 'detached' });
  await page.getByLabel('Show', { exact: true }).selectOption('deleted');
  await page.getByRole('button', { name: 'Restore previous state', exact: true }).first().click();
  await page.waitForFunction(async () => {
    const { db } = await import('/src/lib/db.ts');
    return (await db.flights.count()) === 2;
  });
  await page.goto('http://127.0.0.1:5173/#/quality');
  await page.locator('#splash').waitFor({ state: 'detached' });
  await page.getByRole('heading', { name: 'No likely mistakes found' }).waitFor();
  await page.goto('http://127.0.0.1:5173/#/stats');
  await page.locator('#splash').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Compact view', exact: true }).waitFor();
  assert((await page.locator('details.stats-disclosure[open]').count()) <= 1);
  await page.getByRole('button', { name: 'Expand all sections' }).click();
  assert((await page.locator('details.stats-disclosure[open]').count()) > 1);
  await page.getByRole('button', { name: 'Compact view', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '/tmp/journal-stats.png', fullPage: true, animations: 'disabled' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.goto('http://127.0.0.1:5173/#/trips/' + trip);
  await page.locator('#splash').waitFor({ state: 'detached' });
  await page.screenshot({ path: '/tmp/journal-trip.png', fullPage: true, animations: 'disabled' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  await page.evaluate(async () => {
    const { db, saveSettings } = await import('/src/lib/db.ts');
    await saveSettings({ theme: 'light' });
    await db.flights.update('a', { seatNumber: '14F', fieldSources: { seatNumber: 'manual' } });
    await db.drafts.put({
      id: 'review-test',
      source: 'screenshot',
      status: 'ready',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      result: {
        flights: [
          {
            date: '2025-04-01',
            from: 'SFO',
            to: 'ORD',
            flightNumber: 'UA123',
            depTime: '09:00',
            arrTime: '15:00',
            arrDayOffset: 0,
            aircraftType: 'B738',
            seatNumber: '12A',
          },
        ],
        warnings: [],
      },
    });
  });
  await page.goto('http://127.0.0.1:5173/#/review/review-test');
  await page.locator('#splash').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Compare & update' }).click();
  const seat = page.locator('label.manage-field').filter({ has: page.getByText('Seat', { exact: true }) });
  assert.equal(await seat.locator('input[type=checkbox]').isChecked(), false);
  await page.screenshot({ path: '/tmp/journal-review-light.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: /^Update \d+ details$/ }).click();
  await page.waitForFunction(async () => {
    const { db } = await import('/src/lib/db.ts');
    return (await db.flights.get('a')).depTime === '09:00';
  });
  const reviewed = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    return await db.flights.get('a');
  });
  assert.equal(reviewed.seatNumber, '14F');
  assert.equal(reviewed.fieldSources.depTime, 'screenshot');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: compared import updates preserve manual seats; mobile bulk grouping, trip notes, recap download, deletion/restoration, conservative quality checks, compact stats, no horizontal overflow or page errors',
  );
} finally {
  await browser.close();
}
