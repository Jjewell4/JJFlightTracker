/**
 * Seat heatmap data: which seat in the row the user picks, per cabin layout.
 *
 * Each flight with a seat number ("12A") is placed in its aircraft's usual economy row.
 * Flights without a known aircraft get a layout from the seat letter (A–F → the user's most
 * flown single-aisle layout, G–K → their most flown widebody). Letters that can't exist on
 * the aircraft (a "G" on an A320) are counted as unplaced rather than guessed.
 */
import {
  defaultLayoutForLetter,
  layoutForAircraft,
  layoutHasLetter,
  seatCount,
  seatLetter,
  seatPosition,
  variantIndex,
  variantLetters,
  type CabinLayout,
  type LayoutId,
  type SeatPosition,
  type SeatSide,
} from '@/lib/cabin-layout';
import type { Flight, SeatType } from '@/lib/types';

/** Fewest placed seats before the heatmap is worth showing. */
export const SEAT_MAP_MIN = 5;

export interface SeatMapGroup {
  layout: CabinLayout;
  /** Letter shown for each seat position (the most used letter variant in this group). */
  letters: string[];
  /** Flights per seat position, left to right. */
  counts: number[];
  flights: number;
  /** Flights placed here from the seat letter alone (aircraft unknown). */
  inferred: number;
}

export interface SeatPick {
  group: SeatMapGroup;
  index: number;
  letter: string;
  count: number;
  position: SeatPosition;
}

export interface SeatMap {
  /** Most flown layout first. */
  groups: SeatMapGroup[];
  /** Flights placed in a row. */
  placed: number;
  /** Flights whose seat letter doesn't fit the aircraft's usual layout. */
  unplaced: number;
  /** Flights with only a seat type (no seat letter). */
  typeOnly: Record<SeatType, number>;
  sides: Record<SeatSide, number>;
  top?: SeatPick;
}

interface Entry {
  letter: string;
  layout: CabinLayout;
  /** Variant-ranking key: the aircraft type, or the inferred layout for unknown aircraft. */
  key: string;
  inferred: boolean;
}

export function computeSeatMap(flights: Flight[], resolveType: (code: string) => string | undefined = (c) => c): SeatMap {
  const typeOnly: Record<SeatType, number> = { window: 0, middle: 0, aisle: 0 };
  const known: Entry[] = [];
  const unknown: string[] = [];
  let unplaced = 0;

  for (const f of flights) {
    const letter = seatLetter(f.seatNumber);
    if (!letter) {
      if (f.seatType) typeOnly[f.seatType]++;
      continue;
    }
    const type = f.aircraftType ? (resolveType(f.aircraftType) ?? f.aircraftType).toUpperCase() : undefined;
    const layout = layoutForAircraft(type);
    if (!layout) unknown.push(letter);
    else if (!layoutHasLetter(layout, letter)) unplaced++;
    else known.push({ letter, layout, key: type!, inferred: false });
  }

  // Layouts the user flies most, for placing seats on unknown aircraft.
  const layoutRank = rankBy(known.map((e) => e.layout.id));
  const entries = [...known];
  for (const letter of unknown) {
    const narrow = letter <= 'F';
    const id = layoutRank.find((lid) => {
      const l = known.find((e) => e.layout.id === lid)!.layout;
      return (l.family === 'widebody') !== narrow && layoutHasLetter(l, letter);
    });
    const layout = id ? known.find((e) => e.layout.id === id)!.layout : defaultLayoutForLetter(letter);
    entries.push({ letter, layout, key: `?${layout.id}`, inferred: true });
  }

  // Per aircraft type, try letter variants in order of how many of its seats they explain,
  // so e.g. an ATR flown as "AB | CD" isn't read as "AC | DF".
  const byKey = new Map<string, Entry[]>();
  for (const e of entries) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);

  const groups = new Map<LayoutId, SeatMapGroup & { variantUse: number[] }>();
  for (const list of byKey.values()) {
    const layout = list[0].layout;
    const order = layout.variants
      .map((v, i) => ({ i, fit: list.filter((e) => variantIndex(v, e.letter) >= 0).length }))
      .sort((a, b) => b.fit - a.fit || a.i - b.i)
      .map((x) => x.i);
    let g = groups.get(layout.id);
    if (!g) {
      g = { layout, letters: [], counts: new Array(seatCount(layout)).fill(0), flights: 0, inferred: 0, variantUse: new Array(layout.variants.length).fill(0) };
      groups.set(layout.id, g);
    }
    for (const e of list) {
      const vi = order.find((i) => variantIndex(layout.variants[i], e.letter) >= 0)!;
      g.counts[variantIndex(layout.variants[vi], e.letter)]++;
      g.variantUse[vi]++;
      g.flights++;
      if (e.inferred) g.inferred++;
    }
  }

  const sides: Record<SeatSide, number> = { left: 0, center: 0, right: 0 };
  const out: SeatMapGroup[] = [];
  for (const { variantUse, ...g } of groups.values()) {
    const dominant = variantUse.indexOf(Math.max(...variantUse));
    g.letters = variantLetters(g.layout.variants[dominant]);
    g.counts.forEach((c, i) => (sides[seatPosition(g.layout, i).side] += c));
    out.push(g);
  }
  out.sort((a, b) => b.flights - a.flights);

  let top: SeatPick | undefined;
  for (const group of out) {
    group.counts.forEach((count, index) => {
      if (count > (top?.count ?? 0)) top = { group, index, count, letter: group.letters[index], position: seatPosition(group.layout, index) };
    });
  }

  return { groups: out, placed: entries.length, unplaced, typeOnly, sides, top };
}

function rankBy<T>(xs: T[]): T[] {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/** "window on the left", "aisle in the center block", … */
export function describePosition(p: SeatPosition): string {
  if (p.side === 'center') return p.type === 'middle' ? 'middle of the center block' : `${p.type} in the center block`;
  return p.type === 'middle' ? `middle seat on the ${p.side}` : `${p.type} on the ${p.side}`;
}
