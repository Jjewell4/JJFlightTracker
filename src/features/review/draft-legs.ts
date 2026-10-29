/**
 * Turning the flights read from a screenshot into log entries (pure apart from saveLegs; unit
 * tested): what each leg still needs, whether it's already in the log, and saving several legs
 * at once — optionally as one trip.
 */
import { getAircraftType, getAirport } from '@/data/reference';
import { addFlights, newId } from '@/lib/db';
import { enrichFlight } from '@/lib/flight-utils';
import { suggestTripName, tripFromLegs } from '@/lib/trips';
import type { DraftLeg, Flight, FlightInput } from '@/lib/types';
import { inferAirline } from '@/services/lookup';
import { markLegsHandled } from '@/services/screenshot/drafts';
import { findDuplicates } from '@/features/entry/duplicates';
import { emptyValues, inferSeatType, prettyFlightNumber, validate, valuesToInput, type FormValues } from '@/features/entry/form-model';

/** The form fields a leg fills (unknown airports/aircraft are left empty for the user to pick). */
export function screenshotValues(f: DraftLeg): Partial<FormValues> {
  return {
    date: f.date,
    datePrecision: 'day',
    from: getAirport(f.from)?.ident ?? '',
    to: getAirport(f.to)?.ident ?? '',
    flightNumber: f.flightNumber,
    airline: inferAirline(f.flightNumber),
    depTime: f.depTime,
    arrTime: f.arrTime,
    arrDayOffset: f.arrDayOffset ?? undefined,
    aircraftType: getAircraftType(f.aircraftType)?.icao ?? '',
    aircraftName: '',
    seatNumber: f.seatNumber,
  };
}

/** Complete form values for a leg, as the flight form would show them. */
export function legFormValues(leg: DraftLeg, defaults: Partial<FormValues> = {}): FormValues {
  const values = screenshotValues(leg);
  return {
    ...emptyValues(defaults),
    ...values,
    flightNumber: prettyFlightNumber(values.flightNumber),
    aircraftName: getAircraftType(values.aircraftType)?.name ?? '',
    seatType: inferSeatType(values.seatNumber, values.aircraftType),
  };
}

export interface LegCheck {
  index: number;
  leg: DraftLeg;
  values: FormValues;
  /** Ready to save as is; undefined while something is missing (see `problems`). */
  input?: FlightInput;
  /** What has to be fixed in the form first, e.g. "Needs the date". */
  problems: string[];
  /** A flight already in the log that this leg matches. */
  duplicate?: Flight;
  /** Already saved or skipped from this draft. */
  handled: boolean;
}

export function checkLeg(leg: DraftLeg, index: number, flights: readonly Flight[] | undefined, opts: { defaults?: Partial<FormValues>; handled?: boolean } = {}): LegCheck {
  const values = legFormValues(leg, opts.defaults);
  const errors = validate(values);
  const problems: string[] = [];
  if (errors.date) problems.push(leg.date ? errors.date : 'Needs the date');
  if (errors.from) problems.push(leg.from ? `Unknown airport ${leg.from}` : 'Needs the departure airport');
  if (errors.to) problems.push(leg.to && !values.to ? `Unknown airport ${leg.to}` : leg.to ? errors.to : 'Needs the arrival airport');
  if (errors.times) problems.push('Check the times');
  if (errors.flightNumber) problems.push('Check the flight number');
  const duplicate = problems.length
    ? undefined
    : findDuplicates(
        { date: values.date, datePrecision: values.datePrecision, from: values.from, to: values.to, flightNumber: values.flightNumber, depTime: values.depTime },
        flights,
      ).find((m) => m.kind === 'duplicate')?.flight;
  return {
    index,
    leg,
    values,
    input: problems.length ? undefined : enrichFlight(valuesToInput(values, { source: 'screenshot' })),
    problems,
    duplicate,
    handled: !!opts.handled,
  };
}

export function checkLegs(legs: readonly DraftLeg[], flights: readonly Flight[] | undefined, opts: { defaults?: Partial<FormValues>; handled?: readonly number[] } = {}): LegCheck[] {
  const handled = new Set(opts.handled ?? []);
  return legs.map((leg, i) => checkLeg(leg, i, flights, { defaults: opts.defaults, handled: handled.has(i) }));
}

/** Legs selected by default: complete, not already logged, not yet saved. */
export function defaultSelection(checks: readonly LegCheck[]): Set<number> {
  return new Set(checks.filter((c) => c.input && !c.duplicate && !c.handled).map((c) => c.index));
}

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

/** Days a group of legs may span and still default to "save as a trip". */
const TRIP_SPAN_DAYS = 45;

/** Several legs within a few weeks of each other read as one journey (an itinerary). */
export function looksLikeTrip(inputs: readonly FlightInput[]): boolean {
  if (inputs.length < 2) return false;
  const days = inputs.map((f) => dayNumber(f.date)).filter(Number.isFinite);
  return days.length === inputs.length && Math.max(...days) - Math.min(...days) <= TRIP_SPAN_DAYS;
}

/** Unsaved inputs as Flight-shaped legs, chronological (for naming a trip before it exists). */
function asLegs(inputs: readonly FlightInput[]): Flight[] {
  return inputs
    .map((f, i) => ({ ...f, id: `draft-${i}`, createdAt: i, updatedAt: i }) as Flight)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.depTime ?? '').localeCompare(b.depTime ?? '') || a.createdAt - b.createdAt);
}

/** Automatic name for these legs as a trip ("Lisbon & Porto", "Weekend in Chicago"…). */
export function suggestedTripName(inputs: readonly FlightInput[]): string {
  if (!inputs.length) return '';
  try {
    return suggestTripName(tripFromLegs(asLegs(inputs)));
  } catch {
    return '';
  }
}

/**
 * Saves the given legs in one write — as one trip when `trip` is passed and there are two or
 * more — and marks them handled on the draft. Resolves with the saved flights (chronological).
 */
export async function saveLegs(draftId: string, checks: readonly LegCheck[], trip?: { name: string }): Promise<{ saved: Flight[]; tripId?: string }> {
  const ready = checks.filter((c): c is LegCheck & { input: FlightInput } => !!c.input);
  if (!ready.length) return { saved: [] };
  const tripId = trip && ready.length >= 2 ? newId() : undefined;
  const ordered = [...ready].sort((a, b) => a.input.date.localeCompare(b.input.date) || (a.input.depTime ?? '').localeCompare(b.input.depTime ?? ''));
  const saved = await addFlights(ordered.map((c) => (tripId ? { ...c.input, tripId, tripName: trip!.name.trim() } : c.input)));
  await markLegsHandled(
    draftId,
    ready.map((c) => c.index),
  );
  return { saved, tripId };
}
