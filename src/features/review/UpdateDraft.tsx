import { useSheetClose } from '@/components/useSheetClose';
import { useMemo, useState } from 'react';
import { Sheet } from '@/components/Sheet';
import { db, updateFlight } from '@/lib/db';
import type { Flight, FlightInput } from '@/lib/types';
import { markLegsHandled } from '@/services/screenshot/drafts';
import type { LegCheck } from './draft-legs';
import '@/features/manage/manage.css';
const LABELS: Partial<Record<keyof FlightInput, string>> = {
  date: 'Date',
  from: 'From',
  to: 'To',
  flightNumber: 'Flight number',
  depTime: 'Departure time',
  arrTime: 'Arrival time',
  arrDayOffset: 'Arrival day',
  aircraftType: 'Aircraft',
  seatNumber: 'Seat',
};
export function updateFields(existing: Flight, input: FlightInput) {
  return (Object.keys(LABELS) as (keyof FlightInput)[]).filter(
    (k) => input[k] !== undefined && input[k] !== '' && input[k] !== existing[k],
  );
}
export function UpdateDraft({
  check,
  draftId,
  origin,
  onClose,
}: {
  check: LegCheck;
  draftId: string;
  origin: 'email' | 'screenshot';
  onClose: () => void;
}) {
  const close = useSheetClose(onClose);
  const old = check.duplicate!;
  const input = check.input!;
  const fields = useMemo(() => updateFields(old, input), [old, input]);
  // Seats can change at the gate: never replace an existing seat by default.
  const [selected, setSelected] = useState(new Set(fields.filter((k) => k !== 'seatNumber' && old.fieldSources?.[k] !== 'manual')));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      await db.transaction('rw', db.flights, db.history, db.kv, db.trips, db.drafts, async () => {
        const current = await db.flights.get(old.id);
        if (!current || current.updatedAt !== old.updatedAt)
          throw new Error('This flight changed while you were reviewing it. Close and reopen the comparison.');
        const patch: Partial<FlightInput> = { fieldSources: {} };
        for (const key of selected) {
          (patch as Record<string, unknown>)[key] = input[key];
          patch.fieldSources![key] = origin;
        }
        if (selected.has('seatNumber')) patch.seatType = input.seatType;
        await updateFlight(old.id, patch);
      });
      await close();
      await markLegsHandled(draftId, [check.index]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={() => void close()} labelledBy="update-flight-title" dismissible={!busy}>
      <h2 id="update-flight-title">Update existing flight</h2>
      <p className="manage-hint">
        Choose each change. Your corrected values and existing seat are unselected by default. Blank imported values never erase saved
        details.
      </p>
      {!fields.length && <p>No new details to update.</p>}
      <button
        className="btn btn--ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await close();
            await markLegsHandled(draftId, [check.index]);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Keep existing flight · finish review
      </button>
      {fields.map((k) => (
        <label key={k} className="manage-field">
          <span className="manage-actions">
            <input
              type="checkbox"
              checked={selected.has(k)}
              onChange={() =>
                setSelected((prev) => {
                  const n = new Set(prev);
                  if (n.has(k)) n.delete(k);
                  else n.add(k);
                  return n;
                })
              }
            />
            <strong>{LABELS[k]}</strong>
            {old.fieldSources?.[k] === 'manual' && <span className="badge">Your correction</span>}
          </span>
          <span>
            {String(old[k] ?? 'Not recorded')} → {String(input[k])}
          </span>
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" disabled={!selected.size || busy} onClick={() => void apply()}>
        {busy ? 'Updating…' : `Update ${selected.size} details`}
      </button>
    </Sheet>
  );
}
