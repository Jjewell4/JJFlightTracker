/** Short text for drafts in lists, banners and toasts (pure; unit tested). */
import { getAirport } from '@/data/reference';
import { airportCode } from '@/lib/flight-utils';
import type { DraftLeg, ImportDraft } from '@/lib/types';

const code = (c: string) => {
  const a = c ? getAirport(c) : undefined;
  return a ? airportCode(a.ident) : c || '???';
};

/** Legs still waiting to be saved. */
export function openLegs(d: ImportDraft): DraftLeg[] {
  const handled = new Set(d.handled ?? []);
  return (d.result?.flights ?? []).filter((_, i) => !handled.has(i));
}

/** "MCO → SFO → MCO" for connected legs, else "MCO → SFO · LAX → JFK". */
export function routeSummary(legs: readonly DraftLeg[]): string {
  if (!legs.length) return '';
  const parts: string[][] = [];
  for (const l of legs) {
    const last = parts[parts.length - 1];
    if (last && last[last.length - 1] === code(l.from)) last.push(code(l.to));
    else parts.push([code(l.from), code(l.to)]);
  }
  return parts.map((p) => p.join(' → ')).join(' · ');
}

/** What the draft is: its route once read, else what's happening to it. */
export function draftHeadline(d: ImportDraft): string {
  if (d.status === 'reading') return 'Reading screenshot…';
  if (d.status === 'failed') return 'Couldn’t read screenshot';
  const legs = openLegs(d);
  return routeSummary(legs) || 'Screenshot';
}

export function draftDetail(d: ImportDraft, now = Date.now()): string {
  const when = draftTime(d.createdAt, now);
  if (d.status === 'reading') return `Started ${when}`;
  if (d.status === 'failed') return d.error?.message ?? 'Tap to try again';
  const n = openLegs(d).length;
  return `${n} ${n === 1 ? 'flight' : 'flights'} to save · ${when}`;
}

/** "just now", "12 min ago", "3:41 PM", "yesterday", "Oct 21". */
export function draftTime(t: number, now = Date.now()): string {
  const min = Math.round((now - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const d = new Date(t);
  const today = new Date(now);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now - 86_400_000);
  if (sameDay(d, yesterday)) return 'yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** One line for the "To review" banner. */
export function reviewBanner(drafts: readonly ImportDraft[]): { title: string; sub: string; href: string; state: ImportDraft['status'] } | null {
  if (!drafts.length) return null;
  const ready = drafts.filter((d) => d.status === 'ready');
  const reading = drafts.filter((d) => d.status === 'reading');
  const failed = drafts.filter((d) => d.status === 'failed');
  const legs = ready.reduce((n, d) => n + openLegs(d).length, 0);
  const href = drafts.length === 1 ? `/review/${drafts[0].id}` : '/review';
  const sub = [
    ready.length && (ready.length === 1 ? routeSummary(openLegs(ready[0])) : `${legs} flights from ${ready.length} screenshots`),
    reading.length && `Reading ${reading.length === 1 ? 'a screenshot' : `${reading.length} screenshots`}…`,
    failed.length && `${failed.length} couldn’t be read`,
  ]
    .filter(Boolean)
    .join(' · ');
  const title = ready.length ? (legs === 1 ? '1 flight to review' : `${legs} flights to review`) : reading.length ? 'Reading your screenshot' : 'Screenshot needs attention';
  return { title, sub, href, state: ready.length ? 'ready' : reading.length ? 'reading' : 'failed' };
}
