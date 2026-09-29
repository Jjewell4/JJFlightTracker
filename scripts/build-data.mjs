#!/usr/bin/env node
/**
 * Builds compact reference datasets into public/data/:
 *   airports.json  – OurAirports (public domain) + IANA time zone via tz-lookup
 *   airlines.json  – OpenFlights airlines (ODbL) + curated overrides
 *   aircraft.json  – OpenFlights planes (ODbL) + curated overrides
 *
 * Usage: npm run data            (downloads sources)
 *        npm run data -- --cache  (reuses .scratch/ copies if present)
 *
 * Output format: { fields: string[], rows: any[][] } to keep payloads small.
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import tzlookup from 'tz-lookup';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, '.scratch');
const outDir = join(root, 'public', 'data');
const useCache = process.argv.includes('--cache');

const OA = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main';
const OF = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data';
const SOURCES = {
  'airports.csv': `${OA}/airports.csv`,
  'countries.csv': `${OA}/countries.csv`,
  'regions.csv': `${OA}/regions.csv`,
  'airlines.dat': `${OF}/airlines.dat`,
  'planes.dat': `${OF}/planes.dat`,
};

async function load(name) {
  const cached = join(cacheDir, name);
  if (useCache) {
    try {
      await access(cached);
      return readFile(cached, 'utf8');
    } catch {
      /* fall through to download */
    }
  }
  const res = await fetch(SOURCES[name]);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cached, text);
  return text;
}

/** Minimal RFC4180 CSV parser (handles quotes, escaped quotes, newlines in quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toObjects(rows) {
  const [header, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const clean = (v) => (v == null || v === '\\N' ? '' : String(v).trim());
const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

async function buildAirports() {
  const airports = toObjects(parseCsv(await load('airports.csv')));
  const countries = toObjects(parseCsv(await load('countries.csv')));
  const regions = toObjects(parseCsv(await load('regions.csv')));
  const regionName = new Map(regions.map((r) => [r.code, r.name]));

  const keepTypes = new Set(['large_airport', 'medium_airport', 'small_airport', 'seaplane_base']);
  const rows = [];
  const seen = new Set();
  for (const a of airports) {
    if (!keepTypes.has(a.type)) continue;
    const iata = clean(a.iata_code).toUpperCase();
    const hasIata = /^[A-Z0-9]{3}$/.test(iata);
    // Keep anything with an IATA code, scheduled service, or large/medium size.
    if (!hasIata && a.scheduled_service !== 'yes' && a.type !== 'large_airport' && a.type !== 'medium_airport') continue;
    const icao = clean(a.icao_code) || clean(a.gps_code);
    const ident = (/^[A-Z0-9]{4}$/.test(icao) ? icao : clean(a.ident)).toUpperCase();
    if (!ident || seen.has(ident)) continue;
    seen.add(ident);
    const lat = Number(a.latitude_deg);
    const lon = Number(a.longitude_deg);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    let tz = '';
    try {
      tz = tzlookup(lat, lon);
    } catch {
      tz = '';
    }
    const regionCode = clean(a.iso_region);
    const region = regionCode.split('-')[1] ?? '';
    const size = a.type === 'large_airport' ? 3 : a.type === 'medium_airport' ? 2 : 1;
    rows.push([
      ident,
      hasIata ? iata : '',
      clean(a.name),
      clean(a.municipality),
      region && /^[A-Z]{1,3}$/.test(region) ? region : '',
      clean(a.iso_country),
      round(lat),
      round(lon),
      tz,
      size,
      a.scheduled_service === 'yes' ? 1 : 0,
    ]);
    void regionName; // region names available if ever needed
  }
  // Larger airports first so naive searches surface them earlier.
  rows.sort((x, y) => y[9] - x[9] || y[10] - x[10] || (x[1] ? 0 : 1) - (y[1] ? 0 : 1));

  const countryRows = countries.map((c) => [clean(c.code), clean(c.name), clean(c.continent)]);
  return {
    airports: {
      fields: ['ident', 'iata', 'name', 'city', 'region', 'country', 'lat', 'lon', 'tz', 'size', 'scheduled'],
      rows,
    },
    countries: { fields: ['code', 'name', 'continent'], rows: countryRows },
  };
}

// Curated airlines that are missing, stale or ambiguous in OpenFlights.
// [name, iata, icao, callsign, country]
const AIRLINE_OVERRIDES = [
  ['United Airlines', 'UA', 'UAL', 'UNITED', 'United States'],
  ['American Airlines', 'AA', 'AAL', 'AMERICAN', 'United States'],
  ['Delta Air Lines', 'DL', 'DAL', 'DELTA', 'United States'],
  ['Southwest Airlines', 'WN', 'SWA', 'SOUTHWEST', 'United States'],
  ['Alaska Airlines', 'AS', 'ASA', 'ALASKA', 'United States'],
  ['JetBlue', 'B6', 'JBU', 'JETBLUE', 'United States'],
  ['Spirit Airlines', 'NK', 'NKS', 'SPIRIT WINGS', 'United States'],
  ['Frontier Airlines', 'F9', 'FFT', 'FRONTIER FLIGHT', 'United States'],
  ['Hawaiian Airlines', 'HA', 'HAL', 'HAWAIIAN', 'United States'],
  ['Allegiant Air', 'G4', 'AAY', 'ALLEGIANT', 'United States'],
  ['Sun Country Airlines', 'SY', 'SCX', 'SUN COUNTRY', 'United States'],
  ['Breeze Airways', 'MX', 'MXY', 'MOXY', 'United States'],
  ['Avelo Airlines', 'XP', 'VXP', 'AVELO', 'United States'],
  ['SkyWest Airlines', 'OO', 'SKW', 'SKYWEST', 'United States'],
  ['Republic Airways', 'YX', 'RPA', 'BRICKYARD', 'United States'],
  ['Envoy Air', 'MQ', 'ENY', 'ENVOY', 'United States'],
  ['Horizon Air', 'QX', 'QXE', 'HORIZON', 'United States'],
  ['PSA Airlines', 'OH', 'JIA', 'BLUE STREAK', 'United States'],
  ['Piedmont Airlines', 'PT', 'PDT', 'PIEDMONT', 'United States'],
  ['Endeavor Air', '9E', 'EDV', 'ENDEAVOR', 'United States'],
  ['Mesa Airlines', 'YV', 'ASH', 'AIR SHUTTLE', 'United States'],
  ['GoJet Airlines', 'G7', 'GJS', 'LINDBERGH', 'United States'],
  ['Air Wisconsin', 'ZW', 'AWI', 'WISCONSIN', 'United States'],
  ['CommuteAir', 'C5', 'UCA', 'COMMUTAIR', 'United States'],
  ['Contour Airlines', 'LF', 'VTE', 'VOLUNTEER', 'United States'],
  ['Southern Airways Express', '9X', 'FDY', 'SOUTHERN EXPRESS', 'United States'],
  ['Cape Air', '9K', 'KAP', 'CAIR', 'United States'],
  ['Silver Airways', '3M', 'SIL', 'SILVER WINGS', 'United States'],
  ['Air Canada', 'AC', 'ACA', 'AIR CANADA', 'Canada'],
  ['Air Canada Rouge', 'RV', 'ROU', 'ROUGE', 'Canada'],
  ['Jazz', 'QK', 'JZA', 'JAZZ', 'Canada'],
  ['WestJet', 'WS', 'WJA', 'WESTJET', 'Canada'],
  ['Porter Airlines', 'PD', 'POE', 'PORTER', 'Canada'],
  ['Flair Airlines', 'F8', 'FLE', 'FLAIR', 'Canada'],
  ['Aeromexico', 'AM', 'AMX', 'AEROMEXICO', 'Mexico'],
  ['Volaris', 'Y4', 'VOI', 'VOLARIS', 'Mexico'],
  ['Viva Aerobus', 'VB', 'VIV', 'AEROENLACES', 'Mexico'],
  ['Copa Airlines', 'CM', 'CMP', 'COPA', 'Panama'],
  ['Avianca', 'AV', 'AVA', 'AVIANCA', 'Colombia'],
  ['LATAM Airlines', 'LA', 'LAN', 'LAN', 'Chile'],
  ['LATAM Airlines Brasil', 'JJ', 'TAM', 'TAM', 'Brazil'],
  ['Azul Brazilian Airlines', 'AD', 'AZU', 'AZUL', 'Brazil'],
  ['GOL Linhas Aéreas', 'G3', 'GLO', 'GOL TRANSPORTE', 'Brazil'],
  ['JetSMART', 'JA', 'JAT', 'ROCKSMART', 'Chile'],
  ['Aerolíneas Argentinas', 'AR', 'ARG', 'ARGENTINA', 'Argentina'],
  ['Icelandair', 'FI', 'ICE', 'ICEAIR', 'Iceland'],
  ['PLAY', 'OG', 'FPY', 'PLAYER', 'Iceland'],
  ['British Airways', 'BA', 'BAW', 'SPEEDBIRD', 'United Kingdom'],
  ['Virgin Atlantic', 'VS', 'VIR', 'VIRGIN', 'United Kingdom'],
  ['easyJet', 'U2', 'EZY', 'EASY', 'United Kingdom'],
  ['Ryanair', 'FR', 'RYR', 'RYANAIR', 'Ireland'],
  ['Aer Lingus', 'EI', 'EIN', 'SHAMROCK', 'Ireland'],
  ['Lufthansa', 'LH', 'DLH', 'LUFTHANSA', 'Germany'],
  ['Air France', 'AF', 'AFR', 'AIRFRANS', 'France'],
  ['KLM Royal Dutch Airlines', 'KL', 'KLM', 'KLM', 'Netherlands'],
  ['ITA Airways', 'AZ', 'ITY', 'ITARROW', 'Italy'],
  ['Iberia', 'IB', 'IBE', 'IBERIA', 'Spain'],
  ['Swiss International Air Lines', 'LX', 'SWR', 'SWISS', 'Switzerland'],
  ['Austrian Airlines', 'OS', 'AUA', 'AUSTRIAN', 'Austria'],
  ['Scandinavian Airlines', 'SK', 'SAS', 'SCANDINAVIAN', 'Sweden'],
  ['Finnair', 'AY', 'FIN', 'FINNAIR', 'Finland'],
  ['TAP Air Portugal', 'TP', 'TAP', 'AIR PORTUGAL', 'Portugal'],
  ['Turkish Airlines', 'TK', 'THY', 'TURKISH', 'Turkey'],
  ['Emirates', 'EK', 'UAE', 'EMIRATES', 'United Arab Emirates'],
  ['Qatar Airways', 'QR', 'QTR', 'QATARI', 'Qatar'],
  ['Etihad Airways', 'EY', 'ETD', 'ETIHAD', 'United Arab Emirates'],
  ['Singapore Airlines', 'SQ', 'SIA', 'SINGAPORE', 'Singapore'],
  ['Cathay Pacific', 'CX', 'CPA', 'CATHAY', 'Hong Kong'],
  ['Japan Airlines', 'JL', 'JAL', 'JAPANAIR', 'Japan'],
  ['All Nippon Airways', 'NH', 'ANA', 'ALL NIPPON', 'Japan'],
  ['Korean Air', 'KE', 'KAL', 'KOREANAIR', 'South Korea'],
  ['Qantas', 'QF', 'QFA', 'QANTAS', 'Australia'],
  ['Air New Zealand', 'NZ', 'ANZ', 'NEW ZEALAND', 'New Zealand'],
  ['EVA Air', 'BR', 'EVA', 'EVA', 'Taiwan'],
  ['STARLUX Airlines', 'JX', 'SJX', 'STARWALKER', 'Taiwan'],
];

async function buildAirlines() {
  const rows = parseCsv(await load('airlines.dat'));
  const byIcao = new Map();
  for (const r of rows) {
    const [, name, , iataRaw, icaoRaw, callsign, country, active] = r.map(clean);
    const icao = icaoRaw.toUpperCase();
    const iata = iataRaw.toUpperCase();
    if (!/^[A-Z]{3}$/.test(icao) || !name) continue;
    const entry = [name, /^[A-Z0-9]{2}$/.test(iata) ? iata : '', icao, callsign, country, active === 'Y' ? 1 : 0];
    const prev = byIcao.get(icao);
    if (!prev || (entry[5] && !prev[5])) byIcao.set(icao, entry);
  }
  // Overrides win and are always marked active; demote other active holders of the same IATA code.
  const overrideIata = new Set(AIRLINE_OVERRIDES.map((o) => o[1]));
  for (const e of byIcao.values()) if (e[1] && overrideIata.has(e[1])) e[5] = 0;
  for (const [name, iata, icao, callsign, country] of AIRLINE_OVERRIDES) {
    byIcao.set(icao, [name, iata, icao, callsign, country, 2]); // 2 = curated major carrier
  }
  // Keep active carriers plus any defunct carrier with an IATA code (historical flights).
  const out = [...byIcao.values()]
    .filter((e) => e[5] || e[1])
    .sort((a, b) => b[5] - a[5] || a[0].localeCompare(b[0]));
  return { fields: ['name', 'iata', 'icao', 'callsign', 'country', 'active'], rows: out };
}

// [name, iata, icao, manufacturer-family grouping hint]
const AIRCRAFT_OVERRIDES = [
  ['Airbus A220-100', '221', 'BCS1'],
  ['Airbus A220-300', '223', 'BCS3'],
  ['Airbus A319neo', '31N', 'A19N'],
  ['Airbus A320neo', '32N', 'A20N'],
  ['Airbus A321neo', '32Q', 'A21N'],
  ['Airbus A330-900neo', '339', 'A339'],
  ['Airbus A330-800neo', '338', 'A338'],
  ['Airbus A350-900', '359', 'A359'],
  ['Airbus A350-1000', '351', 'A35K'],
  ['Boeing 737 MAX 7', '7M7', 'B37M'],
  ['Boeing 737 MAX 8', '7M8', 'B38M'],
  ['Boeing 737 MAX 9', '7M9', 'B39M'],
  ['Boeing 737 MAX 10', '7MJ', 'B3XM'],
  ['Boeing 777-200LR', '77L', 'B77L'],
  ['Boeing 777-300ER', '77W', 'B77W'],
  ['Boeing 787-8 Dreamliner', '788', 'B788'],
  ['Boeing 787-9 Dreamliner', '789', 'B789'],
  ['Boeing 787-10 Dreamliner', '781', 'B78X'],
  ['Embraer E175', 'E75', 'E75L'],
  ['Embraer E175 (short wing)', 'E75', 'E75S'],
  ['Embraer E190-E2', '290', 'E290'],
  ['Embraer E195-E2', '295', 'E295'],
  ['Bombardier CRJ900', 'CR9', 'CRJ9'],
  ['Bombardier CRJ700', 'CR7', 'CRJ7'],
  ['Bombardier CRJ200', 'CR2', 'CRJ2'],
  ['De Havilland Canada Dash 8-400', 'DH4', 'DH8D'],
  ['ATR 72-600', 'AT7', 'AT76'],
];

async function buildAircraft() {
  const rows = parseCsv(await load('planes.dat'));
  const byIcao = new Map();
  for (const r of rows) {
    const [name, iata, icao] = r.map(clean);
    if (!/^[A-Z0-9]{2,4}$/.test(icao.toUpperCase()) || !name) continue;
    byIcao.set(icao.toUpperCase(), [name, iata, icao.toUpperCase()]);
  }
  for (const o of AIRCRAFT_OVERRIDES) byIcao.set(o[2], o);
  const out = [...byIcao.values()].sort((a, b) => a[0].localeCompare(b[0]));
  return { fields: ['name', 'iata', 'icao'], rows: out };
}

const { airports, countries } = await buildAirports();
const airlines = await buildAirlines();
const aircraft = await buildAircraft();
await mkdir(outDir, { recursive: true });
const write = (name, data) => writeFile(join(outDir, name), JSON.stringify(data));
await write('airports.json', airports);
await write('countries.json', countries);
await write('airlines.json', airlines);
await write('aircraft.json', aircraft);
console.log(
  `airports: ${airports.rows.length}, countries: ${countries.rows.length}, airlines: ${airlines.rows.length}, aircraft: ${aircraft.rows.length}`,
);
