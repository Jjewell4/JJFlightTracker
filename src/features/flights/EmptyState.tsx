import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { seedSampleFlights } from '@/dev/sample-data';

/** First-run welcome: an illustrated hero with the three ways to get started. */
export function EmptyState() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trySample = async () => {
    setBusy(true);
    setError(null);
    try {
      await seedSampleFlights({ replace: false });
    } catch (e) {
      console.error(e);
      setError('Couldn’t load the sample data. Check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <section className="welcome animate-in" aria-labelledby="welcome-title">
      <div className="welcome__art" aria-hidden>
        <svg viewBox="0 0 320 170" className="welcome__svg">
          <defs>
            <linearGradient id="welcome-arc" x1="0" x2="1">
              <stop offset="0" stopColor="var(--accent)" />
              <stop offset="1" stopColor="var(--accent-2)" />
            </linearGradient>
            <radialGradient id="welcome-glow" cx="0.5" cy="0.55" r="0.5">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x="0" y="0" width="320" height="170" fill="url(#welcome-glow)" />
          {Array.from({ length: 9 }, (_, r) =>
            Array.from({ length: 21 }, (_, c) => {
              const x = 10 + c * 15;
              const y = 20 + r * 16;
              const d = Math.hypot((x - 160) / 160, (y - 100) / 90);
              return d < 1 ? <circle key={`${r}-${c}`} cx={x} cy={y} r={1.3} className="welcome__dot" style={{ opacity: 1 - d * 0.85 }} /> : null;
            }),
          )}
          <path id="welcome-path" d="M50 130 Q160 10 270 118" fill="none" stroke="url(#welcome-arc)" strokeWidth="2.5" strokeLinecap="round" className="welcome__arc" pathLength={1} />
          <circle cx="50" cy="130" r="5" className="welcome__pin" />
          <circle cx="270" cy="118" r="5" className="welcome__pin welcome__pin--to" />
          <g className="welcome__plane">
            <g transform="translate(160 67) rotate(-3) translate(-12 -12)">
              <path
                d="M10.2 21 12 19.5 13.8 21v-1.5l-1-1.2V13l8.2 3v-2L12.8 9V4.5a.8.8 0 0 0-1.6 0V9L3 14v2l8.2-3v5.3l-1 1.2z"
                transform="rotate(90 12 12)"
                fill="currentColor"
              />
            </g>
          </g>
        </svg>
      </div>
      <h1 id="welcome-title" className="welcome__title">
        Every flight you’ve taken, beautifully logged.
      </h1>
      <p className="welcome__lead">Build your personal flight history — routes, airlines, aircraft and miles — privately on this device.</p>
      <div className="welcome__actions">
        <Link to="/flights/new" className="btn btn--primary btn--lg btn--block">
          <Icon name="plus" size={20} />
          Log your first flight
        </Link>
        <Link to="/import" className="btn btn--lg btn--block">
          <Icon name="upload" size={18} />
          Import your flight history
        </Link>
        <button type="button" className="btn btn--ghost btn--block" onClick={trySample} disabled={busy}>
          <Icon name="sparkle" size={18} />
          {busy ? 'Loading sample flights…' : 'Try with sample data'}
        </button>
        {error && <p className="field__error">{error}</p>}
      </div>
      <p className="welcome__privacy">
        <Icon name="info" size={14} className="welcome__privacy-icon" />
        Your flights stay on this device. Export a backup anytime.
      </p>
    </section>
  );
}
