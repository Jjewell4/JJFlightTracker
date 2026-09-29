/**
 * Reads design tokens (CSS custom properties) at runtime so the WebGL map
 * follows the app theme, and derives the map palette from them.
 */
import { useEffect, useState } from 'react';

export type RGBA = [number, number, number, number];

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb() and rgba(). Returns null when unparseable. */
export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some((p) => !Number.isFinite(p))) return null;
    return [parts[0], parts[1], parts[2], parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1];
  }
  return null;
}

export function toCss([r, g, b, a]: RGBA): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v)));
  return a >= 1 ? `rgb(${c(r)}, ${c(g)}, ${c(b)})` : `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${Math.round(a * 1000) / 1000})`;
}

/** Linear mix: t=0 → a, t=1 → b. */
export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

export const withAlpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], a];

/** Relative luminance (0..1). */
export function luminance([r, g, b]: RGBA): number {
  const l = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
}

export type Ramp = [string, string, string, string];
/** Positions of the four ramp colors. Blue → amber goes via pink (a straight RGB blend turns olive). */
export const RAMP_STOPS = [0, 0.4, 0.75, 1] as const;

/** CSS gradient matching a ramp (for legends). */
export const rampGradient = (r: Ramp) => `linear-gradient(90deg, ${r.map((c, i) => `${c} ${RAMP_STOPS[i] * 100}%`).join(', ')})`;

export interface MapTheme {
  dark: boolean;
  /** Canvas backdrop outside the globe ("space"). */
  space: string;
  ocean: string;
  land: string;
  landVisited: string;
  coast: string;
  border: string;
  stateLine: string;
  graticule: string;
  accent: string;
  accent2: string;
  /** Arc palette for "by year" mode: oldest → newest (stops at RAMP_STOPS). */
  yearRamp: Ramp;
  /** Arc palette for frequency mode: rare → frequent (stops at RAMP_STOPS). */
  freqRamp: Ramp;
  glow: string;
  dotFill: string;
  dotStroke: string;
  label: string;
  labelHalo: string;
  highlight: string;
}

const FALLBACK: Record<string, string> = {
  '--bg': '#0a0e16',
  '--surface': '#141a28',
  '--surface-2': '#1b2334',
  '--surface-3': '#242e43',
  '--text': '#eef2fa',
  '--text-2': '#a9b4c9',
  '--accent': '#5cc8ff',
  '--accent-2': '#ffb547',
  '--chart-3': '#b18cff',
  '--chart-5': '#ff7eb6',
};

/** Builds the map palette from a token lookup (tokens → colors). */
export function deriveTheme(get: (name: string) => string): MapTheme {
  const c = (name: string): RGBA => parseColor(get(name)) ?? parseColor(FALLBACK[name] ?? '#888888')!;
  const bg = c('--bg');
  const surface = c('--surface');
  const surface3 = c('--surface-3');
  const text = c('--text');
  const text2 = c('--text-2');
  const accent = c('--accent');
  const accent2 = c('--accent-2');
  const violet = c('--chart-3');
  const pink = c('--chart-5');
  const dark = luminance(bg) < 0.3;

  if (dark) {
    const black: RGBA = [0, 0, 0, 1];
    const ocean = mix(bg, black, 0.35);
    const land = mix(bg, surface, 0.85);
    return {
      dark,
      space: toCss(mix(bg, black, 0.55)),
      ocean: toCss(ocean),
      land: toCss(land),
      landVisited: toCss(mix(land, accent, 0.09)),
      coast: toCss(withAlpha(mix(text2, accent, 0.4), 0.26)),
      border: toCss(withAlpha(text2, 0.2)),
      stateLine: toCss(withAlpha(text2, 0.09)),
      graticule: toCss(withAlpha(text2, 0.05)),
      accent: toCss(accent),
      accent2: toCss(accent2),
      yearRamp: [toCss(mix(violet, bg, 0.35)), toCss(violet), toCss(pink), toCss(accent2)],
      freqRamp: [toCss(mix(accent, bg, 0.3)), toCss(accent), toCss(mix(pink, accent2, 0.15)), toCss(accent2)],
      glow: toCss(accent),
      dotFill: toCss(text),
      dotStroke: toCss(accent),
      label: toCss(mix(text, text2, 0.25)),
      labelHalo: toCss(withAlpha(ocean, 0.85)),
      highlight: toCss(accent2),
    };
  }
  const white: RGBA = [255, 255, 255, 1];
  const ocean = mix(surface3, accent, 0.1);
  return {
    dark,
    space: toCss(mix(bg, surface3, 0.6)),
    ocean: toCss(ocean),
    land: toCss(mix(surface, bg, 0.2)),
    landVisited: toCss(mix(white, accent, 0.07)),
    coast: toCss(withAlpha(mix(text2, accent, 0.5), 0.35)),
    border: toCss(withAlpha(text2, 0.3)),
    stateLine: toCss(withAlpha(text2, 0.14)),
    graticule: toCss(withAlpha(text2, 0.08)),
    accent: toCss(accent),
    accent2: toCss(accent2),
    yearRamp: [toCss(mix(violet, white, 0.45)), toCss(violet), toCss(pink), toCss(accent2)],
    freqRamp: [toCss(mix(accent, white, 0.3)), toCss(accent), toCss(mix(pink, accent2, 0.15)), toCss(accent2)],
    glow: toCss(accent),
    dotFill: toCss(white),
    dotStroke: toCss(accent),
    label: toCss(text),
    labelHalo: toCss(withAlpha(white, 0.9)),
    highlight: toCss(accent2),
  };
}

export function readMapTheme(): MapTheme {
  if (typeof document === 'undefined') return deriveTheme((n) => FALLBACK[n] ?? '');
  const cs = getComputedStyle(document.documentElement);
  return deriveTheme((n) => cs.getPropertyValue(n));
}

/** Map theme that re-derives when <html data-theme> or the OS color scheme changes. */
export function useMapTheme(): MapTheme {
  const [theme, setTheme] = useState(readMapTheme);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      // Wait a frame so the new CSS variables have applied.
      raf = requestAnimationFrame(() =>
        setTheme((prev) => {
          const next = readMapTheme();
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        }),
      );
    };
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', update);
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      mq?.removeEventListener?.('change', update);
    };
  }, []);
  return theme;
}
