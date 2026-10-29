import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import type { ImportDraft } from '@/lib/types';
import { pullEmailDrafts } from '@/services/email/client';
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
  // Forwarded emails are fetched then too, when the app comes back to the foreground, and
  // every couple of minutes while it's open.
  useEffect(() => {
    if (sync.phase !== 'signed-in') return;
    const refresh = () => {
      void resumeDrafts();
      void pullEmailDrafts();
    };
    refresh();
    const visible = () => document.visibilityState === 'visible' && refresh();
    const timer = setInterval(() => document.visibilityState === 'visible' && void pullEmailDrafts(), 120_000);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [sync.phase]);

  useEffect(() => {
    if (!drafts) return;
    const before = previous.current;
    previous.current = new Map(drafts.map((d) => [d.id, d.status]));
    if (!before) return; // first load: nothing just finished
    const emails = drafts.filter((d) => d.source === 'email' && !before.has(d.id));
    if (emails.length) {
      const n = emails.reduce((sum, d) => sum + openLegs(d).length, 0);
      setToast({ id: emails.length === 1 ? emails[0].id : '', ok: n > 0, text: n ? `Email read · ${n === 1 ? routeSummary(openLegs(emails[0])) : `${n} flights`} ready to save` : 'Couldn’t read a forwarded email' });
    }
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
          navigate(toast.id ? `/review/${toast.id}` : '/review');
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
