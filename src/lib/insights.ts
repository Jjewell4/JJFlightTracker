/**
 * "Insights": findings about how the log differs between categories and changes over time
 * (business vs leisure trip length, airline switches, outliers, streaks…).
 *
 * Pure and deterministic. Every finder needs enough data on each side of a comparison and a
 * meaningful difference before it says anything; findings are then ranked by `score` (roughly
 * effect size × confidence, 0–1) so the strongest come first.
 */
import { airlineKey, flightAirlineName } from './flight-utils';
import { OCCASION_LABELS, tripOccasions } from './occasions';
import { resolveFlight } from './stats';
import { cityName, type Trip } from './trips';
import type { CabinClass, Flight, FlightOccasion, FlightReason } from './types';

export type FindingField = 'reason' | 'cabin' | 'exactDates';

export interface Finding {
  id: string;
  /** What kind of finding, for the icon and grouping. */
  kind: 'compare' | 'trend' | 'outlier' | 'streak';
  icon: 'briefcase' | 'palm' | 'calendar' | 'route' | 'glass' | 'globe' | 'plane' | 'map' | 'suitcase' | 'clock' | 'sparkle' | 'chart' | 'moon';
  title: string;
  detail: string;
  /** 0–1: how strong and well supported the finding is. */
  score: number;
  /** Optional small visual: a comparison (2–4 bars) or a series. */
  visual?: { type: 'bars'; items: { label: string; value: number; display: string }[] } | { type: 'series'; items: { label: string; value: number; display: string }[] };
  /** Where the evidence lives (owner only). */
  link?: { trip?: string; airline?: string; airport?: string; occasion?: FlightOccasion };
  /** Fields the finding is built from (public journals only show findings from shared fields). */
  needs: FindingField[];
}

export interface InsightInput {
  /** Flown flights in scope. */
  flights: Flight[];
  /** Trips in scope (saved, plus suggestions with 2+ legs where available). */
  trips: Trip[];
  /** Every flown flight (for "before vs since" comparisons when a single year is in scope). */
  allFlights: Flight[];
  /** 'all' or a single year. */
  scope: 'all' | number;
  unit: 'mi' | 'km';
  audience: 'owner' | 'visitor';
}

const MIN_GROUP = 5;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const one = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
const confidence = (n: number) => clamp01(Math.log10(n + 1) / 1.5);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const year = (f: { date: string }) => Number(f.date.slice(0, 4));
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** The reason most of a trip's legs carry. */
function tripReason(t: Trip): FlightReason | undefined {
  const counts = new Map<FlightReason, number>();
  for (const f of t.flights) if (f.reason) counts.set(f.reason, (counts.get(f.reason) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

const exactTrip = (t: Trip) => t.flights.every((f) => (f.datePrecision ?? 'day') === 'day');

// ---------------------------------------------------------------------------
// Comparisons between categories
// ---------------------------------------------------------------------------

function tripLengthByReason({ trips }: InsightInput): Finding[] {
  const groups: Partial<Record<'business' | 'leisure', number[]>> = {};
  for (const t of trips) {
    const r = tripReason(t);
    if ((r === 'business' || r === 'leisure') && exactTrip(t) && t.roundTrip) (groups[r] ??= []).push(t.nights);
  }
  const b = groups.business ?? [];
  const l = groups.leisure ?? [];
  if (b.length < MIN_GROUP || l.length < MIN_GROUP) return [];
  const [ab, al] = [avg(b), avg(l)];
  const ratio = Math.max(ab, al) / Math.max(0.5, Math.min(ab, al));
  if (ratio < 1.3) return [];
  const longer = al > ab ? 'Leisure' : 'Business';
  return [
    {
      id: 'trip-length-reason',
      kind: 'compare',
      icon: al > ab ? 'palm' : 'briefcase',
      title: `${longer} trips run ${one(ratio)}× longer`,
      detail: `Leisure trips average ${one(al)} nights; business trips ${one(ab)}.`,
      score: clamp01((ratio - 1) / 3) * 0.6 + confidence(Math.min(b.length, l.length)) * 0.4,
      visual: {
        type: 'bars',
        items: [
          { label: 'Leisure', value: al, display: `${one(al)} nights` },
          { label: 'Business', value: ab, display: `${one(ab)} nights` },
        ],
      },
      needs: ['reason', 'exactDates'],
    },
  ];
}

function tripLengthByOccasion({ trips }: InsightInput): Finding[] {
  const groups = new Map<FlightOccasion, number[]>();
  const all: number[] = [];
  for (const t of trips) {
    if (!exactTrip(t) || !t.roundTrip) continue;
    all.push(t.nights);
    for (const o of tripOccasions(t).occasions) groups.set(o, [...(groups.get(o) ?? []), t.nights]);
  }
  const ranked = [...groups]
    .filter(([, n]) => n.length >= 3)
    .map(([o, n]) => ({ o, n: n.length, avg: avg(n) }))
    .sort((a, b) => b.avg - a.avg);
  if (ranked.length < 2 || all.length < 8) return [];
  const overall = avg(all);
  const top = ranked[0];
  const ratio = top.avg / Math.max(0.5, overall);
  if (ratio < 1.4) return [];
  const name = OCCASION_LABELS[top.o];
  return [
    {
      id: 'trip-length-occasion',
      kind: 'compare',
      icon: 'suitcase',
      title: `${name} trips are your longest`,
      detail: `${one(top.avg)} nights on average, against ${one(overall)} for all your trips.`,
      score: clamp01((ratio - 1) / 3) * 0.6 + confidence(top.n) * 0.4,
      visual: { type: 'bars', items: ranked.slice(0, 4).map((r) => ({ label: OCCASION_LABELS[r.o], value: r.avg, display: `${one(r.avg)} nights` })) },
      link: { occasion: top.o },
      needs: ['reason', 'exactDates'],
    },
  ];
}

function departureDayByReason({ trips }: InsightInput): Finding[] {
  const days: Partial<Record<'business' | 'leisure', number[]>> = {};
  for (const t of trips) {
    const r = tripReason(t);
    if ((r === 'business' || r === 'leisure') && exactTrip(t) && t.startLogged) (days[r] ??= []).push(weekday(t.start));
  }
  const top = (xs: number[]) => {
    const c = Array.from({ length: 7 }, (_, d) => xs.filter((x) => x === d).length);
    const d = c.indexOf(Math.max(...c));
    return { day: d, share: c[d] / xs.length };
  };
  const b = days.business ?? [];
  const l = days.leisure ?? [];
  if (b.length < 6 || l.length < 6) return [];
  const tb = top(b);
  const tl = top(l);
  if (tb.day === tl.day || Math.max(tb.share, tl.share) < 0.35) return [];
  return [
    {
      id: 'departure-day-reason',
      kind: 'compare',
      icon: 'calendar',
      title: `Business trips start on ${DAYS[tb.day]}s`,
      detail: `${pct(tb.share)} of work trips leave on a ${DAYS[tb.day]}; leisure trips most often on a ${DAYS[tl.day]} (${pct(tl.share)}).`,
      score: clamp01((tb.share + tl.share - 0.3) / 0.8) * 0.6 + confidence(Math.min(b.length, l.length)) * 0.4,
      needs: ['reason', 'exactDates'],
    },
  ];
}

function seasonByOccasion({ trips }: InsightInput): Finding[] {
  const out: Finding[] = [];
  const months = new Map<FlightOccasion, number[]>();
  for (const t of trips) {
    if ((t.flights[0].datePrecision ?? 'day') === 'year') continue;
    for (const o of tripOccasions(t).occasions) months.set(o, [...(months.get(o) ?? []), Number(t.start.slice(5, 7)) - 1]);
  }
  for (const [o, ms] of months) {
    if (ms.length < 4 || o === 'other') continue;
    const c = Array.from({ length: 12 }, (_, m) => ms.filter((x) => x === m).length);
    const order = c.map((n, m) => ({ n, m })).sort((a, b) => b.n - a.n);
    const two = order[0].n + order[1].n;
    const share = two / ms.length;
    // Two months out of twelve hold most of them.
    if (share < 0.6 || order[1].n === 0) continue;
    const [m1, m2] = [order[0].m, order[1].m].sort((a, b) => a - b);
    out.push({
      id: `season-${o}`,
      kind: 'compare',
      icon: 'calendar',
      title: `${OCCASION_LABELS[o]} trips cluster in ${MONTHS[m1]} and ${MONTHS[m2]}`,
      detail: `${two} of ${plural(ms.length, OCCASION_LABELS[o].toLowerCase() + ' trip')} fell in those two months.`,
      score: clamp01((share - 0.4) / 0.6) * 0.6 + confidence(ms.length) * 0.4,
      link: { occasion: o },
      needs: ['reason'],
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 1);
}

function distanceByReason({ flights, unit }: InsightInput): Finding[] {
  const km: Partial<Record<'business' | 'leisure', number[]>> = {};
  for (const f of flights) {
    const d = resolveFlight(f).distanceKm;
    if ((f.reason === 'business' || f.reason === 'leisure') && d) (km[f.reason] ??= []).push(d);
  }
  const b = km.business ?? [];
  const l = km.leisure ?? [];
  if (b.length < 8 || l.length < 8) return [];
  const [ab, al] = [avg(b), avg(l)];
  const ratio = Math.max(ab, al) / Math.min(ab, al);
  if (ratio < 1.3) return [];
  const fmt = (k: number) => `${Math.round(unit === 'mi' ? k * 0.621371 : k).toLocaleString('en-US')} ${unit}`;
  const farther = al > ab ? 'Leisure' : 'Business';
  return [
    {
      id: 'distance-reason',
      kind: 'compare',
      icon: 'route',
      title: `${farther} flights go ${one(ratio)}× farther`,
      detail: `The average leisure flight is ${fmt(al)}; the average business flight ${fmt(ab)}.`,
      score: clamp01((ratio - 1) / 2) * 0.6 + confidence(Math.min(b.length, l.length)) * 0.4,
      visual: {
        type: 'bars',
        items: [
          { label: 'Leisure', value: al, display: fmt(al) },
          { label: 'Business', value: ab, display: fmt(ab) },
        ],
      },
      needs: ['reason'],
    },
  ];
}

const PREMIUM: CabinClass[] = ['premium', 'business', 'first', 'private'];

function cabinByReason({ flights }: InsightInput): Finding[] {
  const groups: Partial<Record<'business' | 'leisure', boolean[]>> = {};
  for (const f of flights) if ((f.reason === 'business' || f.reason === 'leisure') && f.cabinClass) (groups[f.reason] ??= []).push(PREMIUM.includes(f.cabinClass));
  const b = groups.business ?? [];
  const l = groups.leisure ?? [];
  if (b.length < 8 || l.length < 8) return [];
  const sb = b.filter(Boolean).length / b.length;
  const sl = l.filter(Boolean).length / l.length;
  if (Math.abs(sb - sl) < 0.15) return [];
  const more = sb > sl ? 'work' : 'leisure';
  return [
    {
      id: 'cabin-reason',
      kind: 'compare',
      icon: 'glass',
      title: `You fly up front more on ${more} trips`,
      detail: `Premium cabins on ${pct(sb)} of business flights and ${pct(sl)} of leisure flights.`,
      score: clamp01(Math.abs(sb - sl) / 0.5) * 0.6 + confidence(Math.min(b.length, l.length)) * 0.4,
      visual: {
        type: 'bars',
        items: [
          { label: 'Business', value: sb, display: pct(sb) },
          { label: 'Leisure', value: sl, display: pct(sl) },
        ],
      },
      needs: ['reason', 'cabin'],
    },
  ];
}

// ---------------------------------------------------------------------------
// Changes over time
// ---------------------------------------------------------------------------

/** Recent vs earlier flights: the last two calendar years in the log against everything before. */
function eras(input: InsightInput): { recent: Flight[]; before: Flight[]; since: number } | undefined {
  const flights = input.allFlights;
  if (!flights.length) return undefined;
  const last = Math.max(...flights.map(year));
  const first = Math.min(...flights.map(year));
  const since = input.scope === 'all' ? last - 1 : input.scope;
  if (since <= first) return undefined;
  const recent = input.scope === 'all' ? flights.filter((f) => year(f) >= since) : flights.filter((f) => year(f) === since);
  const before = flights.filter((f) => year(f) < since);
  return recent.length >= 8 && before.length >= 8 ? { recent, before, since } : undefined;
}

function abroadShift(input: InsightInput): Finding[] {
  const e = eras(input);
  if (!e) return [];
  const share = (fs: Flight[]) => {
    const known = fs.map((f) => resolveFlight(f).international).filter((x) => x !== undefined);
    return known.length ? known.filter(Boolean).length / known.length : 0;
  };
  const [now, then] = [share(e.recent), share(e.before)];
  if (Math.abs(now - then) < 0.15) return [];
  const label = input.scope === 'all' ? `Since ${e.since}` : `In ${e.since}`;
  return [
    {
      id: 'abroad-shift',
      kind: 'trend',
      icon: 'globe',
      title: now > then ? 'You’re flying abroad more' : 'You’re flying closer to home',
      detail: `${label}, ${pct(now)} of flights crossed a border, against ${pct(then)} before.`,
      score: clamp01(Math.abs(now - then) / 0.5) * 0.6 + confidence(Math.min(e.recent.length, e.before.length)) * 0.4,
      visual: {
        type: 'bars',
        items: [
          { label: 'Before', value: then, display: pct(then) },
          { label: input.scope === 'all' ? `Since ${e.since}` : String(e.since), value: now, display: pct(now) },
        ],
      },
      needs: [],
    },
  ];
}

function airlineShift(input: InsightInput): Finding[] {
  const e = eras(input);
  if (!e) return [];
  const top = (fs: Flight[]) => {
    const c = new Map<string, { n: number; f: Flight }>();
    for (const f of fs) {
      const k = airlineKey(f);
      if (k) c.set(k, { n: (c.get(k)?.n ?? 0) + 1, f });
    }
    const [key, v] = [...c].sort((a, b) => b[1].n - a[1].n)[0] ?? [];
    return key && v ? { key, share: v.n / fs.length, name: flightAirlineName(v.f) ?? key } : undefined;
  };
  const now = top(e.recent);
  const then = top(e.before);
  if (!now || !then || now.key === then.key || now.share < 0.4) return [];
  const label = input.scope === 'all' ? `since ${e.since}` : `in ${e.since}`;
  return [
    {
      id: 'airline-shift',
      kind: 'trend',
      icon: 'plane',
      title: `You’ve switched to ${now.name}`,
      detail: `${pct(now.share)} of flights ${label}; ${then.name} led before (${pct(then.share)}).`,
      score: clamp01(now.share) * 0.6 + confidence(e.recent.length) * 0.4,
      link: { airline: now.key },
      needs: [],
    },
  ];
}

function distanceTrend(input: InsightInput): Finding[] {
  if (input.scope !== 'all') return [];
  const byYear = new Map<number, number[]>();
  for (const f of input.allFlights) {
    const d = resolveFlight(f).distanceKm;
    if (d) byYear.set(year(f), [...(byYear.get(year(f)) ?? []), d]);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  if (years.length < 4) return [];
  const half = Math.floor(years.length / 2);
  const early = years.slice(0, half).flatMap((y) => byYear.get(y)!);
  const late = years.slice(half).flatMap((y) => byYear.get(y)!);
  if (early.length < 10 || late.length < 10) return [];
  const ratio = avg(late) / avg(early);
  const perYear = (ys: number[]) => avg(ys.map((y) => byYear.get(y)!.length));
  const fewer = perYear(years.slice(half)) < perYear(years.slice(0, half)) * 0.8;
  if (ratio > 0.77 && ratio < 1.3) return [];
  const farther = ratio >= 1.3;
  const fmt = (k: number) => `${Math.round(input.unit === 'mi' ? k * 0.621371 : k).toLocaleString('en-US')} ${input.unit}`;
  return [
    {
      id: 'distance-trend',
      kind: 'trend',
      icon: 'route',
      title: farther ? (fewer ? 'Flying less, but farther' : 'Your flights are getting longer') : 'Your flights are getting shorter',
      detail: `The average flight went from ${fmt(avg(early))} (${years[0]}–${years[half - 1]}) to ${fmt(avg(late))} (${years[half]}–${years[years.length - 1]}).`,
      score: clamp01(Math.abs(ratio - 1) / 1) * 0.6 + confidence(Math.min(early.length, late.length)) * 0.4,
      visual: { type: 'series', items: years.map((y) => ({ label: `’${String(y).slice(2)}`, value: avg(byYear.get(y)!), display: fmt(avg(byYear.get(y)!)) })) },
      needs: [],
    },
  ];
}

function newFavoritePlace(input: InsightInput): Finding[] {
  const e = eras(input);
  if (!e) return [];
  const count = (fs: Flight[]) => {
    const c = new Map<string, number>();
    for (const f of fs) c.set(f.to, (c.get(f.to) ?? 0) + 1);
    return c;
  };
  const now = count(e.recent);
  const then = count(e.before);
  const home = [...count(input.allFlights)].sort((a, b) => b[1] - a[1])[0]?.[0];
  const topNow = [...now].filter(([k]) => k !== home).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const fresh = topNow.find(([k, n]) => n >= 3 && (then.get(k) ?? 0) <= 1);
  if (!fresh) return [];
  const [ident, n] = fresh;
  const label = input.scope === 'all' ? `since ${e.since}` : `in ${e.since}`;
  const before = then.get(ident) ?? 0;
  return [
    {
      id: 'new-favorite',
      kind: 'trend',
      icon: 'map',
      title: `${cityName(ident)} is a new regular`,
      detail: `${plural(n, 'flight')} there ${label}, ${before ? 'after just one before' : 'and none before'}.`,
      score: clamp01(n / 8) * 0.6 + confidence(n) * 0.4,
      link: { airport: ident },
      needs: [],
    },
  ];
}

// ---------------------------------------------------------------------------
// Outliers and streaks
// ---------------------------------------------------------------------------

function longTrip({ trips }: InsightInput): Finding[] {
  const ts = trips.filter((t) => exactTrip(t) && t.roundTrip);
  if (ts.length < 6) return [];
  const nights = ts.map((t) => t.nights).sort((a, b) => a - b);
  const median = nights[Math.floor(nights.length / 2)];
  const top = [...ts].sort((a, b) => b.nights - a.nights)[0];
  const ratio = top.nights / Math.max(1, median);
  if (top.nights < 7 || ratio < 3) return [];
  return [
    {
      id: 'long-trip',
      kind: 'outlier',
      icon: 'suitcase',
      title: `${top.nights} nights in ${cityName(top.main)}`,
      detail: `Your longest trip by far — ${one(ratio)}× your typical ${plural(median, 'night')}.`,
      score: clamp01((ratio - 2) / 6) * 0.7 + 0.3,
      link: { trip: top.id },
      needs: ['exactDates'],
    },
  ];
}

function longestGap({ allFlights, scope }: InsightInput): Finding[] {
  if (scope !== 'all') return [];
  const dates = allFlights.filter((f) => (f.datePrecision ?? 'day') === 'day').map((f) => f.date).sort();
  if (dates.length < 10) return [];
  let best = { days: 0, from: '', to: '' };
  for (let i = 1; i < dates.length; i++) {
    const days = (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86_400_000;
    if (days > best.days) best = { days, from: dates[i - 1], to: dates[i] };
  }
  const months = Math.round(best.days / 30.4);
  if (months < 4) return [];
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return [
    {
      id: 'longest-gap',
      kind: 'outlier',
      icon: 'clock',
      title: `${plural(months, 'month')} on the ground`,
      detail: `Your longest stretch without flying: ${fmt(best.from)} to ${fmt(best.to)}.`,
      score: clamp01(months / 18) * 0.5 + 0.2,
      needs: ['exactDates'],
    },
  ];
}

function busiestMonth({ flights }: InputWithFlights): Finding[] {
  const c = new Map<string, number>();
  for (const f of flights) if ((f.datePrecision ?? 'day') !== 'year') c.set(f.date.slice(0, 7), (c.get(f.date.slice(0, 7)) ?? 0) + 1);
  if (c.size < 6) return [];
  const [ym, n] = [...c].sort((a, b) => b[1] - a[1])[0];
  const typical = avg([...c.values()]);
  const ratio = n / typical;
  if (n < 6 || ratio < 2.5) return [];
  return [
    {
      id: 'busiest-month',
      kind: 'outlier',
      icon: 'chart',
      title: `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)} was off the charts`,
      detail: `${plural(n, 'flight')} in one month — ${one(ratio)}× a typical month when you fly.`,
      score: clamp01((ratio - 2) / 4) * 0.6 + 0.2,
      needs: [],
    },
  ];
}
type InputWithFlights = Pick<InsightInput, 'flights'>;

function monthStreak({ allFlights, scope }: InsightInput): Finding[] {
  if (scope !== 'all') return [];
  const months = [...new Set(allFlights.filter((f) => (f.datePrecision ?? 'day') !== 'year').map((f) => f.date.slice(0, 7)))].sort();
  if (months.length < 6) return [];
  const idx = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
  let best = { len: 1, start: months[0], end: months[0] };
  let run = { len: 1, start: months[0] };
  for (let i = 1; i < months.length; i++) {
    run = idx(months[i]) === idx(months[i - 1]) + 1 ? { len: run.len + 1, start: run.start } : { len: 1, start: months[i] };
    if (run.len > best.len) best = { len: run.len, start: run.start, end: months[i] };
  }
  if (best.len < 6) return [];
  const fmt = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1].slice(0, 3)} ${ym.slice(0, 4)}`;
  return [
    {
      id: 'month-streak',
      kind: 'streak',
      icon: 'sparkle',
      title: `${best.len} months in a row with a flight`,
      detail: `Your longest streak: ${fmt(best.start)} to ${fmt(best.end)}.`,
      score: clamp01(best.len / 24) * 0.6 + 0.2,
      needs: [],
    },
  ];
}

const FINDERS: ((input: InsightInput) => Finding[])[] = [
  tripLengthByReason,
  tripLengthByOccasion,
  departureDayByReason,
  seasonByOccasion,
  distanceByReason,
  cabinByReason,
  abroadShift,
  airlineShift,
  distanceTrend,
  newFavoritePlace,
  longTrip,
  longestGap,
  busiestMonth,
  monthStreak,
];

/** Visitors read about the journal's owner, not themselves. */
function forVisitor(text: string): string {
  return text
    .replace(/\bYou’ve\b/g, 'They’ve')
    .replace(/\bYou’re\b/g, 'They’re')
    .replace(/\bYou\b/g, 'They')
    .replace(/\bYour\b/g, 'The')
    .replace(/\byour\b/g, 'the');
}

/** Findings for the log, strongest first. */
export function findInsights(input: InsightInput): Finding[] {
  const found = FINDERS.flatMap((find) => {
    try {
      return find(input);
    } catch {
      return [];
    }
  }).sort((a, b) => b.score - a.score);
  return input.audience === 'visitor' ? found.map((f) => ({ ...f, title: forVisitor(f.title), detail: forVisitor(f.detail) })) : found;
}
