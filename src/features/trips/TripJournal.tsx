import { useState } from 'react';
import { saveTripDocument, useFlights } from '@/lib/db';
import { BulkEditor } from '@/features/manage/BulkEditor';
import { makeThumbnail } from '@/services/screenshot/drafts';
import { shareTripImage } from './share-trip';
import { tripTitle, type Trip } from '@/lib/trips';
import { Sheet } from '@/components/Sheet';
import type { Settings } from '@/lib/types';
import '@/features/manage/manage.css';
export function TripJournal({ trip, settings }: { trip: Trip; settings: Settings }) {
  const flights = useFlights();
  const embedded = trip.flights
    .map((f) => f.tripDetails)
    .filter((d) => d?.id === trip.id)
    .sort((a, b) => b!.updatedAt - a!.updatedAt)[0];
  // Flight snapshots are authoritative for sync and undo; the table also retains orphaned notes locally.
  const document = embedded;
  const [editing, setEditing] = useState(false);
  const [managing, setManaging] = useState(false);
  const [note, setNote] = useState('');
  const [cover, setCover] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set(trip.flights.map((f) => f.id)));
  const [selecting, setSelecting] = useState(false);
  const share = async () => {
    try {
      const result = await shareTripImage(trip, settings.distanceUnit, document?.cover);
      if (result === 'downloaded') setError('Trip recap image saved');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError('Could not share the recap');
    }
  };
  return (
    <section className="card manage-card">
      <h2>Trip journal</h2>
      {document?.cover && <img className="manage-source" src={document.cover} alt={`Cover for ${tripTitle(trip)}`} />}
      {document?.note && <p style={{ whiteSpace: 'pre-wrap' }}>{document.note}</p>}
      <div className="manage-actions">
        {trip.saved && (
          <button
            className="btn"
            onClick={() => {
              setNote(document?.note ?? '');
              setCover(document?.cover);
              setEditing(true);
              setError('');
            }}
          >
            Edit notes & cover
          </button>
        )}
        <button className="btn" onClick={() => setSelecting(!selecting)}>
          Organize legs
        </button>
        <button className="btn" onClick={() => void share()}>
          Share trip recap
        </button>
      </div>
      {!trip.saved && <p>Save this trip to add notes and a cover.</p>}
      {selecting && (
        <>
          <p className="manage-hint">Choose legs to move, split into a new trip, tag or delete.</p>
          {trip.flights.map((f) => (
            <label className="manage-actions" key={f.id}>
              <input
                type="checkbox"
                checked={selected.has(f.id)}
                onChange={() =>
                  setSelected((prev) => {
                    const n = new Set(prev);
                    if (n.has(f.id)) n.delete(f.id);
                    else n.add(f.id);
                    return n;
                  })
                }
              />
              {f.date} · {f.from} → {f.to}
            </label>
          ))}
          <button className="btn" disabled={!selected.size} onClick={() => setManaging(true)}>
            Edit selected legs
          </button>
        </>
      )}
      {managing && (
        <BulkEditor
          ids={[...selected].filter((id) => trip.flights.some((f) => f.id === id))}
          flights={flights ?? []}
          onClose={() => {
            setManaging(false);
            setSelecting(false);
          }}
        />
      )}
      {error && <p role="status">{error}</p>}
      <Sheet open={editing} onClose={() => setEditing(false)} labelledBy="trip-journal-title" dismissible={!busy}>
        <h2 id="trip-journal-title">Remember this trip</h2>
        <p className="manage-hint">
          Notes and cover sync with your saved trip. They stay private and are never included in your public journal.
        </p>
        <label className="manage-field">
          Notes
          <textarea className="input" rows={5} maxLength={10000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="manage-field">
          Cover photo
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              setError('');
              try {
                if (file.size > 10 * 1024 * 1024) throw new Error('Choose a photo under 10 MB');
                const url = URL.createObjectURL(file);
                try {
                  const resized = await makeThumbnail(url, 800);
                  if (!resized || resized.length > 250000) throw new Error('Choose a simpler or smaller image');
                  setCover(resized);
                } finally {
                  URL.revokeObjectURL(url);
                }
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {cover && (
          <>
            <img className="manage-source" src={cover} alt="Trip cover preview" />
            <button className="btn btn--ghost" onClick={() => setCover(undefined)}>
              Remove cover
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <button
          className="btn btn--primary btn--block"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await saveTripDocument(trip.id, { note, cover });
              setEditing(false);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save journal entry
        </button>
      </Sheet>
    </section>
  );
}
