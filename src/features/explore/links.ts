/**
 * Hrefs for the airport and airline history pages. Kept dependency-free so any screen can
 * link here without pulling in the aggregation code.
 */

/** `/airports/KSAN` — `ident` is an airport ident (or the raw code of an unknown airport). */
export function airportHref(ident: string): string {
  return `/airports/${encodeURIComponent(ident.trim().toUpperCase())}`;
}

/** `/airlines/ASA` — `key` is `airlineKey()` (ICAO, IATA fallback or `name:<normalized>`). */
export function airlineHref(key: string): string {
  return `/airlines/${encodeURIComponent(key)}`;
}
