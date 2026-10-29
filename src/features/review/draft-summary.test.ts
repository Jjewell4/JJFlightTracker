import { beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import type { DraftLeg, ImportDraft } from '@/lib/types';
import { draftHeadline, draftTime, reviewBanner, routeSummary } from './draft-summary';

beforeAll(installReference);

const leg = (from: string, to: string): DraftLeg => ({ date: '2026-10-21', from, to, flightNumber: '', depTime: '', arrTime: '', arrDayOffset: null, aircraftType: '', seatNumber: '' });
const draft = (p: Partial<ImportDraft>): ImportDraft => ({ id: 'd', source: 'screenshot', status: 'ready', createdAt: 0, updatedAt: 0, ...p });

describe('draft summaries', () => {
  it('chains connected legs and separates the rest', () => {
    expect(routeSummary([leg('MCO', 'SFO'), leg('SFO', 'MCO')])).toBe('MCO → SFO → MCO');
    expect(routeSummary([leg('MCO', 'SFO'), leg('LAX', 'JFK')])).toBe('MCO → SFO · LAX → JFK');
    expect(routeSummary([leg('KSAN', 'ZZZ')])).toBe('SAN → ZZZ');
  });

  it('describes drafts by state, leaving out saved legs', () => {
    expect(draftHeadline(draft({ status: 'reading' }))).toBe('Reading screenshot…');
    expect(draftHeadline(draft({ status: 'failed' }))).toBe('Couldn’t read screenshot');
    expect(draftHeadline(draft({ result: { flights: [leg('MCO', 'SFO'), leg('SFO', 'MCO')], warnings: [] }, handled: [0] }))).toBe('SFO → MCO');
  });

  it('formats when a draft was made', () => {
    const now = new Date(2026, 9, 29, 15, 0).getTime();
    expect(draftTime(now - 20_000, now)).toBe('just now');
    expect(draftTime(now - 12 * 60_000, now)).toBe('12 min ago');
    expect(draftTime(new Date(2026, 9, 28, 9, 0).getTime(), now)).toBe('yesterday');
    expect(draftTime(new Date(2026, 9, 20, 9, 0).getTime(), now)).toBe('Oct 20');
  });

  it('sums up the banner and links straight to a single draft', () => {
    expect(reviewBanner([])).toBeNull();
    const one = reviewBanner([draft({ id: 'a', result: { flights: [leg('MCO', 'SFO'), leg('SFO', 'MCO')], warnings: [] } })])!;
    expect(one).toMatchObject({ title: '2 flights to review', sub: 'MCO → SFO → MCO', href: '/review/a', state: 'ready' });
    const many = reviewBanner([draft({ id: 'a', status: 'reading' }), draft({ id: 'b', status: 'failed' })])!;
    expect(many).toMatchObject({ title: 'Reading your screenshot', href: '/review', state: 'reading' });
    expect(many.sub).toBe('Reading a screenshot… · 1 couldn’t be read');
  });
});
