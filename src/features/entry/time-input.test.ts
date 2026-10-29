import { beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import { estimateArrival, hasMeridiem, needsMeridiem, parseTimeInput, splitTime, toTime } from './time-input';

beforeAll(installReference);

describe('parseTimeInput', () => {
  it('reads common typed formats', () => {
    const cases: [string, string][] = [
      ['735p', '19:35'],
      ['735 pm', '19:35'],
      ['7:35 pm', '19:35'],
      ['7:35PM', '19:35'],
      ['7.35 p.m.', '19:35'],
      ['7:35 a.m.', '07:35'],
      ['1935', '19:35'],
      ['19:35', '19:35'],
      ['19.35', '19:35'],
      ['19h35', '19:35'],
      ['0735', '07:35'],
      ['735', '07:35'],
      ['7', '07:00'],
      ['7p', '19:00'],
      ['12a', '00:00'],
      ['12:30 am', '00:30'],
      ['12p', '12:00'],
      ['12:05pm', '12:05'],
      ['0', '00:00'],
      ['23:59', '23:59'],
      ['  9 : 05  ', '09:05'],
      ['noon', '12:00'],
      ['Midnight', '00:00'],
    ];
    for (const [input, want] of cases) expect(parseTimeInput(input), input).toBe(want);
  });

  it('rejects things that are not a time', () => {
    for (const input of ['', '  ', 'abc', '24:00', '25', '7:60', '7:5', '13pm', '0am', '12345', '7:35 xm', '1:2:3', '-1'])
      expect(parseTimeInput(input), input).toBeNull();
  });

  it('applies the AM/PM toggle only to ambiguous 1–12 hours', () => {
    expect(parseTimeInput('735', { meridiem: 'pm' })).toBe('19:35');
    expect(parseTimeInput('735', { meridiem: 'am' })).toBe('07:35');
    expect(parseTimeInput('12', { meridiem: 'am' })).toBe('00:00');
    expect(parseTimeInput('12:15', { meridiem: 'pm' })).toBe('12:15');
    // explicit am/pm in the text wins
    expect(parseTimeInput('735a', { meridiem: 'pm' })).toBe('07:35');
    // 24-hour forms ignore the toggle
    expect(parseTimeInput('1935', { meridiem: 'am' })).toBe('19:35');
    expect(parseTimeInput('0735', { meridiem: 'pm' })).toBe('07:35');
    expect(parseTimeInput('0:15', { meridiem: 'pm' })).toBe('00:15');
  });

  it('knows when an AM/PM choice matters', () => {
    expect(needsMeridiem('735')).toBe(true);
    expect(needsMeridiem('7:35')).toBe(true);
    expect(needsMeridiem('12')).toBe(true);
    expect(needsMeridiem('1935')).toBe(false);
    expect(needsMeridiem('0735')).toBe(false);
    expect(needsMeridiem('7:35 pm')).toBe(false);
    expect(hasMeridiem('735p')).toBe(true);
    expect(hasMeridiem('noon')).toBe(true);
    expect(hasMeridiem('735')).toBe(false);
  });
});

describe('time parts', () => {
  it('round-trips HH:mm', () => {
    expect(splitTime('07:05')).toEqual({ h: 7, m: 5 });
    expect(splitTime('bad')).toEqual({ h: 0, m: 0 });
    expect(toTime(7, 5)).toBe('07:05');
    expect(toTime(23, 59)).toBe('23:59');
  });
});

describe('estimateArrival', () => {
  it('estimates local arrival across time zones', () => {
    // SAN (PDT) → JFK (EDT): ~3,930 km ≈ 5h14m block, +3h zone change; 16:19 PDT rounds to 16:20.
    const e = estimateArrival({ date: '2026-10-27', depTime: '11:05', from: 'KSAN', to: 'KJFK' })!;
    expect(e.durationMin).toBe(314);
    expect(e.time).toBe('19:20');
    expect(e.dayOffset).toBe(0);
  });

  it('rolls over to the next day', () => {
    const e = estimateArrival({ date: '2026-10-27', depTime: '22:30', from: 'KSAN', to: 'KJFK' })!;
    expect(e.dayOffset).toBe(1);
    expect(e.time).toBe('06:45');
  });

  it('rounds to five minutes', () => {
    const e = estimateArrival({ date: '2024-03-04', depTime: '08:03', from: 'KSAN', to: 'KSFO' })!;
    expect(Number(e.time.slice(3)) % 5).toBe(0);
  });

  it('needs both airports and a departure time', () => {
    expect(estimateArrival({ date: '2026-10-27', depTime: '', from: 'KSAN', to: 'KJFK' })).toBeUndefined();
    expect(estimateArrival({ date: '2026-10-27', depTime: '08:00', from: 'KSAN', to: '' })).toBeUndefined();
    expect(estimateArrival({ date: '2026-10-27', depTime: '08:00', from: 'KSAN', to: 'KSAN' })).toBeUndefined();
  });
});
