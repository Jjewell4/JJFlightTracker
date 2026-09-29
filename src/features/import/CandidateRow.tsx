import { memo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { getAirport } from '@/data/reference';
import { airportCode, flightAirlineName } from '@/lib/flight-utils';
import { formatFlightDate, formatDuration } from '@/lib/time';
import { candidateStatus, parseAirportRef, resolveAirport, type CandidateFix, type ImportCandidate } from '@/services/import';

interface Props {
  candidate: ImportCandidate;
  duplicateOf?: string;
  updateDuplicates: boolean;
  skipped: boolean;
  onFix: (key: string, fix: CandidateFix) => void;
  onToggleSkip: (key: string) => void;
}

function dateDraft(c: ImportCandidate): string {
  const { date, datePrecision } = c.flight;
  if (!date) return '';
  return datePrecision === 'year' ? date.slice(0, 4) : datePrecision === 'month' ? date.slice(0, 7) : date;
}

function airportDraft(ident: string, raw: string | undefined): string {
  const a = getAirport(ident);
  return a ? a.iata || a.ident : ident || raw || '';
}

function AirportHint({ text }: { text: string }) {
  const r = resolveAirport(parseAirportRef(text));
  if (!text.trim()) return <span className="field__hint">Enter an IATA or ICAO code</span>;
  if (!r?.airport) return <span className="field__error">Not found — check the code</span>;
  return (
    <span className="field__hint">
      {r.airport.name}
      {r.airport.country ? ` · ${r.airport.country}` : ''}
    </span>
  );
}

export const CandidateRow = memo(function CandidateRow({ candidate: c, duplicateOf, updateDuplicates, skipped, onFix, onToggleSkip }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ date: string; from: string; to: string } | null>(null);
  const status = candidateStatus(c);
  const f = c.flight;
  const problems = c.issues.filter((i) => i.level !== 'info');
  const notes = c.issues.filter((i) => i.level === 'info');
  const isDup = !!duplicateOf;
  const hasIssue = status !== 'ok';

  const state = skipped ? 'skip' : status === 'error' ? 'error' : status === 'warning' ? 'warn' : isDup ? 'dup' : 'ok';
  const pill =
    skipped ? { cls: '', label: 'Skipped' }
    : status === 'error' ? { cls: 'badge--danger', label: 'Fix' }
    : status === 'warning' ? { cls: 'badge--amber', label: 'Check' }
    : isDup ? { cls: 'badge--amber', label: updateDuplicates ? 'Update' : 'Duplicate' }
    : { cls: 'badge--accent', label: 'New' };

  const airline = flightAirlineName(f);
  const from = f.from ? airportCode(f.from) : '???';
  const to = f.to ? airportCode(f.to) : '???';
  const dateLabel = f.date ? formatFlightDate(f.date, f.datePrecision) : (c.issues.find((i) => i.field === 'date') ? 'No date' : '—');
  const meta = [f.flightNumber ?? airline, f.aircraftType, f.durationMin ? formatDuration(f.durationMin) : undefined].filter(Boolean).join(' · ');

  const startEdit = () => setDraft({ date: dateDraft(c), from: airportDraft(f.from, c.fromRaw), to: airportDraft(f.to, c.toRaw) });
  const toggle = () => {
    if (!open && !draft) startEdit();
    setOpen((o) => !o);
  };
  const save = () => {
    if (!draft) return;
    const fix: CandidateFix = {};
    if (draft.date !== dateDraft(c)) fix.date = draft.date;
    if (draft.from !== airportDraft(f.from, c.fromRaw)) fix.from = draft.from;
    if (draft.to !== airportDraft(f.to, c.toRaw)) fix.to = draft.to;
    if (Object.keys(fix).length) onFix(c.key, fix);
    setDraft(null);
    setOpen(false);
  };

  return (
    <li className={`crow crow--${state}${open ? ' is-open' : ''}`}>
      <div className="crow__head">
        <button type="button" className="crow__main" onClick={toggle} aria-expanded={open}>
          <span className="crow__date">{dateLabel}</span>
          <span className="crow__body">
            <span className="crow__route">
              <span className="code">{from}</span>
              <Icon name="chevron" size={14} strokeWidth={2.25} />
              <span className="code">{to}</span>
            </span>
            {meta && <span className="crow__meta">{meta}</span>}
          </span>
          <span className={`badge ${pill.cls}`}>{pill.label}</span>
        </button>
        {(hasIssue || isDup) && (
          <button type="button" className="crow__skip" onClick={() => onToggleSkip(c.key)} aria-label={skipped ? 'Include this flight' : 'Skip this flight'} title={skipped ? 'Include' : 'Skip'}>
            <Icon name={skipped ? 'plus' : 'close'} size={18} />
          </button>
        )}
      </div>

      {(problems.length > 0 || isDup) && !open && (
        <ul className="crow__issues">
          {problems.map((i, n) => (
            <li key={n} className={i.level === 'error' ? 'is-error' : 'is-warn'}>
              {i.message}
            </li>
          ))}
          {isDup && !hasIssue && <li className="is-dup">{updateDuplicates ? 'Already in your log — will be updated' : 'Already in your log — will be skipped'}</li>}
        </ul>
      )}

      {open && draft && (
        <div className="crow__edit">
          {[...problems, ...notes].map((i, n) => (
            <p key={n} className={`crow__note ${i.level === 'error' ? 'is-error' : i.level === 'warn' ? 'is-warn' : ''}`}>
              {i.message}
            </p>
          ))}
          <div className="crow__fields">
            <label className="field">
              <span className="field__label">Date</span>
              <input className="input" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} placeholder="YYYY-MM-DD" inputMode="numeric" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              <span className="field__hint">Year or month only is fine (2019, 2019-03)</span>
            </label>
            <label className="field">
              <span className="field__label">From</span>
              <input className="input mono" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value.toUpperCase() })} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
              <AirportHint text={draft.from} />
            </label>
            <label className="field">
              <span className="field__label">To</span>
              <input className="input mono" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value.toUpperCase() })} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
              <AirportHint text={draft.to} />
            </label>
          </div>
          {(c.fromRaw || c.toRaw) && (hasIssue) && (
            <p className="field__hint">
              In your file: {c.fromRaw ?? '—'} → {c.toRaw ?? '—'}
            </p>
          )}
          <div className="row">
            <button type="button" className="btn btn--ghost" onClick={() => onToggleSkip(c.key)}>
              {skipped ? 'Include this flight' : 'Skip this flight'}
            </button>
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => { setDraft(null); setOpen(false); }}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={save}>
              Save
            </button>
          </div>
        </div>
      )}
    </li>
  );
});
