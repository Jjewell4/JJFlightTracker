# Flight Log

A fast, private, installable flight tracker — a calmer, better-looking take on the flight log at
my.flightradar24.com. Log every flight, see your routes on a map, and explore stats about the miles,
airports, airlines and aircraft in your history.

**Your data never leaves your device.** There is no server and no account: everything is stored in
your browser (IndexedDB) and works offline once the app has loaded. You can export a backup at any time.

## Features

- **Flights list** with search, filters and per-flight detail (route map, times, seat, aircraft, notes).
- **Quick entry** with airport / airline / aircraft search, flight-number lookup and time-zone-aware durations.
- **Map** of every route you have flown, drawn as great-circle arcs.
- **Stats**: distance, time in the air, top airports / airlines / aircraft, countries, records, yearly charts.
- **Import** from Flightradar24 (CSV or Excel), any spreadsheet (with a column-matching step) or a Flight Log backup.
  Duplicates are detected, problems can be fixed inline before anything is saved.
- **Export** a JSON backup (flights + settings) or a Flightradar24-compatible CSV.
- **Installable PWA**, offline-first, dark-first "night flight" design with a light theme.

## Import from Flightradar24

1. On a computer, sign in at [my.flightradar24.com](https://my.flightradar24.com).
2. Open your flight list (**My Flights**).
3. Choose **Export** (or **Download**) and pick **CSV**.
4. In Flight Log open **More → Import flights → Flightradar24** and choose the file.

You can also open the CSV in Excel or Google Sheets first and save it as `.xlsx` — dates and times that
the spreadsheet converted are understood. Partial dates (`2019-03`, `2019`), unknown `00:00:00` times and
overnight flights are handled. Review the summary ("254 flights ready · 1 needs attention · 3 duplicates
skipped"), fix or skip anything flagged, then import. Nothing is uploaded — the file is read in your browser.

Other sources (another tracker, a hand-made spreadsheet) work via **Spreadsheet**: pick the file, confirm
which column is the date, origin, destination and so on, and continue.

## Install on your phone

- **Android (Chrome):** open the site, then **⋮ → Install app** (or tap **Install app** under *More → App*).
- **iPhone / iPad (Safari):** open the site, tap **Share**, then **Add to Home Screen**.
- **Desktop (Chrome / Edge):** use the install icon in the address bar.

After installing, open *More → App → Protect my data* so the browser doesn't clear your log when the
device runs low on space, and export a backup now and then.

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. In the repo go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` (or run the **Deploy to GitHub Pages** workflow manually). The workflow installs
   dependencies, type-checks, runs the tests, builds and publishes `dist/`.

The app is built with a relative base (`./`) and hash routing, so it works under `https://<user>.github.io/<repo>/`
and on any other static host without extra configuration.

## Local development

```bash
npm install          # .npmrc enables legacy-peer-deps
npm run dev          # http://localhost:5173
npm test             # vitest (unit + component tests)
npm run typecheck    # tsc -b
npm run build        # type-check + production build + service worker (dist/)
npm run preview      # serve the production build (test offline/PWA behaviour here)
```

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm run data -- --cache` | Rebuilds `public/data/*.json` from OurAirports + OpenFlights |
| `node scripts/make-icons.mjs` | Regenerates `public/icons/*.png` and `public/favicon.svg` (needs Playwright's chromium) |
| `node scripts/screenshot.mjs --url http://localhost:5173 --seed /stats` | Mobile screenshots for visual QA |

In the browser console (dev builds) `__seedSampleFlights()` loads ~250 demo flights; the same is
available from *More → Load sample data*.

### Project layout

- `src/lib` — domain types, Dexie database, geo/time helpers
- `src/data/reference.ts` — airport / airline / aircraft datasets and search
- `src/services/import` — pure parsing code for Flightradar24 / CSV / XLSX / backup (well tested)
- `src/features/*` — one folder per screen (flights, entry, map, stats, import, settings)
- `src/components` — shared UI (app shell, icons, PWA prompts)

## Data sources & attribution

- [OurAirports](https://ourairports.com/data/) — airports and time zones (public domain)
- [OpenFlights](https://openflights.org/data.html) — airlines and aircraft types ([Open Database License](https://opendatacommons.org/licenses/odbl/1-0/))
- [Natural Earth](https://www.naturalearthdata.com/) — world map shapes (public domain)
- [adsbdb](https://www.adsbdb.com/) — free flight route lookups (optional)
- [AeroDataBox](https://rapidapi.com/aedbx-aedbx/api/aerodatabox) via RapidAPI — optional schedule lookups with your own key
- Airline logos via [pics.avs.io](https://pics.avs.io/)
- Map tiles by [OpenFreeMap](https://openfreemap.org/), © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors

Flight Log is an independent project and is not affiliated with Flightradar24.

## Privacy

- All flights and settings are stored locally in your browser. Nothing is sent to a server.
- Optional lookups (adsbdb, AeroDataBox) send only the flight number / tail number you entered, and can be switched off in *More*.
  An AeroDataBox key, if you add one, is stored only on your device.
- Airline logos are fetched from pics.avs.io and map tiles from OpenFreeMap; both fall back gracefully offline.
- Clearing your browser's site data deletes your log — **export a backup** (*More → Export backup*) regularly.

## Cloud sync (Supabase)

Flights always save on the device first (works offline). With sync on, every change is also
copied to your own Supabase database and to any other device you sign in on.
Saving confirms the committed local write immediately; it never waits for cloud sync.
Pending changes survive closing/reopening the PWA. Sync retries transient failures after
30 seconds with backoff up to five minutes, and also runs on reconnection and foregrounding.
Cloud requests time out after 20 seconds so a stalled connection can retry. Browsers may
suspend a closed/backgrounded PWA: in that case, queued changes sync when it is reopened.

1. **Create a project** at [supabase.com](https://supabase.com) (free tier is plenty).
2. **Create the table:** Supabase → SQL Editor → New query → paste [`supabase/schema.sql`](supabase/schema.sql) → Run.
   It creates a `flights` table with Row Level Security so each account only sees its own rows.
3. **Auth settings** (Authentication → URL Configuration): set **Site URL** to your production URL
   (e.g. `https://your-app.vercel.app`) and add it under **Redirect URLs**.
4. **Enable email/password authentication** in Authentication → Providers → Email. Configure production SMTP for confirmation and recovery messages; regular password sign-in does not send email. See the password migration instructions below.
5. **Vercel env vars** (Project → Settings → Environment Variables), for Production (and Preview if you test there):
   - `SUPABASE_URL` — Supabase → Project Settings → API → Project URL
   - `SUPABASE_ANON_KEY` — the `anon` / publishable key (public by design; RLS protects the data)

   `VITE_`-prefixed and `NEXT_PUBLIC_`-prefixed names (and `*_PUBLISHABLE_KEY`) work too. Only these two
   values are passed to the browser; the service-role key is never used — don't put it in either variable.

   Then **redeploy** — Vite bakes env vars in at build time.
6. In the app: **Account** → create an account or sign in with email and password. Your existing log uploads automatically.
7. Optional, recommended: after your first sign-in, turn off **Authentication → Sign In / Providers → Allow new users to sign up**
   so nobody else can create an account on your project.

Notes: deletes are soft (`deleted = true`, data kept) so a mistaken delete can be recovered from the
Supabase table editor. Sign in on your main device first; on another device start from an empty log
(importing the same Flightradar24 file on two devices would create duplicates).
For local dev, copy `.env.example` to `.env.local`.

### Password sign-in and existing accounts

Sign-in uses email and password; it does not send a magic link on each login.
Enable the Email provider in Supabase Auth. Existing users who previously used
magic links can use **Account → Set or change password** while signed in, or
**Forgot password / previously used email links?** while signed out. This updates
the same account and preserves its user ID and cloud flights.

Add the application's exact origin/path with `?passwordRecovery=1` to Supabase's
allowed Redirect URLs, alongside its normal application URL. Recovery links use
PKCE: request and open the link in the same browser. New-account confirmation
and password recovery still send email and remain subject to Supabase email
limits; configure custom SMTP for production delivery. Keep signup enabled only
if you want new users. Never expose the service-role key.

### Release updates and browser regression checks

Vite fingerprints JavaScript/CSS assets. Vercel revalidates the app shell and
static data, caches fingerprinted assets immutably, and does not cache `sw.js`.
The PWA checks for updates at startup, on foreground/reconnect, and every five
minutes. An update prompt lets people save work before activating the new worker.
Offline users retain their last downloaded version until they reconnect. Other
static hosts should use equivalent cache headers.

Run `CHROMIUM_PATH=/path/to/chromium node scripts/smoke.mjs` with the dev server
running. It uses a fresh browser profile, saves a test flight, downloads CSV,
and checks key screens at phone, tablet and desktop widths. `SMOKE_URL` can
select another local server. No personal data or live credentials are required.

Quick entry accepts an explicit line such as `SAN → LAX 2026-11-15 UA123` and
fills the editable form. It deliberately does not guess dates from arbitrary
emails. CSV export now offers readable spreadsheet columns plus a separate
Flightradar24 compatibility option. JSON remains the lossless backup format.

## Live public FlightJournal pages

In **Settings → Public journal**, sign in, choose a handle such as `jordan`, enter
a display name, preview, and enable sharing. The public URL is
`https://your-domain/jordan` on a root-hosted Vercel deployment.

The page reads a privacy-filtered view of the owner's cloud flights. Additions,
edits and deletions appear after normal cloud sync, without republishing. An open
visitor page refreshes every 30 seconds while visible, and on foreground or
reconnection. Offline edits appear after reconnecting and syncing. Settings are
saved only when you change the handle, display name or date-privacy preference.
**Unpublish** disables the URL. Previously downloaded copies cannot be recalled.

**Deployment prerequisite:** run (or re-run)
[`supabase/public-profiles.sql`](supabase/public-profiles.sql) after `schema.sql`.
The migration upgrades existing snapshot journals to live pages while retaining
URLs and date-privacy preferences. No new secret is needed. It keeps the private
flights table protected and exposes only an allowlisted projection through a
narrow lookup function. The legacy snapshot column is retained for migration
compatibility but is no longer served to visitors. Before first publishing, the
app waits for cloud sync to finish so the public source is current.

Shared fields are routes, airline codes, aircraft types and dates. Dates default
to month precision; exact dates are opt-in. Notes, times, flight numbers, seat
details, registrations, private record IDs and account information are excluded.
Today and future flights stay private. The server uses its UTC date boundary;
imprecise dates in the current month/year are conservatively withheld. Public
visitors get totals, a route map and searchable history without starting their
own cloud sync or reading their private flight log.

The Vercel rewrite serves clean profile URLs and canonicalizes trailing slashes.
Other hosts need an equivalent rewrite to `index.html`. GitHub Pages subpath
hosting does not provide this clean-URL rewrite automatically.

`npm test` includes actual PostgreSQL policy/projection tests through PGlite,
including live additions, edits, deletions, privacy preferences and revocation.
For the isolated mocked-service browser flow:

```bash
VITE_SUPABASE_URL=https://profile-test.invalid VITE_SUPABASE_ANON_KEY=public-test-fixture npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
node scripts/public-smoke.mjs
```

The browser script covers preview, handle conflicts, publishing, anonymous viewing,
live refresh, city search, failure recovery and unpublishing. It uses
`/usr/bin/chromium` and blocks other remote hosts. It does not verify your deployed
Supabase project or Vercel routing configuration.

## Screenshot flight import (Gemini)

On **Log a flight → Scan screenshot**, signed-in users choose one or several images
(booking, boarding pass or status page). Each becomes a **draft** that is read by Gemini in
the background — close the sheet any time; the result waits in **To review** (a card on Home
and a count on the Scan button, plus a toast when it's ready). Drafts stay on the device and
an interrupted read is retried the next time the app opens.

Review a draft by ticking the flights to keep: complete flights can be saved straight away,
several at once, and an itinerary can be saved **as a trip** with a suggested name
("Weekend in Chicago", "Lisbon & Porto"). Flights already in the log are left unticked,
and legs missing a date or airport open in the normal flight form to fix. Nothing is saved
until you tap Save. Flights retain a `screenshot` source in backups.

Deployment on Vercel:

1. Run [`supabase/screenshot-import.sql`](supabase/screenshot-import.sql) in the
   same Supabase project as cloud sync. It is safe to rerun — rerun it after updates
   (newer versions add refunds for failed attempts and the status check).
2. Create a key in [Google AI Studio](https://aistudio.google.com/apikey) and set it as
   **`GEMINI_API_KEY`** (server-only) in Vercel → Settings → Environment Variables, ticking
   **Production**. Never use a `VITE_` prefix. `GOOGLE_API_KEY` is also accepted.
   If you created the key in Google Cloud Console, give it **no application restrictions**
   (server calls have no referrer) and make sure the **Generative Language API** is enabled.
3. Optionally set **`GEMINI_MODEL`**. If unset (recommended) the server uses
   `gemini-flash-latest` with low thinking, falling back to `gemini-flash-lite-latest`,
   `gemini-2.5-flash` and `gemini-2.5-flash-lite` when a model isn't available to your key.
   If a read runs long (~26 s), the rest of the time goes to a lite model instead of failing.
4. Ensure Vercel has the same `SUPABASE_URL` and `SUPABASE_ANON_KEY` / publishable key
   used for cloud sync. A service-role key is neither required nor used.
5. **Redeploy** (environment variables only apply to new deployments), then in the app open
   **Log a flight → Scan screenshot**. If anything fails, tap **Check setup**: it calls
   `GET /api/extract-flight` and lists each requirement (key present, key accepted and which
   model is used, Supabase settings, usage limits installed and remaining) with the exact fix.

Troubleshooting messages map to causes:

| Message | Fix |
|---|---|
| missing server configuration: GEMINI_API_KEY | Add the variable for Production and redeploy |
| Gemini rejected GEMINI_API_KEY | Paste a fresh key (watch for spaces); redeploy |
| Gemini refused the API key (permission denied) | Remove key restrictions; enable Generative Language API |
| No Gemini model worked with this API key | Set `GEMINI_MODEL` to a model listed in AI Studio |
| usage limits aren't installed | Run `supabase/screenshot-import.sql` |
| Gemini's usage limit for this API key is used up | Free-tier quota; wait or raise it in AI Studio |
| Gemini took too long to answer | Retry; crop the screenshot to the flight details |

`api/extract-flight.ts` is a Vercel Node function with a 60-second duration limit.
It authenticates the bearer token with Supabase, consumes a durable atomic quota,
then calls Gemini. Limits are **10 attempts per UTC day and 100 per UTC month per
user**. Attempts that fail because of server setup or a Gemini outage are refunded;
unreadable images still count. The quota fails closed if
its migration is missing; counters are not reset by redeployments. Use provider
project quotas/budgets as an additional total-spend limit. Signups and per-account
quotas alone are not a global spend cap.

The browser re-encodes images as JPEG, removes metadata, and limits dimensions
before upload. Original files are limited to 10 MB; transmitted images are under
approximately 2.1 MB. The server validates size and signature. Images and extracted
payloads are not stored or logged by this feature; Google processes the image
under the Gemini API terms applicable to your project. The UI explains this
before sending and recommends cropping out personal details. No image is added
to a backup or public journal. Extraction needs internet; reviewed flights save
locally and sync through the existing background flow.

`npm run dev` runs the frontend only. For end-to-end local server development,
use Vercel's local development workflow (`vercel dev`) with server environment
variables, or test a Vercel preview deployment. Tests mock the AI and auth HTTP
responses; SQL quota enforcement is exercised with PostgreSQL via PGlite.
For the browser regression test, start a separate frontend with:

```sh
VITE_SUPABASE_URL=https://profile-test.invalid VITE_SUPABASE_ANON_KEY=public-test-fixture npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
node scripts/screenshot-smoke.mjs
```

The browser test uses synthetic image data and mocked services; it does not
establish live Gemini extraction accuracy. A configured deployment must be tested
with representative airline screenshots before relying on its suggestions.
