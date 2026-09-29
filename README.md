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
