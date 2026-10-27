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
    loadPublicProfile(slug)
      .then((p) => {
        if (live) setProfile(p);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [slug, attempt]);
  useEffect(() => {
    const old = document.title;
    document.title = profile
      ? `${profile.display_name} · FlightDiary`
      : 'Shared flight journal';
    return () => {
      document.title = old;
    };
  }, [profile]);
  return (
    <main className="public-page">
      <a className="public-brand" href="/">
        <img src="/favicon.svg" width="28" height="28" alt="" /> FlightDiary
      </a>
      {error ? (
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
