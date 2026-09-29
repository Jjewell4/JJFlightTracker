/**
 * Column mapping for spreadsheet imports: which column feeds which flight field.
 * Auto-detects from header names (Flightradar24 headers included) and, for the
 * airport columns, from the values themselves.
 */
import { getAirport } from '@/data/reference';
import { detectDateOrder, cellText, type Cell, type DateOrder } from './cells';
import { parseAirportRef } from './refs';
import type { Sheet } from './sheet';

export const MAPPING_FIELDS = [
  'date',
  'flightNumber',
  'from',
  'to',
  'route',
  'depTime',
  'arrTime',
  'duration',
  'airline',
  'aircraft',
  'registration',
  'seatNumber',
  'seatType',
  'cabinClass',
  'reason',
  'note',
] as const;

export type MappingField = (typeof MAPPING_FIELDS)[number];

/** field → column index (-1 / missing = not mapped). */
export type ColumnMapping = Partial<Record<MappingField, number>>;

export const FIELD_LABELS: Record<MappingField, { label: string; hint?: string; required?: boolean }> = {
  date: { label: 'Date', hint: 'Departure date', required: true },
  flightNumber: { label: 'Flight number', hint: 'e.g. UA123' },
  from: { label: 'From', hint: 'IATA/ICAO code or airport', required: true },
  to: { label: 'To', hint: 'IATA/ICAO code or airport', required: true },
  route: { label: 'Route (one column)', hint: 'e.g. SAN-LAX — use instead of From/To' },
  depTime: { label: 'Departure time' },
  arrTime: { label: 'Arrival time' },
  duration: { label: 'Duration' },
  airline: { label: 'Airline' },
  aircraft: { label: 'Aircraft type' },
  registration: { label: 'Tail number' },
  seatNumber: { label: 'Seat' },
  seatType: { label: 'Seat type', hint: 'window / middle / aisle' },
  cabinClass: { label: 'Cabin class', hint: 'economy, business, …' },
  reason: { label: 'Reason', hint: 'leisure, business, …' },
  note: { label: 'Notes' },
};

/** Lowercase, punctuation → single underscore. */
export function headerKey(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// Exact (normalized) header names, strongest evidence first.
const SYNONYMS: Record<MappingField, string[]> = {
  date: ['date', 'flight_date', 'departure_date', 'dep_date', 'date_of_flight', 'day', 'when', 'date_departure', 'depart_date', 'travel_date'],
  flightNumber: ['flight_number', 'flight_no', 'flight_nr', 'flightnumber', 'flight', 'flight_num', 'flt', 'flt_no', 'flight_code', 'number'],
  from: ['from', 'origin', 'departure_airport', 'dep_airport', 'from_airport', 'origin_airport', 'depart_airport', 'departure', 'dep', 'orig', 'from_iata', 'origin_iata', 'from_code', 'airport_from', 'takeoff'],
  to: ['to', 'destination', 'arrival_airport', 'arr_airport', 'to_airport', 'destination_airport', 'arrive_airport', 'arrival', 'arr', 'dest', 'to_iata', 'destination_iata', 'to_code', 'airport_to', 'landing'],
  route: ['route', 'routing', 'sector', 'segment', 'leg'],
  depTime: ['dep_time', 'departure_time', 'depart_time', 'time_departure', 'std', 'atd', 'off_block', 'dep_time_local', 'departure_time_local', 'takeoff_time', 'time'],
  arrTime: ['arr_time', 'arrival_time', 'arrive_time', 'time_arrival', 'sta', 'ata', 'on_block', 'arr_time_local', 'arrival_time_local', 'landing_time'],
  duration: ['duration', 'flight_time', 'block_time', 'elapsed', 'air_time', 'flight_duration', 'duration_min', 'duration_minutes', 'total_time'],
  airline: ['airline', 'carrier', 'operator', 'airline_name', 'operating_carrier', 'airline_code', 'marketing_carrier'],
  aircraft: ['aircraft', 'aircraft_type', 'plane', 'equipment', 'type', 'aircraft_model', 'plane_type', 'aircraft_name', 'model'],
  registration: ['registration', 'reg', 'tail', 'tail_number', 'tail_no', 'tailnumber', 'tail_', 'aircraft_registration', 'n_number', 'reg_no'],
  seatNumber: ['seat_number', 'seat', 'seat_no', 'seat_nr', 'seat_assignment'],
  seatType: ['seat_type', 'seat_position', 'seat_location', 'window_aisle'],
  cabinClass: ['flight_class', 'class', 'cabin', 'cabin_class', 'travel_class', 'fare_class', 'service_class'],
  reason: ['flight_reason', 'reason', 'purpose', 'trip_type', 'trip_purpose', 'flight_purpose', 'trip_reason'],
  note: ['note', 'notes', 'comment', 'comments', 'remarks', 'memo', 'description', 'details'],
};

/** Header names that mark a Flightradar24 export. */
const FR24_KEYS = ['flight_number', 'dep_time', 'arr_time', 'seat_number', 'seat_type', 'flight_class', 'flight_reason', 'dep_id', 'arr_id', 'airline_id', 'aircraft_id'];

export type SheetFormat = 'fr24' | 'generic';

/** True when the headers look like a my.flightradar24.com export. */
export function detectFormat(headers: string[]): SheetFormat {
  const keys = new Set(headers.map(headerKey));
  const hits = FR24_KEYS.filter((k) => keys.has(k)).length;
  return keys.has('date') && keys.has('from') && keys.has('to') && hits >= 4 ? 'fr24' : 'generic';
}

function looksLikeAirportColumn(sheet: Sheet, col: number): boolean {
  const sample = sheet.rows.slice(0, 40).map((r) => r[col]).filter((c) => cellText(c) !== '');
  if (sample.length < 1) return false;
  const ok = sample.filter((c) => {
    const ref = parseAirportRef(c);
    return !!ref && (!!getAirport(ref.icao) || !!getAirport(ref.iata));
  }).length;
  return ok / sample.length >= 0.7;
}

function looksLikeDateColumn(sheet: Sheet, col: number, parse: (c: Cell) => unknown): boolean {
  const sample = sheet.rows.slice(0, 40).map((r) => r[col]).filter((c) => cellText(c) !== '');
  return sample.length > 0 && sample.filter((c) => parse(c)).length / sample.length >= 0.7;
}

/**
 * Auto-detects a mapping. `isDate` lets callers plug the real date parser in for
 * value-based fallback (kept as a parameter to avoid a circular import).
 */
export function detectMapping(sheet: Sheet, isDate?: (c: Cell) => unknown): ColumnMapping {
  const keys = sheet.headers.map(headerKey);
  const mapping: ColumnMapping = {};
  const used = new Set<number>();

  // Pass 1: exact header names, in each field's synonym priority.
  for (const field of MAPPING_FIELDS) {
    for (const syn of SYNONYMS[field]) {
      const idx = keys.findIndex((k, i) => k === syn && !used.has(i));
      if (idx >= 0) {
        mapping[field] = idx;
        used.add(idx);
        break;
      }
    }
  }
  // Pass 2: loose "contains" matches for the important fields.
  const loose: [MappingField, RegExp][] = [
    ['date', /date/],
    ['flightNumber', /flight.*(no|num)|flt/],
    ['from', /^(from|origin|dep(arture)?_?(airport|city|code))|from_/],
    ['to', /^(to|dest)|arr(ival)?_?(airport|city|code)|to_/],
    ['airline', /airline|carrier/],
    ['aircraft', /aircraft|plane|equipment/],
    ['registration', /regist|tail/],
    ['note', /note|comment|remark/],
    ['seatNumber', /seat/],
    ['cabinClass', /class|cabin/],
    ['duration', /duration|block/],
  ];
  for (const [field, re] of loose) {
    if (mapping[field] !== undefined) continue;
    const idx = keys.findIndex((k, i) => re.test(k) && !used.has(i));
    if (idx >= 0) {
      mapping[field] = idx;
      used.add(idx);
    }
  }
  // Pass 3: value sniffing for airports and dates when headers gave us nothing.
  if (mapping.route === undefined && (mapping.from === undefined || mapping.to === undefined)) {
    const cols = keys.map((_, i) => i).filter((i) => !used.has(i) && looksLikeAirportColumn(sheet, i));
    for (const field of ['from', 'to'] as const) {
      if (mapping[field] === undefined && cols.length) {
        const c = cols.shift()!;
        mapping[field] = c;
        used.add(c);
      }
    }
  }
  if (mapping.date === undefined && isDate) {
    const c = keys.findIndex((_, i) => !used.has(i) && looksLikeDateColumn(sheet, i, isDate));
    if (c >= 0) mapping.date = c;
  }
  // A "route" column and separate from/to columns are redundant; prefer from/to.
  if (mapping.route !== undefined && mapping.from !== undefined && mapping.to !== undefined) delete mapping.route;
  return mapping;
}

/** Whether the mapping has what's needed to build flights. */
export function mappingIsComplete(m: ColumnMapping): boolean {
  const has = (f: MappingField) => m[f] !== undefined && m[f]! >= 0;
  return has('date') && (has('route') || (has('from') && has('to')));
}

export function guessDateOrder(sheet: Sheet, dateCol: number | undefined): DateOrder {
  if (dateCol === undefined || dateCol < 0) return 'mdy';
  return detectDateOrder(sheet.rows.map((r) => r[dateCol]));
}
