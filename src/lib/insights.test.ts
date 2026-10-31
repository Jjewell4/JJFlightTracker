import { beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import { findInsights, type InsightInput } from './insights';
import { detectTrips } from './trips';
import type { Flight } from './types';

beforeAll(installReference);

let n = 0;
const flight = (date: string, from: string, to: string, extra: Partial<Flight> = {}): Flight => ({
  id: `f${++n}`, date, datePrecision: 'day', from, to, depTime: '09:00', source: 'manual', createdAt: n, updatedAt: n, ...extra,
});
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A round trip from San Diego leaving on `date`, back after `nights`. */
const roundTrip = (date: string, to: string, nights: number, extra: Partial<Flight> = {}) => [
  flight(date, 'KSAN', to, extra),
  flight(addDays(date, nights), to, 'KSAN', extra),
];

const input = (flights: Flight[], over: Partial<InsightInput> = {}): InsightInput => ({
  flights,
  allFlights: flights,
  trips: detectTrips(flights),
  scope: 'all',
  unit: 'mi',
  audience: 'owner',
  ...over,
});
const ids = (i: InsightInput) => findInsights(i).map((f) => f.id);

describe('findInsights', () => {
  it('compares business and leisure trips when both sides have enough trips', () => {
    const flights: Flight[] = [];
    // Business: Monday departures, 2 nights. Leisure: Friday departures, 7 nights.
    for (let i = 0; i < 6; i++) flights.push(...roundTrip(addDays('2024-01-08', i * 14), 'KSFO', 2, { reason: 'business', airlineIcao: 'UAL' }));
    for (let i = 0; i < 6; i++) flights.push(...roundTrip(addDays('2024-04-05', i * 21), 'PHNL', 7, { reason: 'leisure', airlineIcao: 'UAL' }));
    const found = findInsights(input(flights));
    const length = found.find((f) => f.id === 'trip-length-reason');
    expect(length?.title).toBe('Leisure trips run 3.5× longer');
    expect(length?.visual?.items.map((i) => i.display)).toEqual(['7 nights', '2 nights']);
    expect(found.find((f) => f.id === 'departure-day-reason')?.title).toBe('Business trips start on Mondays');
    expect(found.find((f) => f.id === 'distance-reason')?.title).toMatch(/^Leisure flights go/);
    // Strongest first.
    expect(found.map((f) => f.score)).toEqual([...found.map((f) => f.score)].sort((a, b) => b - a));
  });

  it('says nothing when a group is too small or the difference too slight', () => {
    const flights: Flight[] = [];
    for (let i = 0; i < 6; i++) flights.push(...roundTrip(addDays('2024-01-08', i * 14), 'KSFO', 3, { reason: 'business' }));
    for (let i = 0; i < 2; i++) flights.push(...roundTrip(addDays('2024-06-07', i * 21), 'PHNL', 9, { reason: 'leisure' }));
    expect(ids(input(flights))).not.toContain('trip-length-reason');
    const even: Flight[] = [];
    for (let i = 0; i < 6; i++) even.push(...roundTrip(addDays('2024-01-08', i * 14), 'KSFO', 3, { reason: 'business' }));
    for (let i = 0; i < 6; i++) even.push(...roundTrip(addDays('2024-06-07', i * 14), 'KSFO', 3, { reason: 'leisure' }));
    expect(ids(input(even))).not.toContain('trip-length-reason');
  });

  it('notices an airline switch and a new regular destination', () => {
    const flights: Flight[] = [];
    for (let i = 0; i < 6; i++) flights.push(...roundTrip(`${2019 + (i % 3)}-0${1 + i}-10`, 'KDFW', 3, { airlineIcao: 'AAL' }));
    for (let i = 0; i < 6; i++) flights.push(...roundTrip(`${2023 + (i % 2)}-0${1 + i}-10`, 'KDEN', 3, { airlineIcao: 'UAL' }));
    const found = findInsights(input(flights));
    const sw = found.find((f) => f.id === 'airline-shift');
    expect(sw?.title).toBe('You’ve switched to United Airlines');
    expect(sw?.link).toEqual({ airline: 'UAL' });
    expect(found.find((f) => f.id === 'new-favorite')?.title).toBe('Denver is a new regular');
  });

  it('finds outliers and streaks', () => {
    const flights: Flight[] = [];
    for (let m = 1; m <= 9; m++) flights.push(...roundTrip(`2022-0${m}-03`, 'KSFO', 2));
    flights.push(...roundTrip('2022-10-01', 'LPPT', 21));
    const found = findInsights(input(flights));
    expect(found.find((f) => f.id === 'long-trip')?.title).toBe('21 nights in Lisbon');
    expect(found.find((f) => f.id === 'month-streak')?.title).toBe('10 months in a row with a flight');
  });

  it('speaks about the owner to visitors', () => {
    const flights: Flight[] = [];
    for (let i = 0; i < 6; i++) flights.push(...roundTrip(`${2019 + (i % 3)}-0${1 + i}-10`, 'KDFW', 3, { airlineIcao: 'AAL' }));
    for (let i = 0; i < 6; i++) flights.push(...roundTrip(`${2023 + (i % 2)}-0${1 + i}-10`, 'KDEN', 3, { airlineIcao: 'UAL' }));
    const found = findInsights(input(flights, { audience: 'visitor' }));
    expect(found.find((f) => f.id === 'airline-shift')?.title).toBe('They’ve switched to United Airlines');
  });
});
