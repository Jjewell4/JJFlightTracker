import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { formatFlightDate } from '@/lib/time';
import { candidateStatus, planImport, type CandidateFix, type DuplicatePolicy, type ImportCandidate, type ParsedBackup } from '@/services/import';
import { CandidateRow } from './CandidateRow';

type Filter = 'all' | 'attention' | 'duplicates' | 'skipped';
const PAGE = 60;

interface BackupProps {
  data: ParsedBackup;
  replace: boolean;
  onReplace: (v: boolean) => void;
  restoreSettings: boolean;
  onRestoreSettings: (v: boolean) => void;
  currentCount: number;
}

interface Props {
  candidates: ImportCandidate[];
  duplicates: Map<string, string>;
  skipped: Set<string>;
  policy: DuplicatePolicy;
  onPolicy: (p: DuplicatePolicy) => void;
  onFix: (key: string, fix: CandidateFix) => void;
  onToggleSkip: (key: string) => void;
  onSetSkipped: (keys: string[], skip: boolean) => void;
  onImport: () => void;
  notice?: string;
  error?: string;
  fileName?: string;
  formatLabel: string;
  onChangeColumns?: () => void;
  backup?: BackupProps;
}

export function ReviewStep(p: Props) {
  const { candidates, duplicates, skipped, policy } = p;

  const rows = useMemo(
    () =>
      candidates.map((c) => ({
        c,
        status: candidateStatus(c),
        dup: duplicates.get(c.key),
        skipped: skipped.has(c.key),
      })),
    [candidates, duplicates, skipped],
  );

  const plan = useMemo(() => planImport({ candidates, duplicates, skipped, policy }), [candidates, duplicates, skipped, policy]);
  const ready = plan.add.length + plan.update.length;
  const attention = rows.filter((r) => r.status !== 'ok' && !r.skipped).length;
  const dupCount = rows.filter((r) => r.dup).length;
  const skippedCount = rows.filter((r) => r.skipped).length;

  const [filter, setFilter] = useState<Filter>(() => (candidates.some((c) => candidateStatus(c) !== 'ok') ? 'attention' : 'all'));
  const [limit, setLimit] = useState(PAGE);

  const shown = rows.filter((r) => {
    if (filter === 'attention') return r.status !== 'ok' && !r.skipped;
    if (filter === 'duplicates') return !!r.dup;
    if (filter === 'skipped') return r.skipped;
    return true;
  });

  const parts = [
    attention ? `${attention} ${attention === 1 ? 'needs' : 'need'} attention` : 'nothing needs attention',
    dupCount ? (policy === 'update' && !p.backup?.replace ? `${dupCount} ${dupCount === 1 ? 'duplicate' : 'duplicates'} will be updated` : `${dupCount} ${dupCount === 1 ? 'duplicate' : 'duplicates'} skipped`) : null,
    skippedCount ? `${skippedCount} left out` : null,
  ].filter(Boolean);

  const dates = candidates.map((c) => c.flight.date).filter(Boolean).sort();
  const span = dates.length ? `${formatFlightDate(dates[0], 'day')} – ${formatFlightDate(dates[dates.length - 1], 'day')}` : '';
  const replacing = !!p.backup?.replace;

  const chip = (id: Filter, label: string, count: number, tone?: 'warn') =>
    (id === 'all' || count > 0 || filter === id) && (
      <button key={id} type="button" className={`chip${tone && count ? ` chip--${tone}` : ''}`} aria-pressed={filter === id} onClick={() => { setFilter(id); setLimit(PAGE); }}>
        {label} <span className="tabular">{count}</span>
      </button>
    );

  return (
    <div className="stack review">
      {p.notice && (
        <div className="import__notice">
          <Icon name="info" size={18} />
          <span>{p.notice}</span>
        </div>
      )}
      {p.error && (
        <div className="import__error" role="alert">
          <Icon name="warning" size={18} />
          <span>{p.error}</span>
        </div>
      )}

      <section className="review__hero card">
        <div className="review__count tabular">{ready.toLocaleString()}</div>
        <div className="review__label">{ready === 1 ? 'flight' : 'flights'} ready to import</div>
        <div className="review__sub" aria-live="polite">{parts.join(' · ')}</div>
        <div className="review__meta">
          <span className="badge badge--accent">{p.formatLabel}</span>
          {p.fileName && <span className="review__file">{p.fileName}</span>}
          {span && <span className="review__file">{span}</span>}
          {p.onChangeColumns && (
            <button type="button" className="review__link" onClick={p.onChangeColumns}>
              Change columns
            </button>
          )}
        </div>
      </section>

      {p.backup && (
        <section className="stack" style={{ gap: 'var(--space-3)' }}>
          <h2 className="section-title" style={{ margin: 0 }}>Restore mode</h2>
          <div className="seg" role="group" aria-label="Restore mode">
            <button type="button" className="seg__opt" aria-pressed={!p.backup.replace} onClick={() => p.backup!.onReplace(false)}>
              Merge with my log
            </button>
            <button type="button" className="seg__opt" aria-pressed={p.backup.replace} onClick={() => p.backup!.onReplace(true)}>
              Replace everything
            </button>
          </div>
          {p.backup.replace ? (
            <div className="import__warn">
              <Icon name="warning" size={18} />
              <span>
                This deletes your <strong>{p.backup.currentCount.toLocaleString()}</strong> current {p.backup.currentCount === 1 ? 'flight' : 'flights'} and restores the backup.
              </span>
            </div>
          ) : (
            <p className="field__hint">Flights already in your log are detected so nothing is added twice.</p>
          )}
          {p.backup.data.settings && (
            <label className="check">
              <input type="checkbox" checked={p.backup.restoreSettings} onChange={(e) => p.backup!.onRestoreSettings(e.target.checked)} />
              <span>Also restore my settings (units, theme, home country)</span>
            </label>
          )}
          {p.backup.data.rejected > 0 && <p className="field__hint">{p.backup.data.rejected} unreadable {p.backup.data.rejected === 1 ? 'entry was' : 'entries were'} ignored.</p>}
        </section>
      )}

      {dupCount > 0 && !replacing && (
        <section className="stack" style={{ gap: 'var(--space-2)' }}>
          <h2 className="section-title" style={{ margin: 0 }}>{dupCount} already in your log</h2>
          <div className="seg" role="group" aria-label="What to do with duplicates">
            <button type="button" className="seg__opt" aria-pressed={policy === 'skip'} onClick={() => p.onPolicy('skip')}>
              Skip duplicates
            </button>
            <button type="button" className="seg__opt" aria-pressed={policy === 'update'} onClick={() => p.onPolicy('update')}>
              Update existing
            </button>
          </div>
          <p className="field__hint">Same date, route and flight number. “Update” fills in details from the file and keeps anything only you entered (like seat).</p>
        </section>
      )}

      <div className="review__filters" role="group" aria-label="Filter flights">
        {chip('all', 'All', rows.length)}
        {chip('attention', 'Needs attention', attention, 'warn')}
        {chip('duplicates', 'Duplicates', dupCount)}
        {chip('skipped', 'Left out', skippedCount)}
      </div>

      {(filter === 'attention' && shown.length > 1) || (filter === 'skipped' && shown.length > 1) ? (
        <div className="row">
          <span className="spacer" />
          <button type="button" className="review__link" onClick={() => p.onSetSkipped(shown.map((r) => r.c.key), filter === 'attention')}>
            {filter === 'attention' ? `Skip all ${shown.length}` : `Include all ${shown.length}`}
          </button>
        </div>
      ) : null}

      {shown.length === 0 ? (
        <div className="empty" style={{ padding: 'var(--space-8) var(--space-4)' }}>
          <div className="empty__title">{filter === 'attention' ? 'All clear' : 'Nothing here'}</div>
          <p>{filter === 'attention' ? 'Every flight looks good.' : 'No flights match this filter.'}</p>
          <button type="button" className="btn" onClick={() => setFilter('all')}>Show all flights</button>
        </div>
      ) : (
        <ul className="crows">
          {shown.slice(0, limit).map((r) => (
            <CandidateRow key={r.c.key} candidate={r.c} duplicateOf={r.dup} updateDuplicates={policy === 'update' && !replacing} skipped={r.skipped} onFix={p.onFix} onToggleSkip={p.onToggleSkip} />
          ))}
        </ul>
      )}
      {shown.length > limit && (
        <button type="button" className="btn btn--block" onClick={() => setLimit((l) => l + 120)}>
          Show {Math.min(120, shown.length - limit)} more ({shown.length - limit} hidden)
        </button>
      )}

      <div className="import__bar">
        <button type="button" className="btn btn--primary btn--lg btn--block" disabled={ready === 0 && !replacing} onClick={p.onImport}>
          {replacing ? `Replace log with ${ready.toLocaleString()} ${ready === 1 ? 'flight' : 'flights'}` : ready === 0 ? 'Nothing to import' : `Import ${ready.toLocaleString()} ${ready === 1 ? 'flight' : 'flights'}`}
        </button>
      </div>
    </div>
  );
}
