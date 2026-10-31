import { useId, useMemo, useState } from 'react';
import { OccasionPicker } from '@/features/trips/OccasionPicker';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { Switch } from '@/components/Switch';
import { getAircraftType, getAirport } from '@/data/reference';
import { airportCode } from '@/lib/flight-utils';
import { formatFlightDate, formatTime } from '@/lib/time';
import type { Flight, FlightOccasion, ImportDraft } from '@/lib/types';
import { dismissDraft, retryDraft, useWatchDraft } from '@/services/screenshot/drafts';
import { prettyFlightNumber } from '@/features/entry/form-model';
import { getEntryDefaults } from '@/features/entry/prefs';
import { SetupCheck } from '@/features/entry/SetupCheck';
import { checkLegs, defaultSelection, looksLikeTrip, saveLegs, suggestedTripName, type LegCheck } from './draft-legs';
import '@/features/entry/ScreenshotImport.css';
import './review.css';

export interface SavedLegs {
  saved: Flight[];
  tripId?: string;
  tripName?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * One draft in whatever state it's in: reading (with a note that it carries on in the
 * background), failed (why, plus retry), or ready (pick the flights and save them).
 */
export function DraftPanel({
  draft,
  flights,
  clock,
  onEdit,
  onSaved,
  onChooseAnother,
  onBackground,
  onCancel,
}: {
  draft: ImportDraft;
  flights: Flight[] | undefined;
  clock: '12h' | '24h';
  /** Open a leg in the flight form (to fix or adjust it before saving). */
  onEdit: (check: LegCheck) => void;
  onSaved: (result: SavedLegs) => void;
  onChooseAnother?: () => void;
  /** Close the sheet and let the read finish in the background. */
  onBackground?: () => void;
  onCancel?: () => void;
}) {
  useWatchDraft(draft.id);

  if (draft.status === 'reading') {
    return (
      <div className="dpanel">
        <div className="ss-preview is-busy">
          {draft.image || draft.thumb ? <img className="ss-preview__img" src={draft.image ?? draft.thumb} alt="Screenshot being read" /> : <span className="ss-preview__blank" aria-hidden="true" />}
          <span className="ss-preview__scan" aria-hidden="true" />
        </div>
        <p className="ss-status" role="status">
          <span className="spinner" aria-hidden="true" /> Reading flight details…
        </p>
        <p className="dpanel__hint">
          <Icon name="info" size={16} />
          <span>Usually takes a few seconds. You don’t have to wait: it keeps reading in the background and waits for you in To review.</span>
        </p>
        {(onBackground || onCancel) && (
          <div className={`assist__actions${onBackground && onCancel ? '' : ' assist__actions--single'}`}>
            {onCancel && (
              <button type="button" className="btn btn--lg" onClick={onCancel}>
                Cancel
              </button>
            )}
            {onBackground && (
              <button type="button" className="btn btn--primary btn--lg" onClick={onBackground}>
                Continue in background
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (draft.status === 'failed') {
    return (
      <div className="dpanel">
        {draft.thumb && (
          <div className="ss-preview is-small">
            <img className="ss-preview__img" src={draft.thumb} alt="Screenshot that couldn’t be read" />
          </div>
        )}
        <div className="ss-error" role="alert">
          <Icon name="warning" size={18} />
          <p>{draft.error?.message ?? 'Could not read the screenshot.'}</p>
        </div>
        {draft.error?.code === 'setup' && <SetupCheck />}
        {draft.error?.code === 'auth' && (
          <p className="ss-note">
            <Link to="/account">Open your account</Link> to sign in again.
          </p>
        )}
        <div className={`assist__actions${draft.image ? '' : ' assist__actions--single'}`}>
          <button type="button" className={`btn btn--lg${draft.image ? '' : ' btn--primary'}`} onClick={onChooseAnother ?? (() => void dismissDraft(draft.id))}>
            {onChooseAnother ? 'Choose another' : 'Discard'}
          </button>
          {draft.image && (
            <button type="button" className="btn btn--primary btn--lg" onClick={() => void retryDraft(draft.id)}>
              <Icon name="refresh" size={18} /> Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  return <DraftReview draft={draft} flights={flights} clock={clock} onEdit={onEdit} onSaved={onSaved} />;
}

/** The legs found in a draft, each with a checkbox; save the chosen ones (optionally as a trip). */
export function DraftReview({
  draft,
  flights,
  clock,
  onEdit,
  onSaved,
}: {
  draft: ImportDraft;
  flights: Flight[] | undefined;
  clock: '12h' | '24h';
  onEdit: (check: LegCheck) => void;
  onSaved: (result: SavedLegs) => void;
}) {
  const id = useId();
  const defaults = useMemo(getEntryDefaults, []);
  const checks = useMemo(() => checkLegs(draft.result?.flights ?? [], flights, { defaults, handled: draft.handled }), [draft.result, draft.handled, flights, defaults]);
  // Until the user picks, the selection follows the checks (duplicates are known once the log loads).
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const selected = picked ?? defaultSelection(checks);
  const chosen = checks.filter((c) => selected.has(c.index) && c.input && !c.handled);
  const inputs = chosen.map((c) => c.input!);
  const chosenKey = chosen.map((c) => c.index).join(',');
  // Recomputed only when the chosen legs change (inputs is a fresh array every render).
  const autoName = useMemo(() => suggestedTripName(inputs), [chosenKey]);
  const [tripChoice, setTripChoice] = useState<boolean | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [occasions, setOccasions] = useState<FlightOccasion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const asTrip = chosen.length >= 2 && (tripChoice ?? looksLikeTrip(inputs));
  const tripName = name ?? autoName;
  const open = checks.filter((c) => !c.handled);
  const total = checks.length;

  const toggle = (i: number) => {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setPicked(next);
  };

  const save = async () => {
    if (!chosen.length || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await saveLegs(draft.id, chosen, asTrip ? { name: tripName, occasions } : undefined);
      onSaved({ ...result, tripName: asTrip ? tripName.trim() || autoName : undefined });
    } catch (e) {
      console.error(e);
      setError('Couldn’t save these flights. Please try again.');
      setBusy(false);
    }
  };

  return (
    <section className="dreview" aria-labelledby={`${id}-title`}>
      <div>
        <h3 id={`${id}-title`} className="ss-results__title">
          {total === 0 ? 'No flights found' : total === 1 ? 'Found 1 flight' : `Found ${total} flights`}
        </h3>
        {draft.source === 'email' && draft.subject && (
          <p className="ss-note">
            <Icon name="mail" size={14} /> {draft.subject}
          </p>
        )}
        <p className="ss-note">{open.length ? 'AI can misread details. Check each flight, then save — or edit one first.' : 'Every flight from this screenshot is saved.'}</p>
      </div>
      {!!draft.result?.warnings.length && (
        <ul className="ss-warnings">
          {draft.result.warnings.map((w, i) => (
            <li key={i}>
              <Icon name="info" size={14} />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      <ul className="dlegs">
        {checks.map((c) => (
          <LegRow key={c.index} check={c} clock={clock} selected={selected.has(c.index) && !!c.input && !c.handled} onToggle={() => toggle(c.index)} onEdit={() => onEdit(c)} />
        ))}
      </ul>

      {chosen.length >= 2 && (
        <div className="dtrip">
          <div className="dtrip__row">
            <span className="dtrip__text">
              <span className="dtrip__title">Save as a trip</span>
              <span className="dtrip__sub">Keeps these flights together under one name</span>
            </span>
            <Switch checked={asTrip} onChange={setTripChoice} label="Save as a trip" />
          </div>
          {asTrip && (
            <label className="field">
              <span className="field__label">Trip name</span>
              <input
                className="input"
                value={tripName}
                onChange={(e) => setName(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                placeholder={autoName || 'Trip name'}
                maxLength={80}
                autoComplete="off"
                enterKeyHint="done"
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
              />
            </label>
          )}
          {asTrip && (
            <div className="dtrip__occasion">
              <span className="field__label">What was it for? Up to two, optional</span>
              <OccasionPicker value={occasions} onChange={setOccasions} />
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      {open.length > 0 && (
        <button type="button" className="btn btn--primary btn--lg btn--block" disabled={!chosen.length || busy} onClick={() => void save()}>
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" /> Saving…
            </>
          ) : chosen.length ? (
            <>
              <Icon name="check" size={18} /> Save {plural(chosen.length, 'flight')}
              {asTrip ? ' as a trip' : ''}
            </>
          ) : (
            'Select flights to save'
          )}
        </button>
      )}
    </section>
  );
}

function LegRow({ check: c, clock, selected, onToggle, onEdit }: { check: LegCheck; clock: '12h' | '24h'; selected: boolean; onToggle: () => void; onEdit: () => void }) {
  const f = c.leg;
  const from = getAirport(f.from);
  const to = getAirport(f.to);
  const time = (t: string) => (t ? formatTime(t, clock) : '?');
  const times = f.depTime || f.arrTime ? `${time(f.depTime)} → ${time(f.arrTime)}${f.arrDayOffset ? ` (${f.arrDayOffset > 0 ? '+' : ''}${f.arrDayOffset})` : ''}` : '';
  const extra = [f.aircraftType && (getAircraftType(f.aircraftType)?.name ?? f.aircraftType), f.seatNumber && `Seat ${f.seatNumber}`].filter(Boolean).join(' · ');
  const blocked = !c.input;
  const status = c.handled
    ? { kind: 'done', icon: 'check' as const, text: 'Saved' }
    : blocked
      ? { kind: 'warn', icon: 'warning' as const, text: c.problems.join(' · ') }
      : c.duplicate
        ? { kind: 'info', icon: 'info' as const, text: 'Already in your log' }
        : null;
  return (
    <li className={`dleg${selected ? ' is-selected' : ''}${blocked ? ' is-blocked' : ''}${c.handled ? ' is-done' : ''}`}>
      <label className="dleg__main">
        <input type="checkbox" className="dleg__check" checked={selected} disabled={blocked || c.handled} onChange={onToggle} />
        <span className="dleg__body">
          <span className="dleg__route">
            <span className={`dleg__code${from ? '' : ' is-unknown'}`}>{from ? airportCode(from.ident) : f.from || '???'}</span>
            <Icon name="plane" size={13} className="dleg__plane" />
            <span className={`dleg__code${to ? '' : ' is-unknown'}`}>{to ? airportCode(to.ident) : f.to || '???'}</span>
            {f.flightNumber && <span className="badge dleg__fn">{prettyFlightNumber(f.flightNumber)}</span>}
          </span>
          <span className="dleg__meta">
            <span className={f.date ? '' : 'dleg__missing'}>{f.date ? formatFlightDate(f.date) : 'No date'}</span>
            {times && <span className="tabular">{times}</span>}
            {extra && <span>{extra}</span>}
          </span>
          {status && (
            <span className={`dleg__status dleg__status--${status.kind}`}>
              <Icon name={status.icon} size={13} />
              {status.text}
            </span>
          )}
        </span>
      </label>
      {!c.handled && (
        <button type="button" className={`dleg__edit${blocked ? ' is-fix' : ''}`} onClick={onEdit}>
          {blocked ? 'Fix' : 'Edit'}
        </button>
      )}
    </li>
  );
}

/** After saving: what happened, with a way to see it. */
export function SavedNotice({ result, onDone, onAnother, onLeave }: { result: SavedLegs; onDone: () => void; onAnother?: () => void; /** Following a link (e.g. close the sheet first). */ onLeave?: () => void }) {
  const n = result.saved.length;
  const first = result.saved[0];
  return (
    <div className="dsaved" role="status">
      <span className="dsaved__icon" aria-hidden="true">
        <Icon name="check" size={26} strokeWidth={2.25} />
      </span>
      <p className="dsaved__title">{n === 1 ? 'Flight saved' : `${n} flights saved`}</p>
      {result.tripId && <p className="dsaved__sub">as the trip “{result.tripName}”</p>}
      <div className="dsaved__actions">
        {result.tripId ? (
          <Link to={`/trips/${result.tripId}`} className="btn btn--lg btn--primary" onClick={onLeave}>
            <Icon name="suitcase" size={18} /> View trip
          </Link>
        ) : n === 1 && first ? (
          <Link to={`/flights/${first.id}`} className="btn btn--lg btn--primary" onClick={onLeave}>
            View flight
          </Link>
        ) : (
          <Link to="/flights" className="btn btn--lg btn--primary" onClick={onLeave}>
            View log
          </Link>
        )}
        {onAnother ? (
          <button type="button" className="btn btn--lg" onClick={onAnother}>
            <Icon name="image" size={18} /> Scan another
          </button>
        ) : (
          <button type="button" className="btn btn--lg" onClick={onDone}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}
