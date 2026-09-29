/** Loads the real reference datasets from public/data for unit tests (no network). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReference, isReferenceLoaded, setReference } from '@/data/reference';

export function installReference(): void {
  if (isReferenceLoaded()) return;
  const read = (name: string) => JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', name), 'utf8'));
  setReference(
    buildReference({
      airports: read('airports.json'),
      airlines: read('airlines.json'),
      aircraft: read('aircraft.json'),
      countries: read('countries.json'),
    }),
  );
}
