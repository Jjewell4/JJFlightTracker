/**
 * Whole-aircraft seat map data: every seat the user has sat in, placed by row and letter on a
 * top-down plan of the aircraft they fly most, plus a few insights the data actually supports
 * (where in the cabin they sit, how often a window seat looked out at the wing).
 *
 * Seats are grouped by aircraft plan (A320 · 737, A321 · 757, 787 · A350, …) so rows and the
 * wing line up with the drawing. Flights without a known aircraft go to the user's most flown
 * plan that has that letter (A–F → single-aisle, G–K → widebody). Letters that can't exist on
 * the aircraft (a "G" on an A320) are counted as unplaced rather than guessed.
 */
import {
  defaultLayoutForLetter,
  isOverWing,
  layoutForAircraft,
  layoutHasLetter,
  parseSeat,
  planForAircraft,
  planForLayout,
  seatPosition,
  variantIndex,
  variantLetters,
  type CabinLayout,
  type CabinPlan,
  type SeatPosition,
} from '@/lib/cabin-layout';
import type { Flight, SeatType } from '@/lib/types';

/** Fewest seats (row + letter) before the map is worth showing, or a plane worth a toggle. */
export const SEAT_MAP_MIN = 5;
/** Fewest window seats before quoting over-wing or side shares. */
export const WINDOW_MIN = 5;

export type Third = 'front' | 'middle' | 'back';
export const THIRDS: Third[] = ['front', 'middle', 'back'];

export interface PlaneSeat {
  row: number;
  /** Seat position, 0-based left to right. */
  index: number;
  letter: string;
  count: number;
  position: SeatPosition;
  overWing: boolean;
}

export interface PlaneStats {
  /** Seats (flights) drawn. */
  seats: number;
  thirds: Record<Third, number>;
  medianRow: number;
  windows: { total: number; overWing: number; left: number; right: number };
  /** Share of rows beside the wing: the over-wing share you'd expect sitting anywhere. */
  wingShare: number;
}

export interface PlaneMap {
  key: string;
  plan: CabinPlan;
  layout: CabinLayout;
  /** Letter per seat position (the most used letter variant on this plane). */
  letters: string[];
  /** Rows drawn: at least the plan's usual length, at most its maximum. */
  rows: number;
  /** Occupied seats within the drawn rows, front to back. */
  seats: PlaneSeat[];
  /** Flights placed on this plane (drawn + beyond). */
  flights: number;
  /** Seats behind the last drawn row. */
  beyond: number;
  /** Seats placed from the letter alone (aircraft unknown). */
  inferred: number;
  /** Aircraft types seen, most flown first. */
  types: string[];
  stats: PlaneStats;
}

export interface SeatMap {
  /** Most drawn seats first. */
  planes: PlaneMap[];
  /** Seats drawn across all planes. */
  drawn: number;
  /** Flights with a seat letter but no row number. */
  noRow: number;
  /** Flights whose seat letter doesn't fit the aircraft's usual layout. */
  unplaced: number;
  /** Flights with only a seat type (no seat letter). */
  typeOnly: Record<SeatType, number>;
  /** Insights across all planes (thirds are relative to each plane's length). */
  overall: PlaneStats;
}

interface Entry {
  row: number;
  letter: string;
  layout: CabinLayout;
  plan: CabinPlan;
  /** Variant-ranking key: the aircraft type, or the plane for unknown aircraft. */
  key: string;
  type?: string;
  inferred: boolean;
}

const planeKey = (plan: CabinPlan, layout: CabinLayout) => `${plan.id}:${layout.id}`;

export function computeSeatMap(flights: Flight[], resolveType: (code: string) => string | undefined = (c) => c): SeatMap {
  const typeOnly: Record<SeatType, number> = { window: 0, middle: 0, aisle: 0 };
  const known: Entry[] = [];
  const unknown: { row: number; letter: string }[] = [];
  let unplaced = 0;
  let noRow = 0;

  for (const f of flights) {
    const seat = parseSeat(f.seatNumber);
    if (!seat) {
      if (f.seatType) typeOnly[f.seatType]++;
      continue;
    }
    if (!seat.row) {
      noRow++;
      continue;
    }
    const type = f.aircraftType ? (resolveType(f.aircraftType) ?? f.aircraftType).toUpperCase() : undefined;
    const layout = layoutForAircraft(type);
    if (!layout) unknown.push({ row: seat.row, letter: seat.letter });
    else if (!layoutHasLetter(layout, seat.letter)) unplaced++;
    else known.push({ row: seat.row, letter: seat.letter, layout, plan: planForAircraft(type) ?? planForLayout(layout), key: type!, type, inferred: false });
  }

  // Planes the user flies most, for placing seats on unknown aircraft.
  const rank = rankBy(known.map((e) => planeKey(e.plan, e.layout)));
  const entries = [...known];
  for (const { row, letter } of unknown) {
    const narrow = letter <= 'F';
    const hit = rank
      .map((k) => known.find((e) => planeKey(e.plan, e.layout) === k)!)
      .find((e) => (e.layout.family === 'widebody') !== narrow && layoutHasLetter(e.layout, letter));
    const layout = hit?.layout ?? defaultLayoutForLetter(letter);
    const plan = hit?.plan ?? planForLayout(layout);
    entries.push({ row, letter, layout, plan, key: `?${planeKey(plan, layout)}`, inferred: true });
  }

  // Per aircraft type, try letter variants in order of how many of its seats they explain,
  // so e.g. an ATR flown as "AB | CD" isn't read as "AC | DF".
  const byKey = new Map<string, Entry[]>();
  for (const e of entries) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);

  interface Acc {
    plan: CabinPlan;
    layout: CabinLayout;
    placed: { row: number; index: number }[];
    variantUse: number[];
    inferred: number;
    types: string[];
  }
  const acc = new Map<string, Acc>();
  for (const list of byKey.values()) {
    const { layout, plan } = list[0];
    const order = layout.variants
      .map((v, i) => ({ i, fit: list.filter((e) => variantIndex(v, e.letter) >= 0).length }))
      .sort((a, b) => b.fit - a.fit || a.i - b.i)
      .map((x) => x.i);
    const k = planeKey(plan, layout);
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { plan, layout, placed: [], variantUse: new Array(layout.variants.length).fill(0), inferred: 0, types: [] }));
    for (const e of list) {
      const vi = order.find((i) => variantIndex(layout.variants[i], e.letter) >= 0)!;
      a.placed.push({ row: e.row, index: variantIndex(layout.variants[vi], e.letter) });
      a.variantUse[vi]++;
      if (e.inferred) a.inferred++;
      if (e.type) a.types.push(e.type);
    }
  }

  const planes: PlaneMap[] = [];
  for (const [key, a] of acc) {
    const { plan, layout } = a;
    const maxSeen = Math.max(...a.placed.map((p) => p.row));
    const rows = Math.min(Math.max(maxSeen, plan.rows), plan.maxRows);
    const letters = variantLetters(layout.variants[a.variantUse.indexOf(Math.max(...a.variantUse))]);
    const cells = new Map<number, PlaneSeat>();
    let beyond = 0;
    for (const { row, index } of a.placed) {
      if (row > rows) {
        beyond++;
        continue;
      }
      const id = row * 100 + index;
      const cell = cells.get(id);
      if (cell) cell.count++;
      else cells.set(id, { row, index, letter: letters[index], count: 1, position: seatPosition(layout, index), overWing: isOverWing(plan, row) });
    }
    const seats = [...cells.values()].sort((x, y) => x.row - y.row || x.index - y.index);
    planes.push({ key, plan, layout, letters, rows, seats, flights: a.placed.length, beyond, inferred: a.inferred, types: rankBy(a.types), stats: planeStats(seats, rows, plan) });
  }
  planes.sort((x, y) => y.stats.seats - x.stats.seats || y.flights - x.flights);

  return { planes, drawn: planes.reduce((s, p) => s + p.stats.seats, 0), noRow, unplaced, typeOnly, overall: mergeStats(planes.map((p) => p.stats)) };
}

/** Which third of a `rows`-long cabin a row falls in. */
export function thirdOf(row: number, rows: number): Third {
  const t = (row - 0.5) / rows;
  return t < 1 / 3 ? 'front' : t < 2 / 3 ? 'middle' : 'back';
}

/** First and last row of each third, for drawing. */
export function thirdRanges(rows: number): Record<Third, [number, number]> {
  const out = {} as Record<Third, [number, number]>;
  for (let r = 1; r <= rows; r++) {
    const t = thirdOf(r, rows);
    out[t] = out[t] ? [out[t][0], r] : [r, r];
  }
  return out;
}

function planeStats(seats: PlaneSeat[], rows: number, plan: CabinPlan): PlaneStats {
  const thirds: Record<Third, number> = { front: 0, middle: 0, back: 0 };
  const windows = { total: 0, overWing: 0, left: 0, right: 0 };
  const rowList: number[] = [];
  for (const s of seats) {
    thirds[thirdOf(s.row, rows)] += s.count;
    for (let i = 0; i < s.count; i++) rowList.push(s.row);
    if (s.position.type === 'window') {
      windows.total += s.count;
      if (s.overWing) windows.overWing += s.count;
      if (s.position.side === 'left') windows.left += s.count;
      else windows.right += s.count;
    }
  }
  const wingRows = Math.max(0, Math.min(plan.wing[1], rows) - plan.wing[0] + 1);
  return { seats: rowList.length, thirds, medianRow: median(rowList), windows, wingShare: wingRows / rows };
}

function mergeStats(list: PlaneStats[]): PlaneStats {
  const out: PlaneStats = { seats: 0, thirds: { front: 0, middle: 0, back: 0 }, medianRow: NaN, windows: { total: 0, overWing: 0, left: 0, right: 0 }, wingShare: 0 };
  for (const s of list) {
    out.seats += s.seats;
    for (const t of THIRDS) out.thirds[t] += s.thirds[t];
    for (const k of ['total', 'overWing', 'left', 'right'] as const) out.windows[k] += s.windows[k];
    // Expected over-wing share, weighted by window seats on each plane.
    out.wingShare += s.wingShare * s.windows.total;
  }
  out.wingShare = out.windows.total ? out.wingShare / out.windows.total : 0;
  return out;
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function rankBy<T>(xs: T[]): T[] {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/** The third holding at least 45% of seats, if any. */
export function dominantThird(s: PlaneStats): Third | undefined {
  if (!s.seats) return undefined;
  const best = THIRDS.reduce((a, b) => (s.thirds[b] > s.thirds[a] ? b : a));
  return s.thirds[best] / s.seats >= 0.45 ? best : undefined;
}

/**
 * One-line headline, strongest supported claim first: a clear window habit (with how often that
 * window looked out at the wing), else where in the cabin they sit on their main aircraft.
 */
export function seatHeadline(overall: PlaneStats, main: PlaneMap): string {
  const w = overall.windows;
  if (w.total >= WINDOW_MIN && w.total / overall.seats >= 0.6) {
    return `Window seat person — ${Math.round((w.overWing / w.total) * 100)}% of your window seats looked out at the wing`;
  }
  const median = `median row ${main.stats.medianRow}`;
  switch (dominantThird(main.stats)) {
    case 'front':
      return `You sit toward the front: ${median}`;
    case 'back':
      return `You sit toward the back: ${median}`;
    case 'middle':
      return `You sit mid-cabin: ${median}`;
    default:
      return `You spread out across the cabin: ${median}`;
  }
}

/** "window on the left", "aisle in the center block", … */
export function describePosition(p: SeatPosition): string {
  if (p.side === 'center') return p.type === 'middle' ? 'middle of the center block' : `${p.type} in the center block`;
  return p.type === 'middle' ? `middle seat on the ${p.side}` : `${p.type} on the ${p.side}`;
}
