import { describe, expect, it } from 'vitest';
import { ALL_FIELDS } from '@/lib/flight-source';
import { publicFields } from '@/features/public/profile';
import { insightAvailable, statsSections } from './sections';

const withData = { weekday: [3, 1, 0, 0, 2, 1, 0], hour: new Array(24).fill(1), registrations: [{ key: 'N123', count: 2, lastFlightId: 'a' }] };
const noData = { weekday: new Array(7).fill(0), hour: new Array(24).fill(0), registrations: [] };

describe('stats section availability', () => {
  it('keeps every section for the owner, including empty "add …" prompts', () => {
    expect(statsSections(ALL_FIELDS, withData)).toEqual({
      weekday: true,
      departureHour: true,
      cabin: true,
      seat: true,
      reason: true,
      registrations: true,
      durationRecords: true,
      busiestDay: true,
      timeEstimated: false,
    });
    // Charts that would be empty are skipped, but the categorical prompts stay.
    const empty = statsSections(ALL_FIELDS, noData);
    expect(empty).toMatchObject({ weekday: false, departureHour: false, registrations: false, cabin: true, seat: true, reason: true });
  });

  it('hides everything public journals cannot contain, even if values leaked in', () => {
    const month = statsSections(publicFields([{ datePrecision: 'month' }]), withData);
    expect(month).toEqual({
      weekday: false,
      departureHour: false,
      cabin: false,
      seat: false,
      reason: false,
      registrations: false,
      durationRecords: false,
      busiestDay: false,
      timeEstimated: true,
    });
  });

  it('shows day-of-week patterns only when the owner shares exact dates', () => {
    const exact = publicFields([{ datePrecision: 'day' }, { datePrecision: 'year' }]);
    expect(statsSections(exact, withData)).toMatchObject({ weekday: true, busiestDay: true, departureHour: false, timeEstimated: true });
    expect(statsSections(exact, noData).weekday).toBe(false);
  });

  it('drops insights about fields a source does not have', () => {
    const pub = publicFields([{ datePrecision: 'month' }]);
    expect(['seat', 'hour', 'cabin', 'reason', 'weekday'].filter((id) => insightAvailable(id, pub))).toEqual([]);
    expect(insightAvailable('haul', pub)).toBe(true);
    expect(['seat', 'hour', 'cabin', 'reason', 'weekday', 'haul'].every((id) => insightAvailable(id, ALL_FIELDS))).toBe(true);
  });
});
