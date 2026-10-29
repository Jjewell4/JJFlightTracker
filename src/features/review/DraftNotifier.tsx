import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import type { ImportDraft } from '@/lib/types';
import { isWatched, resumeDrafts, useDrafts } from '@/services/screenshot/drafts';
import { useCloudSync } from '@/services/sync/controller';
import { openLegs, routeSummary } from './draft-summary';
import './review.css';

interface Toast {
  id: string;
  ok: boolean;
  text: string;
}

/**
 * App-wide: restarts screenshot reads that were interrupted, and when one finishes while it
 * isn't on screen, shows a toast that leads to it.
 */
export function DraftNotifier() {
  const drafts = useDrafts();
  const sync = useCloudSync();
  const navigate = useNavigate();
  const previous = useRef<Map<string, ImportDraft['status']> | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // Interrupted reads resume once signed in, and again when the connection comes back.
  useEffect(() => {
    if (sync.phase !== 'signed-in') return;
    void resumeDrafts();
    const online = () => void resumeDrafts();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [sync.phase]);

  useEffect(() => {
    if (!drafts) return;
    const before = previous.current;
    previous.current = new Map(drafts.map((d) => [d.id, d.status]));
    if (!before) return; // first load: nothing just finished
    for (const d of drafts) {
      if (before.get(d.id) !== 'reading' || d.status === 'reading' || isWatched(d.id)) continue;
      if (d.status === 'ready') {
        const n = openLegs(d).length;
        setToast({ id: d.id, ok: true, text: `Screenshot read · ${n === 1 ? routeSummary(openLegs(d)) : `${n} flights`} ready to save` });
      } else {
        setToast({ id: d.id, ok: false, text: 'Couldn’t read a screenshot' });
      }
    }
  }, [drafts]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  return (
    <div className="rtoast" role="status" aria-live="polite">
      <Icon name={toast.ok ? 'check' : 'warning'} size={18} className={`rtoast__icon${toast.ok ? '' : ' rtoast__icon--warn'}`} />
      <span className="rtoast__text">{toast.text}</span>
      <button
        type="button"
        className="rtoast__btn"
        onClick={() => {
          setToast(null);
          navigate(`/review/${toast.id}`);
        }}
      >
        {toast.ok ? 'Review' : 'View'}
      </button>
      <button type="button" className="rtoast__close" aria-label="Dismiss" onClick={() => setToast(null)}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
