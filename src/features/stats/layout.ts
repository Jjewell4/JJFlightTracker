/**
 * The Stats tab's arrangement. The summary stays on top; every other section can be moved or
 * hidden by the owner, and public journals follow the same arrangement.
 */
import type { StatsLayout } from '@/lib/types';

export const STATS_SECTIONS = [
  { id: 'highlights', title: 'Highlights', nav: 'Highlights' },
  { id: 'patterns', title: 'When you fly', nav: 'Patterns' },
  { id: 'calendar', title: 'Time away', nav: 'Calendar' },
  { id: 'mix', title: 'How you fly', nav: 'Flight mix' },
  { id: 'occasions', title: 'Occasions', nav: 'Occasions' },
  { id: 'records', title: 'Records', nav: 'Records' },
  { id: 'favorites', title: 'Favorites', nav: 'Favorites' },
  { id: 'places', title: 'Places', nav: 'Places' },
  { id: 'seatmap', title: 'Seat map', nav: 'Seat map' },
  { id: 'footprint', title: 'Footprint', nav: 'Footprint' },
] as const;

export type StatsSectionId = (typeof STATS_SECTIONS)[number]['id'];
const IDS: readonly string[] = STATS_SECTIONS.map((s) => s.id);
const isId = (v: unknown): v is StatsSectionId => typeof v === 'string' && IDS.includes(v);

/** Only known ids, each once (the shape the database accepts). */
export function normalizeLayout(raw: unknown): StatsLayout {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter(isId).filter((id, i, all) => all.indexOf(id) === i) : []);
  const out: StatsLayout = {};
  const order = ids(r.order);
  const hidden = ids(r.hidden);
  if (order.length) out.order = order;
  if (hidden.length) out.hidden = hidden;
  return out;
}

/**
 * Sections in display order with their visibility. Sections added to the app after the layout was
 * saved slot in after the section they follow by default.
 */
export function resolveLayout(layout: StatsLayout | undefined): { id: StatsSectionId; hidden: boolean }[] {
  const { order = [], hidden = [] } = normalizeLayout(layout);
  const out = [...order] as StatsSectionId[];
  STATS_SECTIONS.forEach(({ id }, i) => {
    if (out.includes(id)) return;
    const before = STATS_SECTIONS.slice(0, i).map((s) => s.id).reverse().find((b) => out.includes(b));
    out.splice(before ? out.indexOf(before) + 1 : 0, 0, id);
  });
  return out.map((id) => ({ id, hidden: hidden.includes(id) }));
}

export function sectionTitle(id: StatsSectionId): string {
  return STATS_SECTIONS.find((s) => s.id === id)!.title;
}
export function sectionNav(id: StatsSectionId): string {
  return STATS_SECTIONS.find((s) => s.id === id)!.nav;
}

/** The stored form of an arrangement; empty when it is the default. */
export function toLayout(items: readonly { id: StatsSectionId; hidden: boolean }[]): StatsLayout {
  const order = items.map((i) => i.id);
  const hidden = items.filter((i) => i.hidden).map((i) => i.id);
  const isDefault = order.every((id, i) => id === STATS_SECTIONS[i].id);
  return { ...(isDefault ? {} : { order }), ...(hidden.length ? { hidden } : {}) };
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}
