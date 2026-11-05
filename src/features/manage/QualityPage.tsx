import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, useFlights } from '@/lib/db';
import { airportCode } from '@/lib/flight-utils';
import { useReferenceReady } from '@/data/reference';
import { qualityIssues } from './quality';
import './manage.css';
export default function QualityPage() {
  const flights = useFlights();
  const ready = useReferenceReady();
  const [showDismissed, setShowDismissed] = useState(false);
  const [error, setError] = useState('');
  const state = useLiveQuery(async () => {
    const owner = (await db.kv.get('sync.owner'))?.value ?? 'local';
    const key = `quality.dismissed:${owner}`;
    return { key, ignored: ((await db.kv.get(key))?.value ?? []) as string[] };
  }, []);
  const issues = useMemo(() => (ready ? qualityIssues(flights ?? []) : []), [flights, ready]);
  const shown = issues.filter((i) => showDismissed || !state?.ignored.includes(i.key));
  return (
    <div className="manage">
      <header className="page-header">
        <h1 className="page-title">Check for mistakes</h1>
        <p className="page-subtitle">Only likely errors. Missing seats, aircraft and other optional details are fine.</p>
      </header>
      <label className="manage-actions">
        <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} /> Show dismissed checks
      </label>
      {error && <p role="alert">{error}</p>}
      {flights && ready && !shown.length && (
        <div className="card manage-card">
          <h2>No likely mistakes found</h2>
          <p>Your journal doesn’t need to be complete to be useful.</p>
        </div>
      )}
      {shown.map((i) => (
        <article className="card manage-card" key={i.key}>
          <h2>{i.title}</h2>
          <p>{i.detail}</p>
          {i.flights.map((f) => (
            <Link className="btn" key={f.id} to={`/flights/${f.id}`}>
              {f.date} · {airportCode(f.from)} → {airportCode(f.to)} · {f.flightNumber || f.depTime || 'View flight'}
            </Link>
          ))}
          <button
            className="btn btn--ghost"
            disabled={!state}
            onClick={async () => {
              if (!state) return;
              try {
                await db.kv.put({
                  key: state.key,
                  value: state.ignored.includes(i.key) ? state.ignored.filter((k) => k !== i.key) : [...state.ignored, i.key],
                });
              } catch {
                setError('Could not save this preference. Try again.');
              }
            }}
          >
            {state?.ignored.includes(i.key) ? 'Show this check again' : 'This is correct · dismiss'}
          </button>
        </article>
      ))}
    </div>
  );
}
