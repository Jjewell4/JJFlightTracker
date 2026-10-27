import { useEffect, useState } from 'react';
import { loadPublicProfile } from './api';
import type { PublicProfile } from './profile';
import { PublicDashboard } from './PublicDashboard';
export default function PublicProfilePage({ slug }: { slug: string }) {
  const [profile, setProfile] = useState<PublicProfile | null>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setProfile(undefined);
    setError(false);
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const next = await loadPublicProfile(slug);
        if (live) {
          setProfile(next);
          setError(false);
        }
      } catch {
        if (live) setError(true);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    const foreground = () => void refresh();
    window.addEventListener('online', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('online', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [slug, attempt]);
  useEffect(() => {
    const old = document.title;
    document.title = profile
      ? `${profile.display_name} · FlightJournal`
      : 'Shared flight journal';
    return () => {
      document.title = old;
    };
  }, [profile]);
  return (
    <main className="public-page">
      <a className="public-brand" href="/">
        <img src="/favicon.svg" width="28" height="28" alt="" /> FlightJournal
      </a>
      {error && profile && (
        <p role="status">
          Connection interrupted. Showing the last loaded flights; updates will
          resume automatically.
        </p>
      )}
      {error && !profile ? (
        <section className="public-empty">
          <h1>Couldn’t load this journal</h1>
          <p>Check your connection and try again.</p>
          <button className="btn" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </section>
      ) : profile === undefined ? (
        <p role="status">Loading flight journal…</p>
      ) : profile === null ? (
        <section className="public-empty">
          <h1>This journal isn’t public</h1>
          <p>The URL may have changed, or the owner has stopped sharing.</p>
        </section>
      ) : (
        <PublicDashboard profile={profile} />
      )}
    </main>
  );
}
