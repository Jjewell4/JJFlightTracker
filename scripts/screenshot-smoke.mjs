/** Start Vite with the fake Supabase config documented in README. No live AI calls. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'test@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const session = { access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_at: Math.floor(Date.now()/1000)+3600, expires_in:3600, token_type:'bearer', user };
let requests = 0;
try {
  const context = await browser.newContext({ viewport: { width:390, height:844 } });
  await context.addInitScript(s => { localStorage.setItem('flight-log-auth', JSON.stringify(s)); }, session);
  await context.route('https://profile-test.invalid/**', route => route.fulfill({ contentType:'application/json', body:JSON.stringify(route.request().url().includes('/auth/v1/user') ? user : []) }));
  await context.route('**/api/extract-flight', async route => {
    requests++;
    assert.equal(route.request().headers().authorization, 'Bearer test-access-token');
    const data = route.request().postDataJSON();
    assert.equal(data.mimeType,'image/jpeg'); assert(data.image.length > 0);
    if (requests===1) return route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'Screenshot limit reached. Please try again later.'})});
    await route.fulfill({contentType:'application/json',body:JSON.stringify({flights:[{date:'',from:'SAN',to:'LAX',flightNumber:'UA123',depTime:'08:20',arrTime:'09:30',arrDayOffset:0,aircraftType:'A321',seatNumber:'12A'},{date:'2026-10-27',from:'LAX',to:'SAN',flightNumber:'UA124',depTime:'10:00',arrTime:'11:10',arrDayOffset:0,aircraftType:'A321',seatNumber:''}],warnings:['The year is not visible for the first flight. Confirm its date.']})});
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5174/#/flights/new');
  await page.locator('summary').filter({hasText:'Import a screenshot'}).click();
  await page.getByLabel('Flight screenshot', {exact:false}).waitFor();
  // Generate a local synthetic screenshot; the provider response above is intentionally mocked.
  const image = await page.evaluate(() => { const c=document.createElement('canvas');c.width=600;c.height=400;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,600,400);x.fillStyle='black';x.font='32px sans-serif';x.fillText('UA123 SAN → LAX Oct 27',20,80);return c.toDataURL('image/png').split(',')[1]; });
  await page.getByLabel('Flight screenshot',{exact:false}).setInputFiles({name:'flight.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await page.getByRole('button',{name:'Read screenshot',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Screenshot limit reached'}).waitFor();
  await page.getByRole('button',{name:'Read screenshot',exact:true}).click();
  await page.getByRole('heading',{name:'Review 2 flights'}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:'/tmp/screenshot-import-mobile.png',fullPage:true});
  await page.emulateMedia({colorScheme:'dark'});
  await page.screenshot({path:'/tmp/screenshot-import-dark.png',fullPage:true});
  await page.emulateMedia({colorScheme:'light'});
  await page.getByRole('button',{name:'Use this flight',exact:true}).first().click();
  assert.equal(await page.locator('#entry-fn').inputValue(),'UA123');
  await page.getByRole('button',{name:'Save flight',exact:true}).click();
  assert(page.url().includes('/flights/new')); // missing year must not silently become today's date
  await page.locator('summary').filter({hasText:'Import a screenshot'}).click();
  await page.getByRole('button',{name:'Replace form with this flight',exact:true}).click();
  assert.equal(await page.locator('#entry-fn').inputValue(),'UA124');
  await page.getByRole('button',{name:'Save flight',exact:true}).click();
  await page.waitForURL(/#\/flights\/(?!new)[^/?]+$/);
  await page.getByText('Reviewed from a screenshot',{exact:true}).waitFor();
  assert.equal(requests,2);
  console.log('Screenshot mobile review, quota error/retry, multiple segments, missing-date validation, and local save passed.');
  await page.goto('http://127.0.0.1:5174/#/flights/new');
  await page.locator('summary').filter({hasText:'Import a screenshot'}).click();
  await page.getByLabel('Flight screenshot',{exact:false}).setInputFiles({name:'flight.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await context.setOffline(true);
  await page.getByRole('button',{name:'Read screenshot',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'needs a connection'}).waitFor();
  assert.equal(requests,2);
  console.log('Offline extraction is blocked without losing the form.');
} finally { await browser.close(); }
