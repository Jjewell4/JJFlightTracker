import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { getAircraftType, getAirport } from '@/data/reference';
import { airportCode } from '@/lib/flight-utils';
import { formatFlightDate, formatTime } from '@/lib/time';
import { inferAirline } from '@/services/lookup';
import {
  checkScreenshotSetup,
  prepareScreenshot,
  readScreenshot,
  ScreenshotError,
  type ScreenshotErrorCode,
  type ScreenshotSetupStatus,
} from '@/services/screenshot/client';
import type { ScreenshotFlight, ScreenshotResult } from '@/services/screenshot/schema';
import { useCloudSync } from '@/services/sync/controller';
import { prettyFlightNumber, type FormValues } from './form-model';
import './ScreenshotImport.css';

export function screenshotValues(f: ScreenshotFlight): Partial<FormValues> {
  return {
    date: f.date,
    datePrecision: 'day',
    from: getAirport(f.from)?.ident ?? '',
    to: getAirport(f.to)?.ident ?? '',
    flightNumber: f.flightNumber,
    airline: inferAirline(f.flightNumber),
    depTime: f.depTime,
    arrTime: f.arrTime,
    arrDayOffset: f.arrDayOffset ?? undefined,
    aircraftType: getAircraftType(f.aircraftType)?.icao ?? '',
    aircraftName: '',
    seatNumber: f.seatNumber,
  };
}

type Phase = 'idle' | 'preparing' | 'reading' | 'ready' | 'error' | 'done';

const TIMEOUT_MS = 60_000;

/**
 * "Scan screenshot" bottom sheet: pick a booking / boarding-pass / flight-status image; it is
 * prepared and read straight away (the privacy note is shown before choosing), then one of the
 * extracted flights fills the form. State lives here, so reopening the sheet shows the last result.
 */
export function ScreenshotImport({
  open,
  onClose,
  onApply,
  dirty,
  clock,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (values: Partial<FormValues>) => void;
  dirty: boolean;
  clock: '12h' | '24h';
}) {
  const sync = useCloudSync();
  const titleId = useId();
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<{ code: ScreenshotErrorCode; message: string } | null>(null);
  const [result, setResult] = useState<ScreenshotResult | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const request = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const chooseRef = useRef<HTMLButtonElement | null>(null);
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current++;
      request.current?.abort();
    },
    [],
  );

  const busy = phase === 'preparing' || phase === 'reading';

  const stop = () => {
    generation.current++;
    request.current?.abort();
    request.current = null;
  };

  const cancel = () => {
    stop();
    setPhase(preview ? 'ready' : 'idle');
  };

  // Back / scrim / ✕ while reading cancels the read.
  const close = () => {
    if (busy) cancel();
    onClose();
  };

  const reset = () => {
    stop();
    setPreview('');
    setResult(null);
    setSelected(null);
    setError(null);
    setPhase('idle');
  };

  const extract = async (image: string) => {
    if (!image) return;
    request.current?.abort();
    const current = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    setPhase('reading');
    setError(null);
    setResult(null);
    setSelected(null);
    const timeout = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
    try {
      const found = await readScreenshot(image, controller.signal);
      if (generation.current !== current) return;
      setResult(found);
      setPhase('done');
    } catch (e) {
      if (generation.current !== current) return;
      if (controller.signal.aborted && controller.signal.reason !== 'timeout') return;
      setError(
        controller.signal.reason === 'timeout'
          ? { code: 'network', message: 'Reading took too long. Try again, or crop the image to the flight details.' }
          : {
              code: e instanceof ScreenshotError ? e.code : 'unknown',
              message: e instanceof Error && e.message ? e.message : 'Could not read the screenshot.',
            },
      );
      setPhase('error');
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) request.current = null;
    }
  };

  const choose = async (file?: File) => {
    if (!file) return;
    stop();
    const current = generation.current;
    setPhase('preparing');
    setError(null);
    setPreview('');
    setResult(null);
    setSelected(null);
    try {
      const image = await prepareScreenshot(file);
      if (generation.current !== current) return;
      setPreview(image);
      // The privacy note was shown before choosing, so read it right away to save a tap.
      void extract(image);
    } catch (e) {
      if (generation.current !== current) return;
      setError({ code: e instanceof ScreenshotError ? e.code : 'image', message: e instanceof Error && e.message ? e.message : 'Could not open this image.' });
      setPhase('error');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const pick = () => fileInput.current?.click();
  const pickAnother = () => {
    reset();
    pick();
  };

  const signedIn = sync.phase === 'signed-in';
  const count = result?.flights.length ?? 0;

  return (
    <Sheet
      open={open}
      onClose={close}
      labelledBy={titleId}
      initialFocus={signedIn && phase === 'idle' ? chooseRef : undefined}
      className="entry-sheet assist-sheet"
    >
      <div className="assist">
        <div className="assist__head">
          <span className="assist__badge" aria-hidden="true">
            <Icon name="scan" size={20} />
          </span>
          <div className="assist__titles">
            <h2 id={titleId} className="assist__title">
              Scan a screenshot
            </h2>
            <p className="assist__sub">Booking, boarding pass or status page</p>
          </div>
          <button type="button" className="assist__close" onClick={close} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>

        {!signedIn ? (
          sync.phase === 'loading' ? (
            <p className="ss-status" role="status">
              <span className="spinner" aria-hidden="true" /> Checking your account…
            </p>
          ) : (
            <div className="ss-signin">
              <p className="ss-signin__title">Sign in to scan screenshots</p>
              <p className="ss-note">
                Reading a screenshot uses your FlightJournal account, which keeps imports private and within your daily limit. Manual entry always works, even
                offline.
              </p>
              <div className="assist__actions">
                <button type="button" className="btn btn--lg" onClick={close}>
                  Not now
                </button>
                <Link to="/account" className="btn btn--primary btn--lg" onClick={onClose}>
                  <Icon name="user" size={18} /> Sign in
                </Link>
              </div>
            </div>
          )
        ) : (
          <>
            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              accept="image/*"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => void choose(e.target.files?.[0])}
            />

            {phase === 'idle' && (
              <>
                <button ref={chooseRef} type="button" className="ss-choose" onClick={pick}>
                  <span className="ss-choose__icon" aria-hidden="true">
                    <Icon name="image" size={24} />
                  </span>
                  <span className="ss-choose__title">Choose screenshot</span>
                  <span className="ss-choose__hint">Gallery, files or camera · read automatically</span>
                </button>
                <PrivacyNote />
              </>
            )}

            {phase !== 'idle' && (preview || busy) && (
              <div className={`ss-preview${busy ? ' is-busy' : ''}${phase === 'done' || phase === 'error' ? ' is-small' : ''}`}>
                {preview ? (
                  <img className="ss-preview__img" src={preview} alt="Screenshot selected for reading" />
                ) : (
                  <span className="ss-preview__blank" aria-hidden="true" />
                )}
                {busy && <span className="ss-preview__scan" aria-hidden="true" />}
              </div>
            )}

            {busy && (
              <>
                <p className="ss-status" role="status">
                  <span className="spinner" aria-hidden="true" />
                  {phase === 'preparing' ? 'Preparing image…' : 'Reading flight details…'}
                </p>
                <button type="button" className="btn btn--lg btn--block" onClick={cancel}>
                  Cancel
                </button>
              </>
            )}

            {phase === 'ready' && (
              <>
                <PrivacyNote compact />
                <div className="assist__actions">
                  <button type="button" className="btn btn--lg" onClick={reset}>
                    Remove
                  </button>
                  <button type="button" className="btn btn--primary btn--lg" onClick={() => void extract(preview)}>
                    <Icon name="sparkle" size={18} /> Read flight details
                  </button>
                </div>
              </>
            )}

            {phase === 'error' && error && (
              <>
                <div className="ss-error" role="alert">
                  <Icon name="warning" size={18} />
                  <p>{error.message}</p>
                </div>
                {error.code === 'setup' && <SetupCheck />}
                {error.code === 'auth' && (
                  <p className="ss-note">
                    <Link to="/account" onClick={onClose}>
                      Open your account
                    </Link>{' '}
                    to sign in again.
                  </p>
                )}
                <div className={`assist__actions${preview ? '' : ' assist__actions--single'}`}>
                  <button type="button" className={`btn btn--lg${preview ? '' : ' btn--primary'}`} onClick={pickAnother}>
                    Choose another
                  </button>
                  {preview && (
                    <button type="button" className="btn btn--primary btn--lg" onClick={() => void extract(preview)}>
                      <Icon name="refresh" size={18} /> Try again
                    </button>
                  )}
                </div>
              </>
            )}

            {phase === 'done' && result && (
              <section className="ss-results" aria-labelledby={`${titleId}-found`}>
                <div>
                  <h3 id={`${titleId}-found`} className="ss-results__title">
                    {count === 0 ? 'No flights found' : count === 1 ? 'Found 1 flight' : `Found ${count} flights`}
                  </h3>
                  <p className="ss-note">
                    {count
                      ? 'AI can misread details. Pick a flight to fill the form — nothing is saved yet.'
                      : 'Try a clearer screenshot that shows the route and date.'}
                  </p>
                </div>
                {!!result.warnings.length && (
                  <ul className="ss-warnings">
                    {result.warnings.map((w, i) => (
                      <li key={i}>
                        <Icon name="info" size={14} />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {result.flights.map((f, i) => (
                  <FlightResult
                    key={i}
                    f={f}
                    clock={clock}
                    label={selected === i ? 'Fill form again' : dirty ? 'Replace form with this flight' : 'Use this flight'}
                    primary={count === 1 || selected === i}
                    onUse={() => {
                      setSelected(i);
                      onApply(screenshotValues(f));
                    }}
                  />
                ))}
                {selected !== null && (
                  <p className="ss-note" role="status">
                    Form filled. Confirm the date, airports and times, then tap Save flight.
                  </p>
                )}
                <button type="button" className="btn btn--ghost btn--block ss-again" onClick={pickAnother}>
                  <Icon name="image" size={18} /> Scan another screenshot
                </button>
              </section>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function PrivacyNote({ compact }: { compact?: boolean }) {
  return (
    <p className={`ss-privacy${compact ? ' ss-privacy--compact' : ''}`}>
      <Icon name="shield" size={16} />
      <span>
        Your screenshot is sent to Google Gemini to read the flight details. Crop out booking codes and personal details first. The image isn’t saved in your
        journal.
      </span>
    </p>
  );
}

function FlightResult({ f, clock, label, primary, onUse }: { f: ScreenshotFlight; clock: '12h' | '24h'; label: string; primary: boolean; onUse: () => void }) {
  const from = getAirport(f.from);
  const to = getAirport(f.to);
  const time = (t: string) => (t ? formatTime(t, clock) : '?');
  const times =
    f.depTime || f.arrTime ? `${time(f.depTime)} → ${time(f.arrTime)}${f.arrDayOffset ? ` (${f.arrDayOffset > 0 ? '+' : ''}${f.arrDayOffset} day)` : ''}` : '';
  const extra = [f.aircraftType && (getAircraftType(f.aircraftType)?.name ?? f.aircraftType), f.seatNumber && `Seat ${f.seatNumber}`]
    .filter(Boolean)
    .join(' · ');
  return (
    <article className="ss-flight">
      <div className="ss-flight__route">
        <span className={`ss-flight__code${from ? '' : ' is-unknown'}`}>{from ? airportCode(from.ident) : f.from || '???'}</span>
        <Icon name="plane" size={14} className="ss-flight__plane" />
        <span className={`ss-flight__code${to ? '' : ' is-unknown'}`}>{to ? airportCode(to.ident) : f.to || '???'}</span>
        {f.flightNumber && <span className="badge ss-flight__fn">{prettyFlightNumber(f.flightNumber)}</span>}
      </div>
      <p className="ss-flight__meta">
        <span className={f.date ? '' : 'ss-flight__missing'}>{f.date ? formatFlightDate(f.date) : 'Date needs confirming'}</span>
        {times && <span className="tabular">{times}</span>}
        {extra && <span>{extra}</span>}
      </p>
      {(!from || !to) && <p className="ss-flight__missing">Pick any unrecognized airport in the form.</p>}
      <button type="button" className={`btn btn--lg btn--block${primary ? ' btn--primary' : ''}`} onClick={onUse}>
        {label}
      </button>
    </article>
  );
}

const MARK = { ok: '✓', bad: '✗', na: '–' } as const;
const MARK_LABEL = { ok: 'OK', bad: 'Problem', na: 'Not checked' } as const;

/** "Check setup": runs the server diagnostics and lists each check (✓ / ✗ / –) with what to fix. */
function SetupCheck() {
  const id = useId();
  const [status, setStatus] = useState<ScreenshotSetupStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const run = async () => {
    setChecking(true);
    try {
      setStatus(await checkScreenshotSetup());
    } catch {
      setStatus({ ready: false, checks: [{ id: 'network', label: 'Server reachable', ok: false, detail: 'Couldn’t run the check. Retry in a moment.' }] });
    } finally {
      setChecking(false);
    }
  };
  // Bring the checklist into view inside the (scrollable) sheet once it arrives.
  useEffect(() => {
    if (status)
      panel.current?.scrollIntoView?.({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [status]);
  return (
    <div className="ss-setup">
      <button type="button" className="btn btn--block" onClick={() => void run()} disabled={checking}>
        {checking ? <span className="spinner" aria-hidden="true" /> : <Icon name="settings" size={18} />}
        {checking ? 'Checking setup…' : status ? 'Check again' : 'Check setup'}
      </button>
      {status && (
        <div ref={panel} className="ss-setup__panel" role="status" aria-labelledby={`${id}-sum`}>
          <p id={`${id}-sum`} className={`ss-setup__summary${status.ready ? ' is-ready' : ''}`}>
            {status.ready ? 'Everything looks ready — try again.' : 'Fix the items marked ✗, redeploy, then check again.'}
          </p>
          <ul className="ss-checks">
            {status.checks.map((c) => {
              const kind = c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'na';
              return (
                <li key={c.id} className={`ss-check ss-check--${kind}`}>
                  <span className="ss-check__mark" role="img" aria-label={MARK_LABEL[kind]}>
                    {MARK[kind]}
                  </span>
                  <span className="ss-check__text">
                    <span className="ss-check__label">{c.label}</span>
                    {c.detail && <span className="ss-check__detail">{c.detail}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {status.model && <p className="ss-note">Model: {status.model}</p>}
        </div>
      )}
    </div>
  );
}
