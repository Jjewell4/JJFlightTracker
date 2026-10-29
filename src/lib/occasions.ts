/** Occasion tags: the optional "what was the trip for" category (vacation, wedding, …). */
import type { FlightOccasion, FlightReason } from './types';

export const FLIGHT_OCCASIONS: readonly FlightOccasion[] = [
  'vacation',
  'family',
  'friends',
  'wedding',
  'holiday',
  'event',
  'conference',
  'work',
  'school',
  'moving',
  'other',
];

export const OCCASION_LABELS: Record<FlightOccasion, string> = {
  vacation: 'Vacation',
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

export const OCCASION_EMOJI: Record<FlightOccasion, string> = {
  vacation: '🏖️',
  family: '🏡',
  friends: '🫶',
  wedding: '💍',
  holiday: '🎄',
  event: '🎟️',
  conference: '🎤',
  work: '💼',
  school: '🎓',
  moving: '📦',
  other: '🏷️',
};

/** The reason an occasion implies, used to fill an empty reason. */
export const OCCASION_REASON: Partial<Record<FlightOccasion, FlightReason>> = {
  vacation: 'leisure',
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
  if (/wedding/.test(t)) return 'wedding';
  if (/christmas|thanksgiving|holidays|easter|new year/.test(t)) return 'holiday';
  if (/conference|summit|convention|expo/.test(t)) return 'conference';
  if (/work|business|meeting|client|offsite/.test(t)) return 'work';
  if (/family|parents|home/.test(t)) return 'family';
  if (/friend/.test(t)) return 'friends';
  if (/concert|game|festival|event|show|match/.test(t)) return 'event';
  if (/school|college|university|campus|study/.test(t)) return 'school';
  if (/mov(e|ing)|relocat/.test(t)) return 'moving';
  return undefined;
}
