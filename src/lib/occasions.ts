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

/** A trip's occasion: the one its tagged legs share (untagged legs don't count against it). */
export function tripOccasion(trip: { flights: readonly { occasion?: FlightOccasion }[] }): FlightOccasion | undefined {
  const tags = new Set(trip.flights.map((f) => f.occasion).filter(Boolean));
  return tags.size === 1 ? [...tags][0] : undefined;
}
