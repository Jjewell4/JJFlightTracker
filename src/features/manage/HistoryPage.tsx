import { fieldLabel } from '@/lib/metadata';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useSearchParams } from 'react-router-dom';
import { db, undoChange } from '@/lib/db';
import { airportCode } from '@/lib/flight-utils';
import './manage.css';
export default function HistoryPage() {
  const [params] = useSearchParams();
  const [filter, setFilter] = useState(params.has('flight') ? 'flight' : 'all');
  const [limit, setLimit] = useState(50);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const changes = useLiveQuery(async () => {
    const owner = (await db.kv.get('sync.owner'))?.value;
    return db.history
      .orderBy('at')
      .reverse()
      .filter((c) => c.owner === owner)
      .toArray();
  }, []);
  const shown = changes?.filter((c) =>
    filter === 'deleted'
      ? c.before.some((f) => !c.after.some((a) => a.id === f.id))
      : filter === 'conflicts'
        ? c.conflict
        : filter === 'flight'
          ? [...c.before, ...c.after].some((f) => f.id === params.get('flight'))
          : true,
  );
  return (
    <div className="manage">
      <header className="page-header">
        <h1 className="page-title">History & recovery</h1>
        <p className="page-subtitle">Review changes, restore deleted flights, or recover a conflicting version.</p>
      </header>
      <p className="manage-hint">
        History stays on this device and is separate from cloud sync. Restoring a change updates your log and syncs normally. Export a
        backup before clearing browser storage.
      </p>
      <label className="manage-field">
        Show
        <select aria-label="Show" className="input" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All changes</option>
          <option value="deleted">Deleted flights</option>
          <option value="conflicts">Sync conflicts</option>
          {params.has('flight') && <option value="flight">This flight</option>}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {shown?.length === 0 && <p>No changes to show yet.</p>}
      {shown?.slice(0, limit).map((c) => (
        <article key={c.id} className="card manage-card">
          <h2>{c.label}</h2>
          <p>
            {new Date(c.at).toLocaleString()} · {Math.max(c.before.length, c.after.length)} flights{c.undone ? ' · Restored' : ''}
          </p>
          <details>
            <summary>Review flights and saved values</summary>
            {c.before.map((f) => (
              <div key={f.id}>
                <Link to={`/flights/${f.id}`}>
                  {f.date} · {airportCode(f.from)} → {airportCode(f.to)}
                </Link>
                <dl className="manage-diff">
                  {Object.entries(f)
                    .filter(([key]) => !['id', 'fieldSources', 'tripDetails', 'updatedAt', 'createdAt'].includes(key))
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt>{fieldLabel(k)}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ))}
                </dl>
              </div>
            ))}
            {!c.before.length && (
              <p>
                Undo removes these added flights: {c.after.map((f) => `${f.date} ${airportCode(f.from)} → ${airportCode(f.to)}`).join('; ')}
              </p>
            )}
          </details>
          {!c.undone && (
            <button
              className="btn"
              disabled={!!busy}
              onClick={async () => {
                setBusy(c.id);
                setError('');
                try {
                  await undoChange(c.id);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy('');
                }
              }}
            >
              {busy === c.id
                ? 'Restoring…'
                : c.conflict
                  ? 'Restore saved alternative'
                  : c.before.length
                    ? 'Restore previous state'
                    : 'Undo addition'}
            </button>
          )}
        </article>
      ))}
      {shown && shown.length > limit && (
        <button className="btn" onClick={() => setLimit((n) => n + 50)}>
          Show older changes
        </button>
      )}
    </div>
  );
}
