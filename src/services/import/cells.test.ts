import { describe, expect, it } from 'vitest';
import {
  cellText,
  detectDateOrder,
  excelSerialToParts,
  minutesToHHmm,
  parseCabinClass,
  parseDateValue,
  parseDurationMinutes,
  parseFlightReason,
  parseSeatType,
  parseTimeOfDay,
} from './cells';

describe('parseDateValue', () => {
  it('parses full ISO dates', () => {
    expect(parseDateValue('2019-03-14')).toEqual({ date: '2019-03-14', precision: 'day', minutes: undefined });
    expect(parseDateValue(' 2019-3-4 ')?.date).toBe('2019-03-04');
    expect(parseDateValue('2019/03/14')?.date).toBe('2019-03-14');
  });
  it('parses partial dates with precision', () => {
    expect(parseDateValue('2019-03')).toEqual({ date: '2019-03-01', precision: 'month' });
    expect(parseDateValue('2019')).toEqual({ date: '2019-01-01', precision: 'year' });
    expect(parseDateValue('3/2019')).toEqual({ date: '2019-03-01', precision: 'month' });
    expect(parseDateValue('March 2019')?.precision).toBe('month');
    expect(parseDateValue('2019 Mar')?.date).toBe('2019-03-01');
  });
  it('rejects impossible dates', () => {
    expect(parseDateValue('2018-02-30')).toBeUndefined();
    expect(parseDateValue('2019-13-01')).toBeUndefined();
    expect(parseDateValue('13/13/2019')).toBeUndefined();
    expect(parseDateValue('hello')).toBeUndefined();
    expect(parseDateValue('')).toBeUndefined();
    expect(parseDateValue(null)).toBeUndefined();
    expect(parseDateValue('1850')).toBeUndefined();
  });
  it('handles Excel-mangled US dates', () => {
    expect(parseDateValue('3/14/2019')?.date).toBe('2019-03-14');
    expect(parseDateValue('03/14/2019')?.date).toBe('2019-03-14');
    expect(parseDateValue('3/14/19')).toMatchObject({ date: '2019-03-14', note: expect.stringContaining('2019') });
    expect(parseDateValue('12-24-2016')?.date).toBe('2016-12-24');
  });
  it('resolves ambiguous slash dates by the requested order, but evidence wins', () => {
    expect(parseDateValue('3/4/2019', 'mdy')?.date).toBe('2019-03-04');
    expect(parseDateValue('3/4/2019', 'dmy')?.date).toBe('2019-04-03');
    expect(parseDateValue('14/3/2019', 'mdy')?.date).toBe('2019-03-14');
    expect(parseDateValue('3/14/2019', 'dmy')?.date).toBe('2019-03-14');
    expect(parseDateValue('14.03.2019')?.date).toBe('2019-03-14');
  });
  it('parses month names', () => {
    expect(parseDateValue('14 Mar 2019')?.date).toBe('2019-03-14');
    expect(parseDateValue('14-Mar-2019')?.date).toBe('2019-03-14');
    expect(parseDateValue('Mar 14, 2019')?.date).toBe('2019-03-14');
    expect(parseDateValue('March 14th, 2019')?.date).toBe('2019-03-14');
    expect(parseDateValue('Mar-19')).toMatchObject({ date: '2019-03-01', precision: 'month' });
  });
  it('extracts a time from datetimes', () => {
    expect(parseDateValue('2019-03-14T07:35:00')).toMatchObject({ date: '2019-03-14', minutes: 455 });
    expect(parseDateValue('2019-03-14 7:35 PM')).toMatchObject({ date: '2019-03-14', minutes: 19 * 60 + 35 });
    expect(parseDateValue('3/14/2019 07:35')).toMatchObject({ date: '2019-03-14', minutes: 455 });
  });
  it('handles real Excel values: Dates, serials, years', () => {
    expect(parseDateValue(new Date(Date.UTC(2019, 2, 14)))).toMatchObject({ date: '2019-03-14', precision: 'day' });
    expect(parseDateValue(43538)).toMatchObject({ date: '2019-03-14', precision: 'day' });
    expect(parseDateValue(43538.315972222)).toMatchObject({ date: '2019-03-14', minutes: 455 });
    expect(parseDateValue(2019)).toEqual({ date: '2019-01-01', precision: 'year' });
    expect(parseDateValue('43538')?.date).toBe('2019-03-14');
    expect(parseDateValue(new Date('invalid'))).toBeUndefined();
  });
  it('converts serials', () => {
    expect(excelSerialToParts(43538)?.date).toBe('2019-03-14');
    expect(excelSerialToParts(45000)?.date).toBe('2023-03-15');
    expect(excelSerialToParts(0)).toBeUndefined();
  });
});

describe('detectDateOrder', () => {
  it('uses evidence from unambiguous values', () => {
    expect(detectDateOrder(['3/14/2019', '5/6/2019'])).toBe('mdy');
    expect(detectDateOrder(['14/3/2019', '5/6/2019'])).toBe('dmy');
    expect(detectDateOrder(['5/6/2019'])).toBe('mdy');
    expect(detectDateOrder(['14.03.2019'])).toBe('dmy');
    expect(detectDateOrder([12345, null])).toBe('mdy');
  });
});

describe('parseTimeOfDay', () => {
  it('parses clock strings', () => {
    expect(parseTimeOfDay('07:35:00')).toBe(455);
    expect(parseTimeOfDay('7:35')).toBe(455);
    expect(parseTimeOfDay('19:35')).toBe(1175);
    expect(parseTimeOfDay('7:35 PM')).toBe(1175);
    expect(parseTimeOfDay('12:05 AM')).toBe(5);
    expect(parseTimeOfDay('12:05 pm')).toBe(725);
    expect(parseTimeOfDay('0735')).toBe(455);
    expect(parseTimeOfDay('00:00:00')).toBe(0);
    expect(parseTimeOfDay('2019-03-14T07:35:00')).toBe(455);
  });
  it('distinguishes blank from unreadable', () => {
    expect(parseTimeOfDay('')).toBeUndefined();
    expect(parseTimeOfDay(null)).toBeUndefined();
    expect(parseTimeOfDay('25:00')).toBeNull();
    expect(parseTimeOfDay('7:75')).toBeNull();
    expect(parseTimeOfDay('soon')).toBeNull();
    expect(parseTimeOfDay('13:00 PM')).toBeNull();
  });
  it('reads Excel fractions and Dates', () => {
    expect(parseTimeOfDay(0.31597222)).toBe(455);
    expect(parseTimeOfDay(0)).toBe(0);
    expect(parseTimeOfDay(0.5)).toBe(720);
    expect(parseTimeOfDay('0.3159722')).toBe(455);
    expect(parseTimeOfDay(43538.315972)).toBe(455);
    expect(parseTimeOfDay(new Date(Date.UTC(1899, 11, 30, 7, 35)))).toBe(455);
    expect(parseTimeOfDay(-1)).toBeNull();
  });
  it('reads HHMM numbers and 3–4 digit strings', () => {
    expect(parseTimeOfDay(735)).toBe(455);
    expect(parseTimeOfDay(1435)).toBe(875);
    expect(parseTimeOfDay(2359)).toBe(1439);
    expect(parseTimeOfDay('735')).toBe(455);
    expect(parseTimeOfDay('1435')).toBe(875);
    expect(parseTimeOfDay(760)).toBeNull();
    expect(parseTimeOfDay(2400)).toBeNull();
    expect(parseTimeOfDay('2460')).toBeNull();
  });
});

describe('parseDurationMinutes', () => {
  it('parses clock-like and worded durations', () => {
    expect(parseDurationMinutes('02:25:00')).toBe(145);
    expect(parseDurationMinutes('2:25')).toBe(145);
    expect(parseDurationMinutes('26:10:00')).toBe(1570);
    expect(parseDurationMinutes('2h 25m')).toBe(145);
    expect(parseDurationMinutes('2h')).toBe(120);
    expect(parseDurationMinutes('2.5h')).toBe(150);
    expect(parseDurationMinutes('45 min')).toBe(45);
    expect(parseDurationMinutes('145')).toBe(145);
    expect(parseDurationMinutes('00:00:00')).toBe(0);
  });
  it('reads Excel fractions (of a day) and Dates', () => {
    expect(parseDurationMinutes(0.100694444)).toBe(145);
    expect(parseDurationMinutes(145)).toBe(145);
    expect(parseDurationMinutes(new Date(Date.UTC(1899, 11, 30, 2, 25)))).toBe(145);
    expect(parseDurationMinutes(new Date(Date.UTC(1899, 11, 31, 2, 10)))).toBe(1570);
  });
  it('reads decimal and small whole numbers as hours, not days', () => {
    expect(parseDurationMinutes(2.5)).toBe(150);
    expect(parseDurationMinutes('2.5')).toBe(150);
    expect(parseDurationMinutes(1.25)).toBe(75);
    expect(parseDurationMinutes(2)).toBe(120);
    expect(parseDurationMinutes('3')).toBe(180);
    expect(parseDurationMinutes(0.5)).toBe(720); // < 1: an Excel fraction of a day
    expect(parseDurationMinutes(95)).toBe(95);
    expect(parseDurationMinutes('145.5')).toBe(146);
  });
  it('blank vs unreadable', () => {
    expect(parseDurationMinutes('')).toBeUndefined();
    expect(parseDurationMinutes('a while')).toBeNull();
  });
});

describe('code vocabularies', () => {
  it('maps FR24 seat types', () => {
    expect(['1', '2', '3', '0', '', 1, 3].map((v) => parseSeatType(v))).toEqual(['window', 'middle', 'aisle', undefined, undefined, 'window', 'aisle']);
    expect(parseSeatType('Window')).toBe('window');
    expect(parseSeatType('aisle')).toBe('aisle');
    expect(parseSeatType('1.0')).toBe('window');
  });
  it('maps FR24 classes', () => {
    expect(['1', '2', '3', '4', '5', '0', ''].map((v) => parseCabinClass(v))).toEqual(['economy', 'business', 'first', 'premium', 'private', undefined, undefined]);
    expect(parseCabinClass('Economy')).toBe('economy');
    expect(parseCabinClass('Premium Economy')).toBe('premium');
    expect(parseCabinClass('Economy Plus')).toBe('premium');
    expect(parseCabinClass('Economy+')).toBe('premium');
    expect(parseCabinClass('Business Class')).toBe('business');
    expect(parseCabinClass('First')).toBe('first');
    expect(parseCabinClass('J')).toBe('business');
    expect(parseCabinClass('Private')).toBe('private');
  });
  it('maps FR24 reasons', () => {
    expect(['1', '2', '3', '4', '0'].map((v) => parseFlightReason(v))).toEqual(['leisure', 'business', 'crew', 'other', undefined]);
    expect(parseFlightReason('Business trip')).toBe('business');
    expect(parseFlightReason('Vacation')).toBe('leisure');
    expect(parseFlightReason('Crew')).toBe('crew');
  });
});

describe('helpers', () => {
  it('formats minutes', () => {
    expect(minutesToHHmm(455)).toBe('07:35');
    expect(minutesToHHmm(1440 + 5)).toBe('00:05');
    expect(minutesToHHmm(-10)).toBe('23:50');
  });
  it('cellText', () => {
    expect(cellText('﻿ Date ')).toBe('Date');
    expect(cellText(12)).toBe('12');
    expect(cellText(null)).toBe('');
    expect(cellText(new Date(Date.UTC(2019, 2, 14)))).toBe('2019-03-14');
  });
});
