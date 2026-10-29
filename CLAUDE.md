# FlightJournal — personal flight tracker PWA

Mobile-first, offline-capable personal flight log (a better "my.flightradar24"), deployed on Vercel
from `main` (other branches don't deploy — see vercel.json).
Local-first: flights live in IndexedDB on the device and sync to Supabase when signed in
(`src/services/sync`, `supabase/schema.sql`). Public journals (`/<handle>`) are served from a
privacy-filtered Supabase RPC (`supabase/public-profiles.sql`). One serverless function,
`api/extract-flight.ts` (+ `server/screenshot.ts`), reads flight screenshots with Gemini;
`GET` on it returns setup diagnostics. Server secrets (GEMINI_API_KEY) never get a VITE_ prefix.
Screenshot imports become device-only **drafts** (Dexie `drafts` table, `src/services/screenshot/drafts.ts`)
read in the background and reviewed in **To review** (`src/features/review/`: pick legs, save several
at once, optionally as a trip). Interrupted reads resume on the next launch.

## Stack
- Vite 8 + React 19 + TypeScript (strict), `react-router-dom` v7 with **HashRouter** (static hosting / GitHub Pages).
- Dexie 4 (IndexedDB) + `dexie-react-hooks` for live queries.
- `vite-plugin-pwa` (Workbox, `registerType: 'prompt'`), manifest in `public/manifest.webmanifest`.
- MapLibre GL for the map. Charts are hand-built SVG components (no chart library).
- Plain CSS with design tokens (`src/styles/tokens.css`). Every color/spacing/radius must use a token.
- Vitest + jsdom + fake-indexeddb for tests.
- `npm i` needs `legacy-peer-deps` (set in `.npmrc`).

## Commands
- `npm run dev` / `npm run build` / `npm run preview`
- `npm test` (vitest run), `npm run typecheck`
- `npm run data -- --cache` regenerates `public/data/*.json` from OurAirports + OpenFlights
- Browser checks: Playwright needs `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`
  in this environment; dev builds expose `window.__seedSampleFlights()` for sample data and
  `localStorage.flightlog.onboarded = '1'` skips the welcome screen.

## Layout
- `src/lib/types.ts` — domain types (Flight, Airport, Airline, Settings). Shared contract: add fields, never rename.
- `src/lib/db.ts` — Dexie DB + repository functions + hooks (`useFlights`, `useFlight`, `useSettings`).
- `src/lib/trips.ts` — trip detection (`detectTrips`), automatic names (`suggestTripName`, `tripTitle`),
  `tripFromLegs` for naming unsaved legs. Saved trips are a shared `tripId`/`tripName` on each leg.
- `src/data/reference.ts` — airport/airline/aircraft datasets, sync lookups after `loadReference()`,
  ranked search (`searchAirports`, `searchAirlines`, `searchAircraftTypes`), `useReferenceReady()`.
- `src/lib/geo.ts` (distance, great-circle arcs), `src/lib/time.ts` (tz-aware durations, formatting),
  `src/lib/flight-utils.ts` (flight number parsing, `enrichFlight`, display helpers).
- `src/components/` — shared UI (AppShell, Icon, …). `src/features/<area>/` — one folder per screen/area.
- `src/test/reference-fixture.ts` — `installReference()` loads real datasets in unit tests.

## Conventions
- Airports are keyed by `ident` (ICAO when available). Display IATA via `airportCode()`.
- Airlines keyed by ICAO (`airlineIcao`), with IATA + name as fallbacks.
- Always run new/edited flights through `enrichFlight()` before saving.
- Mobile first: design at 390px width, then scale up (sidebar layout at ≥960px).
  Touch targets ≥44px, respect safe-area insets, no hover-only affordances.
- Keep lookups graceful offline: network features must degrade silently.
- SQL files in `supabase/` must stay safe to re-run; the user pastes them into the SQL editor.
