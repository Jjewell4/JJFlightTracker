/** Occasion tags: the optional "what was the trip for" category (vacation, wedding, …). */
import type { IconName } from '@/components/Icon';
import type { FlightOccasion, FlightReason } from './types';

export const FLIGHT_OCCASIONS: readonly FlightOccasion[] = [
  'vacation',
  'nature',
  'family',
  'friends',
  'wedding',
  'holiday',
  'event',
  'sports',
  'conference',
  'work',
  'school',
  'moving',
  'other',
];

export const OCCASION_LABELS: Record<FlightOccasion, string> = {
  vacation: 'Vacation',
  nature: 'Nature',
  sports: 'Sports',
  family: 'Family',
  friends: 'Friends',
  wedding: 'Wedding',
  holiday: 'Holidays',
  event: 'Event',
  conference: 'Conference',
  work: 'Work trip',
  school: 'School',
  moving: 'Moving',
  other: 'Other',
};

/** Line icon for each occasion (same set as the rest of the app). */
export const OCCASION_ICON: Record<FlightOccasion, IconName> = {
  vacation: 'palm',
  nature: 'mountain',
  sports: 'trophy',
  family: 'home',
  friends: 'users',
  wedding: 'ring',
  holiday: 'gift',
  event: 'ticket',
  conference: 'mic',
  work: 'briefcase',
  school: 'graduation',
  moving: 'box',
  other: 'tag',
};

/** The reason an occasion implies, used to fill an empty reason. */
export const OCCASION_REASON: Partial<Record<FlightOccasion, FlightReason>> = {
  vacation: 'leisure',
  nature: 'leisure',
  sports: 'leisure',
  family: 'leisure',
  friends: 'leisure',
  wedding: 'leisure',
  holiday: 'leisure',
  event: 'leisure',
  conference: 'business',
  work: 'business',
};

export const occasionLabel = (o: FlightOccasion | undefined) => (o ? OCCASION_LABELS[o] : undefined);

export const isOccasion = (v: unknown): v is FlightOccasion => typeof v === 'string' && (FLIGHT_OCCASIONS as readonly string[]).includes(v);

/** Imported text (a key, a label or a common synonym) → occasion. */
export function parseOccasion(v: unknown): FlightOccasion | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase();
  if (!t) return undefined;
  if (isOccasion(t)) return t;
  const hit = FLIGHT_OCCASIONS.find((o) => OCCASION_LABELS[o].toLowerCase() === t);
  if (hit) return hit;
  if (/vacation|holiday trip|getaway|honeymoon|tourism/.test(t)) return 'vacation';
  if (/hik(e|ing)|national park|camping|safari|outdoors|nature|trek/.test(t)) return 'nature';
  if (/sport|game|match|tournament|race|marathon|ski(ing)?\b|golf|playoff|super bowl|world cup/.test(t)) return 'sports';
  if (/wedding/.test(t)) return 'wedding';
  if (/christmas|thanksgiving|holidays|easter|new year/.test(t)) return 'holiday';
  if (/conference|summit|convention|expo/.test(t)) return 'conference';
  if (/work|business|meeting|client|offsite/.test(t)) return 'work';
  if (/family|parents|home/.test(t)) return 'family';
  if (/friend/.test(t)) return 'friends';
  if (/concert|festival|event|show/.test(t)) return 'event';
  if (/school|college|university|campus|study/.test(t)) return 'school';
  if (/mov(e|ing)|relocat/.test(t)) return 'moving';
  return undefined;
}

/** A trip or flight has at most this many occasions (a wedding plus a vacation). */
export const MAX_OCCASIONS = 2;

/** The flight's occasions, first one first. */
export function occasionsOf(f: { occasion?: FlightOccasion; occasion2?: FlightOccasion }): FlightOccasion[] {
  const out: FlightOccasion[] = [];
  for (const o of [f.occasion, f.occasion2]) if (isOccasion(o) && !out.includes(o)) out.push(o);
  return out;
}

/** Stored form of a list: `occasion` (+ `occasion2`); both cleared when the list is empty. */
export function occasionFields(list: readonly (FlightOccasion | undefined)[]): { occasion?: FlightOccasion; occasion2?: FlightOccasion } {
  const clean = list.filter(isOccasion).filter((o, i, all) => all.indexOf(o) === i).slice(0, MAX_OCCASIONS);
  return { occasion: clean[0], occasion2: clean[1] };
}

/** Tapping an occasion: removes it if picked, else adds it (replacing the oldest when full). */
export function toggleOccasion(list: readonly FlightOccasion[], o: FlightOccasion): FlightOccasion[] {
  if (list.includes(o)) return list.filter((x) => x !== o);
  return [...list, o].slice(-MAX_OCCASIONS);
}

/** "Wedding · Vacation". */
export const formatOccasions = (list: readonly FlightOccasion[]) => list.map((o) => OCCASION_LABELS[o]).join(' · ');

/** The reason the occasions imply (the first one that implies any). */
export function occasionReason(list: readonly FlightOccasion[]): FlightReason | undefined {
  for (const o of list) if (OCCASION_REASON[o]) return OCCASION_REASON[o];
  return undefined;
}

/**
 * A trip's occasions: every occasion its legs carry (untagged legs don't count against it).
 * More than two different ones across the legs reads as `mixed`.
 */
export function tripOccasions(trip: { flights: readonly { occasion?: FlightOccasion; occasion2?: FlightOccasion }[] }): { occasions: FlightOccasion[]; mixed: boolean } {
  const all: FlightOccasion[] = [];
  for (const f of trip.flights) for (const o of occasionsOf(f)) if (!all.includes(o)) all.push(o);
  return all.length > MAX_OCCASIONS ? { occasions: [], mixed: true } : { occasions: all, mixed: false };
}

/** Imported text with up to two occasions ("wedding, vacation" / "Wedding & honeymoon"). */
export function parseOccasions(v: unknown): FlightOccasion[] {
  if (typeof v !== 'string') return [];
  const whole = parseOccasion(v);
  const parts = v.split(/[,;/&+|]| and /i).map(parseOccasion).filter((o): o is FlightOccasion => !!o);
  const list = parts.length > 1 ? parts : whole ? [whole] : parts;
  return occasionsOf({ occasion: list[0], occasion2: list.find((o) => o !== list[0]) });
}
