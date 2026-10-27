/** Isolated mocked-service browser test. Start Vite on 5174 with VITE_SUPABASE_URL=https://profile-test.invalid and VITE_SUPABASE_ANON_KEY=public-test-fixture. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const b = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
let profile = null;
let failLoad = true;
let failPublish = true;
let failRemove = true;
const user = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'owner@example.com',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
};
const session = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  token_type: 'bearer',
  user,
};
async function mock(context) {
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === '127.0.0.1' || host === 'profile-test.invalid'
      ? route.continue()
      : route.abort();
  });
  await context.route('https://profile-test.invalid/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let data = [];
    if (url.pathname === '/auth/v1/user') data = user;
    else if (url.pathname === '/rest/v1/public_profiles') {
      if (req.method() === 'POST') {
        if (failPublish) {
          failPublish = false;
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ code: '23505', message: 'duplicate key' }),
          });
          return;
        }
        const body = req.postDataJSON();
        profile = {
          slug: body.slug,
          display_name: body.display_name,
          flights: body.flights,
          published_at: new Date().toISOString(),
        };
        data = profile;
      } else if (req.method() === 'DELETE') {
        if (failRemove) {
          failRemove = false;
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Network unavailable' }),
          });
          return;
        }
        profile = null;
        data = null;
      } else {
        if (failLoad) {
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Temporary error' }),
          });
          return;
        }
        data = profile;
      }
    } else if (url.pathname === '/rest/v1/rpc/get_public_profile') {
      data =
        profile && profile.slug === req.postDataJSON().handle ? [profile] : [];
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
}
try {
  const owner = await b.newContext({ viewport: { width: 390, height: 844 } });
  await mock(owner);
  await owner.addInitScript(
    (s) => localStorage.setItem('flight-log-auth', JSON.stringify(s)),
    session,
  );
  const p = await owner.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://127.0.0.1:5174');
  await p.waitForFunction(
    () => typeof window.__seedSampleFlights === 'function',
  );
  await p.evaluate(() => window.__seedSampleFlights());
  await p.goto('http://127.0.0.1:5174/#/settings');
  await p.getByRole('button', { name: 'Retry sharing settings' }).waitFor();
  failLoad = false;
  await p.getByRole('button', { name: 'Retry sharing settings' }).click();
  await p.getByLabel('Your URL handle').fill('jordan');
  await p
    .getByLabel('Display name', { exact: true })
    .fill('Jordan’s flight journal');
  await p.getByRole('button', { name: 'Preview public journal' }).click();
  await p.getByRole('button', { name: 'Publish journal', exact: true }).click();
  await p
    .getByText('That URL is already taken. Choose another handle.', {
      exact: true,
    })
    .waitFor();
  await p.getByRole('button', { name: 'Publish journal', exact: true }).click();
  await p
    .getByText('Your public journal is published.', { exact: true })
    .waitFor();
  assert(profile.flights.length > 0);
  assert(!JSON.stringify(profile).includes('seatNumber'));
  assert(profile.flights.every((f) => f.datePrecision !== 'day'));
  const visitor = await b.newContext({ viewport: { width: 390, height: 844 } });
  await mock(visitor);
  const v = await visitor.newPage();
  await v.goto('http://127.0.0.1:5174/jordan');
  await v.getByRole('heading', { name: 'Jordan’s flight journal' }).waitFor();
  assert.equal(
    await v.getByRole('link', { name: 'Log a flight', exact: true }).count(),
    0,
  );
  await v.getByRole('searchbox').fill('San Diego');
  assert((await v.locator('.public-flight-list li').count()) > 0);
  await v.getByRole('searchbox').fill('');
  await v.screenshot({ path: '/tmp/public-mobile.png', fullPage: false });
  await v.setViewportSize({ width: 1440, height: 1000 });
  await v.screenshot({ path: '/tmp/public-desktop.png' });
  await p.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await p
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Unpublish', exact: true })
    .click();
  await p
    .getByRole('alertdialog')
    .getByRole('alert')
    .filter({ hasText: 'Treat your journal as public' })
    .waitFor();
  await p
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Unpublish', exact: true })
    .click();
  await p
    .getByText('Your journal is no longer public.', { exact: true })
    .waitFor();
  await v.reload();
  await v.getByRole('heading', { name: 'This journal isn’t public' }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'PASS mocked-service browser: preview, publish, fresh anonymous visitor at /jordan, private-field exclusion, retry, handle conflict, city search, failed-unpublish feedback, unpublish and unavailable state.',
  );
} finally {
  await b.close();
}
