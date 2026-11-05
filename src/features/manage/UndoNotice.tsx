import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, undoChange, type JournalChange } from '@/lib/db';
import './manage.css';
export function UndoNotice() {
  const started = useRef(Date.now());
  const latest = useLiveQuery(async () => {
    const owner = (await db.kv.get('sync.owner'))?.value;
    return db.history
      .orderBy('at')
      .reverse()
      .filter((c) => c.owner === owner)
      .first();
  }, []);
  const [shown, setShown] = useState<JournalChange>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!latest || latest.at < started.current || latest.undone) return;
    setShown(latest);
    setError('');
    const timer = setTimeout(() => setShown(undefined), 8000);
    return () => clearTimeout(timer);
  }, [latest?.id]);
  if (!shown) return null;
  return (
    <div className="manage-undo manage-actions" role="status">
      <span>{error || (shown.conflict ? 'Sync conflict saved for review' : shown.label)}</span>
      {!shown.conflict && (
        <button
          className="btn btn--ghost"
          onClick={async () => {
            try {
              await undoChange(shown.id);
              setShown(undefined);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Undo
        </button>
      )}
      <Link to="/history" onClick={() => setShown(undefined)}>
        History
      </Link>
      <button className="btn btn--ghost" aria-label="Dismiss change notice" onClick={() => setShown(undefined)}>
        ×
      </button>
    </div>
  );
}
