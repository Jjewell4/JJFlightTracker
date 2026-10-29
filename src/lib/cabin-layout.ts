/**
 * Typical economy seat layouts by aircraft type, and where a seat letter sits in them.
 *
 * Real cabins vary by airline and by cabin (premium rows are often 2-2 or 1-2-1), so this is
 * the *usual* economy row for a type, good enough to place "12A" as "left window". Seat
 * letters also vary between airlines for the same row shape (a 787 is ABC DEF GHJ at one
 * airline and ABC DEF GHK at another), so each layout lists letter variants that share the
 * same seat positions. Positions, not letters, are what get compared across flights.
 */
import type { SeatType } from './types';

export type LayoutId = '1-2' | '2-2' | '2-3' | '3-3' | '2-3-2' | '2-4-2' | '3-3-3' | '3-4-3';
export type LayoutFamily = 'regional' | 'narrowbody' | 'widebody';

export interface CabinLayout {
  id: LayoutId;
  family: LayoutFamily;
  /** Seats per block, left to right as seen facing the front, e.g. [3, 3]. */
  blocks: number[];
  /** Letter variants, each one string per block. The first is the most common. */
  variants: string[][];
}

const L = (id: LayoutId, family: LayoutFamily, variants: string[][]): CabinLayout => ({
  id,
  family,
  blocks: variants[0].map((s) => s.length),
  variants,
});

export const LAYOUTS: Record<LayoutId, CabinLayout> = {
  '1-2': L('1-2', 'regional', [['A', 'BC'], ['A', 'CD']]),
  '2-2': L('2-2', 'regional', [['AC', 'DF'], ['AB', 'CD']]),
  '2-3': L('2-3', 'narrowbody', [['AC', 'DEF'], ['AB', 'CDE']]),
  '3-3': L('3-3', 'narrowbody', [['ABC', 'DEF'], ['ABC', 'HJK']]),
  '2-3-2': L('2-3-2', 'widebody', [['AC', 'DEG', 'HK'], ['AB', 'DEF', 'HK'], ['AB', 'CDE', 'FG']]),
  '2-4-2': L('2-4-2', 'widebody', [['AC', 'DEFG', 'HK']]),
  '3-3-3': L('3-3-3', 'widebody', [['ABC', 'DEF', 'GHK'], ['ABC', 'DEF', 'GHJ'], ['ABC', 'DEF', 'HJK'], ['ABC', 'EFG', 'HJK']]),
  '3-4-3': L('3-4-3', 'widebody', [['ABC', 'DEFG', 'HJK']]),
};

/** ICAO type designator patterns → usual economy layout. First match wins. */
const TYPE_RULES: [RegExp, LayoutId][] = [
  // Widebodies
  [/^(B77|B74|A38)/, '3-4-3'], // 777s are mostly 10-abreast now; some airlines fly 3-3-3
  [/^(B78|A35)/, '3-3-3'],
  [/^(A33|A34|A30|A310)/, '2-4-2'],
  [/^B76/, '2-3-2'],
  // Single-aisle jets
  [/^(A31[89]|A32|A19N|A20N|A21N|B73|B3[789X]M|B75|B72|B70|C919|DC8)/, '3-3'],
  [/^(BCS|B712|DC9|MD8|MD9|F100|F70|F28|SU9)/, '2-3'],
  // Regional jets & turboprops
  [/^(E17|E19|E29|E75|CRJ|AT[47]|DH8|SF34|SB20|F50)/, '2-2'],
  [/^(E135|E145|E14|E120)/, '1-2'],
];

/** Usual economy layout for an ICAO type designator, or undefined if unknown. */
export function layoutForAircraft(icao: string | undefined): CabinLayout | undefined {
  const code = icao?.trim().toUpperCase();
  if (!code) return undefined;
  const hit = TYPE_RULES.find(([re]) => re.test(code));
  return hit ? LAYOUTS[hit[1]] : undefined;
}

/** Seat letter from a seat number like "12A" / "3 K"; undefined for anything else. */
export function seatLetter(seat: string | undefined): string | undefined {
  const m = /^\s*\d{1,3}\s*([A-Za-z])\s*$/.exec(seat ?? '');
  return m ? m[1].toUpperCase() : undefined;
}

/** Index (0-based, left to right) of a letter in a variant, or -1. */
export function variantIndex(variant: string[], letter: string): number {
  return variant.join('').indexOf(letter);
}

/** Letters of a layout variant, flattened left to right. */
export const variantLetters = (variant: string[]) => variant.join('').split('');

export const seatCount = (layout: CabinLayout) => layout.blocks.reduce((a, b) => a + b, 0);

export type SeatSide = 'left' | 'center' | 'right';

export interface SeatPosition {
  block: number;
  type: SeatType;
  side: SeatSide;
}

/** Where seat #index sits: block, window/middle/aisle and side of the cabin. */
export function seatPosition(layout: CabinLayout, index: number): SeatPosition {
  let block = 0;
  let i = index;
  while (block < layout.blocks.length - 1 && i >= layout.blocks[block]) i -= layout.blocks[block++];
  const n = layout.blocks[block];
  const last = layout.blocks.length - 1;
  const side: SeatSide = block === 0 ? 'left' : block === last ? 'right' : 'center';
  const window = (block === 0 && i === 0) || (block === last && i === n - 1);
  // Seats next to an aisle: the inner edge of the outer blocks, both edges of a centre block.
  const aisle = (block !== 0 && i === 0) || (block !== last && i === n - 1);
  return { block, side, type: window ? 'window' : aisle ? 'aisle' : 'middle' };
}

/** "3 | 3", "3 | 4 | 3". */
export const layoutLabel = (layout: CabinLayout) => layout.blocks.join(' | ');

export const FAMILY_LABELS: Record<LayoutFamily, string> = { regional: 'Regional', narrowbody: 'Narrowbody', widebody: 'Widebody' };

/** Fallback layout for a seat letter on an unknown aircraft: up to F reads as single-aisle. */
export function defaultLayoutForLetter(letter: string): CabinLayout {
  return letter <= 'F' ? LAYOUTS['3-3'] : LAYOUTS['3-4-3'];
}

/** Whether a letter appears in any of the layout's variants. */
export const layoutHasLetter = (layout: CabinLayout, letter: string) => layout.variants.some((v) => variantIndex(v, letter) >= 0);
