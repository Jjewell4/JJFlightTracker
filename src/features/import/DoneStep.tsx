import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import type { ImportResult } from '@/services/import';

export interface DoneSummary {
  flights: number;
  airports: number;
  km: number;
  firstYear?: number;
  lastYear?: number;
  skippedDuplicates: number;
  skippedRows: number;
}

export function ProgressView({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 100;
  return (
    <div className="progress card" role="status" aria-live="polite">
      <div className="progress__plane" aria-hidden>
        <Icon name="plane" size={28} />
      </div>
      <div className="progress__title">
        Saving {total.toLocaleString()} {total === 1 ? 'flight' : 'flights'}…
      </div>
      <div className="progress__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="progress__count tabular">
        {done.toLocaleString()} of {total.toLocaleString()}
      </div>
    </div>
  );
}

export function DoneStep({ summary, result, unit, onAgain }: { summary: DoneSummary; result: ImportResult; unit: 'mi' | 'km'; onAgain: () => void }) {
  const dist = unit === 'mi' ? summary.km * 0.621371 : summary.km;
  const years = summary.firstYear && summary.lastYear ? (summary.firstYear === summary.lastYear ? String(summary.firstYear) : `${summary.firstYear}–${String(summary.lastYear).slice(2)}`) : '—';
  const notes = [
    result.updated ? `${result.updated} updated` : null,
    summary.skippedDuplicates ? `${summary.skippedDuplicates} duplicates skipped` : null,
    summary.skippedRows ? `${summary.skippedRows} left out` : null,
    result.removed ? `${result.removed} old flights replaced` : null,
    result.settingsRestored ? 'settings restored' : null,
  ].filter(Boolean);

  return (
    <div className="stack done animate-in">
      <div className="done__hero">
        <span className="done__check" aria-hidden>
          <Icon name="check" size={34} strokeWidth={2.5} />
        </span>
        <h1 className="page-title">{result.added + result.updated === 0 ? 'All up to date' : 'Import complete'}</h1>
        <p className="done__lead">
          <strong className="tabular">{summary.flights.toLocaleString()}</strong> {summary.flights === 1 ? 'flight is' : 'flights are'} in your log.
        </p>
        {notes.length > 0 && <p className="page-subtitle">{notes.join(' · ')}</p>}
      </div>

      <div className="done__stats">
        <div className="done__stat">
          <span className="done__num tabular">{summary.airports.toLocaleString()}</span>
          <span className="done__lab">airports</span>
        </div>
        <div className="done__stat">
          <span className="done__num tabular">{Math.round(dist).toLocaleString()}</span>
          <span className="done__lab">{unit === 'mi' ? 'miles' : 'kilometres'}</span>
        </div>
        <div className="done__stat">
          <span className="done__num tabular">{years}</span>
          <span className="done__lab">years</span>
        </div>
      </div>

      <div className="stack" style={{ gap: 'var(--space-3)' }}>
        <Link to="/stats" className="btn btn--primary btn--lg btn--block">
          <Icon name="chart" size={20} /> See your stats
        </Link>
        <div className="done__pair">
          <Link to="/map" className="btn btn--lg">
            <Icon name="globe" size={20} /> Open the map
          </Link>
          <Link to="/" className="btn btn--lg">
            <Icon name="list" size={20} /> All flights
          </Link>
        </div>
        <button type="button" className="btn btn--ghost btn--block" onClick={onAgain}>
          Import another file
        </button>
      </div>
      <p className="import__hint" style={{ textAlign: 'center' }}>
        Tip: save a backup from <Link to="/settings">More → Export backup</Link> now and then — your log lives only on this device.
      </p>
    </div>
  );
}
