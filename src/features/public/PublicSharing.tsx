import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { todayLocal } from '@/lib/time';
import { useFlights } from '@/lib/db';
import { useCloudSync, syncBeforeSharing } from '@/services/sync/controller';
import { ConfirmSheet } from '@/components/Sheet';
import {
  loadOwnProfile,
  profileError,
  publishProfile,
  unpublishProfile,
} from './api';
import {
  normalizeHandle,
  profileUrl,
  publicFlights,
  validHandle,
  type PublicProfile,
} from './profile';
import { PublicDashboard } from './PublicDashboard';
import './public.css';
export function PublicSharing() {
  const sync = useCloudSync();
  const flights = useFlights();
  const [saved, setSaved] = useState<PublicProfile | null>(null);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [exact, setExact] = useState(false);
  const [preview, setPreview] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [removeError, setRemoveError] = useState('');
  useEffect(() => {
    let live = true;
    setLoaded(false);
    setSaved(null);
    setError('');
    if (sync.userId)
      loadOwnProfile(sync.userId)
        .then((p) => {
          if (live) {
            setSaved(p);
            setSlug(p?.slug || '');
            setName(p?.display_name || '');
            setExact(p?.exact_dates || false);
            setLoaded(true);
          }
        })
        .catch((e) => {
          if (live) setError(profileError(e));
        });
    return () => {
      live = false;
    };
  }, [sync.userId, attempt]);
  const today = todayLocal();
  const previewFlights = useMemo(
    () => publicFlights(flights ?? [], exact, today),
    [flights, exact, today],
  );
  const handle = normalizeHandle(slug);
  const candidate: PublicProfile = {
    slug: handle,
    display_name: name.trim() || 'Your flight journal',
    flights: previewFlights,
    published_at: new Date().toISOString(),
  };
  async function publish() {
    if (!sync.userId || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await syncBeforeSharing(sync.userId);
      const p = await publishProfile(sync.userId, {
        slug: handle,
        display_name: name.trim(),
        exact_dates: exact,
      });
      setSaved(p);
      setNotice('Your public journal is published.');
    } catch (e) {
      setError(profileError(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!sync.userId || busy) return;
    setBusy(true);
    setRemoveError('');
    try {
      await unpublishProfile(sync.userId);
      setSaved(null);
      setConfirm(false);
      setNotice('Your journal is no longer public.');
    } catch (e) {
      setRemoveError(
        `${profileError(e)} Unpublishing was not confirmed. Treat your journal as public and try again.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="sgroup">
      <h2 className="section-title sgroup__title">Public journal</h2>
      <div className="card public-sharing">
        <p>
          Share a live, read-only dashboard and flight history at your own URL.
        </p>
        {sync.phase !== 'signed-in' ? (
          <p className="field__hint">
            {sync.phase === 'disabled' ? (
              'Cloud sync must be configured before you can publish a journal.'
            ) : (
              <>
                <Link to="/account">Sign in</Link> to claim a URL and publish.
              </>
            )}
          </p>
        ) : (
          <>
            {saved && (
              <div>
                <span className="badge badge--accent">Published</span>
                <p>
                  <a
                    href={profileUrl(saved.slug)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {profileUrl(saved.slug)}
                  </a>
                </p>
                <p className="field__hint">
                  Sharing enabled{' '}
                  {new Date(saved.published_at).toLocaleString()}. Your journal
                  updates automatically as your flights sync.
                </p>
                <button
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={() => {
                    if (!navigator.clipboard) {
                      setNotice('Copy the public URL shown above.');
                      return;
                    }
                    void navigator.clipboard
                      .writeText(profileUrl(saved.slug))
                      .then(() => setNotice('Public URL copied.'))
                      .catch(() =>
                        setNotice('Copy the public URL shown above.'),
                      );
                  }}
                >
                  Copy public URL
                </button>
              </div>
            )}
            {!loaded && !error && (
              <p role="status">Loading sharing settings…</p>
            )}
            {loaded && (
              <>
                <label className="field">
                  <span className="field__label">Your URL handle</span>
                  <input
                    className="input"
                    value={slug}
                    maxLength={30}
                    onChange={(e) => {
                      setSlug(e.target.value);
                      setPreview(false);
                    }}
                    placeholder="jordan"
                    autoCapitalize="off"
                    spellCheck={false}
                    disabled={busy}
                  />
                  <span className="field__hint">
                    {window.location.origin}/{handle || 'your-name'} · 3–30
                    lowercase letters, numbers or hyphens; start with a letter.
                  </span>
                </label>
                <label className="field">
                  <span className="field__label">Display name</span>
                  <input
                    className="input"
                    value={name}
                    maxLength={60}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jordan’s flight journal"
                    disabled={busy}
                  />
                </label>
                <label className="public-sharing__privacy">
                  <input
                    type="checkbox"
                    checked={exact}
                    onChange={(e) => {
                      setExact(e.target.checked);
                      setPreview(false);
                    }}
                    disabled={busy}
                  />{' '}
                  Include exact flight dates
                </label>
                <p className="field__hint">
                  Your live journal includes {previewFlights.length} past
                  flights now and automatically includes new past flights after
                  syncing: routes, {exact ? 'flight dates' : 'months and years'}
                  , airlines and aircraft types. Notes, seats, flight numbers,
                  tail numbers, times and account information are excluded.
                  Today’s and future flights stay private. Anyone with the URL
                  can view or copy the published information.
                </p>
                {saved && saved.slug !== handle && (
                  <p className="field__hint">
                    Publishing a new handle will retire your previous URL.
                  </p>
                )}
                <div className="public-sharing__actions">
                  <button
                    className="btn"
                    disabled={busy || flights === undefined}
                    onClick={() => setPreview((p) => !p)}
                  >
                    {preview ? 'Hide preview' : 'Preview public journal'}
                  </button>
                  <button
                    className="btn btn--primary"
                    disabled={
                      busy ||
                      !preview ||
                      !validHandle(handle) ||
                      !name.trim() ||
                      flights === undefined
                    }
                    onClick={() => void publish()}
                  >
                    {busy
                      ? 'Saving…'
                      : saved
                        ? 'Save sharing settings'
                        : 'Publish journal'}
                  </button>
                  {saved && (
                    <button
                      className="btn btn--ghost"
                      disabled={busy}
                      onClick={() => {
                        setRemoveError('');
                        setConfirm(true);
                      }}
                    >
                      Unpublish
                    </button>
                  )}
                </div>
                {!validHandle(handle) && slug && (
                  <p className="field__error">
                    Choose a valid handle: 3–30 characters, starting with a
                    letter and ending with a letter or number. App route names
                    are reserved.
                  </p>
                )}
                {preview && (
                  <div className="public-preview">
                    <PublicDashboard profile={candidate} preview />
                  </div>
                )}
              </>
            )}
          </>
        )}
        {error && (
          <div>
            <p role="alert" className="field__error">
              {error}
            </p>
            {!loaded && (
              <button className="btn" onClick={() => setAttempt((n) => n + 1)}>
                Retry sharing settings
              </button>
            )}
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
      <ConfirmSheet
        open={confirm}
        title="Unpublish your journal?"
        confirmLabel="Unpublish"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(false)}
      >
        <p>
          Your public URL will stop showing this journal. Your private flights
          stay unchanged. Copies others already saved cannot be recalled.
        </p>
        {removeError && (
          <p role="alert" className="field__error">
            {removeError}
          </p>
        )}
      </ConfirmSheet>
    </section>
  );
}
