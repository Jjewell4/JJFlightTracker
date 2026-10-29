import { describe, expect, it } from 'vitest';
import { forwardingAddress, normalizeSender, rowToDraft } from './client';

const leg = { date: '2026-10-21', from: 'MCO', to: 'SFO', flightNumber: 'UA2620', depTime: '18:59', arrTime: '21:50', arrDayOffset: 0, aircraftType: '', seatNumber: '' };

describe('email import client', () => {
  it('builds the forwarding address and cleans sender input', () => {
    expect(forwardingAddress('ab12cd')).toBe('flights-ab12cd@windowseat.me');
    expect(normalizeSender('  Me@Work.COM ')).toBe('me@work.com');
    expect(normalizeSender('not an email')).toBeNull();
  });

  it('turns inbox rows into To review drafts, validating what the server stored', () => {
    const d = rowToDraft({ id: 'r1', received_at: '2026-10-29T10:00:00Z', subject: 'Your trip', sender: 'me@work.com', status: 'ready', result: { flights: [leg], warnings: [] }, error: null });
    expect(d).toMatchObject({ id: 'email-r1', source: 'email', status: 'ready', remoteId: 'r1', subject: 'Your trip', handled: [] });
    expect(d.result?.flights[0].from).toBe('MCO');
    const bad = rowToDraft({ id: 'r2', received_at: 'x', subject: null, sender: null, status: 'ready', result: { nonsense: true }, error: null });
    expect(bad.status).toBe('failed');
    const failed = rowToDraft({ id: 'r3', received_at: '2026-10-29T10:00:00Z', subject: 'Hi', sender: null, status: 'failed', result: null, error: 'No booked flights found.' });
    expect(failed.error?.message).toBe('No booked flights found.');
  });
});
