import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AirlineLogo } from '@/components/AirlineLogo';
import { Icon } from '@/components/Icon';
import { getAircraftType, getAirline } from '@/data/reference';
import { addFlight, deleteFlight, setTripOccasion, updateFlight, useSettings } from '@/lib/db';
import { enrichFlight, parseFlightNumber } from '@/lib/flight-utils';
import { todayLocal } from '@/lib/time';
import type { DatePrecision, Flight, SeatType } from '@/lib/types';
import { requestPersistentStorageOnce } from '@/services/import/storage';
import { inferAirline, type LookupOutcome } from '@/services/lookup';
import { DateField } from './DateField';
import { DetailsSection } from './DetailsSection';
import { LookupCard } from './LookupCard';
import { RouteCard } from './RouteCard';
import { ConfirmSheet } from '@/components/Sheet';
import { goBackScreens, popOverlayEntries, useBackDismiss } from '@/components/useBackDismiss';
import { TimesCard } from './TimesCard';
import { AircraftSheet, AirlineSheet, AirportSheet } from './pickers';
import {
  applyLookup,
  emptyValues,
  clearFields,
  formEquals,
  inferSeatType,
  isEmptyField,
  lookupDiff,
  prettyFlightNumber,
  validate,
  valuesToInput,
  type FillKey,
  type FormErrors,
  type FormValues,
} from './form-model';
import { usageStats } from './history-stats';
import { getDetailsOpen, saveDetailsOpen, saveEntryDefaults } from './prefs';
import { EntryAssist } from './EntryAssist';
import { DuplicateNotice, duplicateSentence } from './DuplicateNotice';
import { findDuplicates } from './duplicates';
import { useFlightLookup } from './useFlightLookup';
import { announceLocalSave } from '@/services/sync/controller';
import { markLegsHandled } from '@/services/screenshot/drafts';
import type { DraftLegRef } from './ScreenshotImport';

/** Results at or above this confidence auto-fill empty fields; below it they are offered with "Use these details". */
const AUTO_FILL_MIN = 0.6;
const PREFIX = 'prefix';

type SheetName = 'from' | 'to' | 'airline' | 'aircraft' | null;
/** Fields filled by quick entry or a screenshot: fill groups plus date / flight number / seat. */
type AssistKey = FillKey | 'date' | 'flightNumber' | 'seat';
/** Fill group → origin: 'prefix' (airline inferred from flight number) or the lookup result key. */
type AutoMap = Map<FillKey, string>;

export interface FlightFormProps {
  mode: 'new' | 'edit';
  initial: FormValues;
  /** Groups treated as user-entered from the start (edit / duplicate / return prefill). */
  initialEdited: string[];
  /** Flight being edited. */
  base?: Flight;
  flights: Flight[] | undefined;
  note?: string;
  /** Opened from a screenshot draft's leg (To review → Edit): saving marks the leg done. */
  draftLeg?: DraftLegRef;
}

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function FlightForm({ mode, initial, initialEdited, base, flights, note, draftLeg }: FlightFormProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const settings = useSettings();
  const stats = useMemo(() => usageStats(flights), [flights]);

  const [v, setV] = useState<FormValues>(initial);
  const [edited, setEdited] = useState<Set<string>>(() => new Set(initialEdited));
  const [auto, setAuto] = useState<AutoMap>(() => {
    const m: AutoMap = new Map();
    if (!initialEdited.includes('airline') && initial.airline) m.set('airline', PREFIX);
    return m;
  });
  const [armed, setArmed] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<LookupOutcome | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedLocally, setSavedLocally] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState('');
  const [screenshotReview, setScreenshotReview] = useState(!!draftLeg);
  /** The screenshot draft leg the form was filled from, if any. */
  const [fromDraft, setFromDraft] = useState<DraftLegRef | undefined>(draftLeg);
  /** Highlighted (sparkle + glow) until the user changes them. */
  const [assisted, setAssisted] = useState<ReadonlySet<AssistKey>>(() => new Set());
  const [sheet, setSheet] = useState<SheetName>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** Matching flights the user said are different ("It's a different flight" / "Save anyway"). */
  const [ackedDuplicates, setAckedDuplicates] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  /** Existing flight the save confirmation is about (kept while the sheet animates out). */
  const [duplicateOf, setDuplicateOf] = useState<Flight | null>(null);
  /** "View it" on a duplicate while there are unsaved edits: asks before leaving. */
  const [viewTarget, setViewTarget] = useState<Flight | null>(null);
  const [leaving, setLeaving] = useState(false);
  /** Set once the form is being left on purpose (saved, deleted, discarded): Back pops are expected. */
  const leavingRef = useRef(false);
  const dirty = useMemo(() => !formEquals(v, initial), [v, initial]);

  // While there are unsaved edits, Back (Android back or the header/Cancel buttons) asks
  // before throwing them away. The guard owns one history entry; popping it opens the sheet.
  // Confirm sheets opened from the form take over the guard's history entry while they're up.
  useBackDismiss(dirty && !confirmDiscard && !confirmDuplicate && !viewTarget && !leaving, () => {
    if (!leavingRef.current) setConfirmDiscard(true);
  });
  const [detailsOpen, setDetailsOpen] = useState(() => {
    const hasDetails = !!(initial.aircraftType || initial.aircraftName || initial.seatNumber || initial.registration || initial.note || initial.datePrecision !== 'day');
    return getDetailsOpen() || (mode === 'edit' && hasDetails);
  });

  // Hash routing keeps the previous screen's scroll position; a form always starts at the top.
  useEffect(() => { window.scrollTo(0, 0); }, []);

  const fromRef = useRef<HTMLButtonElement>(null);
  const toRef = useRef<HTMLButtonElement>(null);
  const fnRef = useRef<HTMLInputElement>(null);

  // Latest state for async callbacks.
  const state = useRef({ v, edited, auto });
  state.current = { v, edited, auto };

  const errors: FormErrors = useMemo(() => {
    const all = validate(v);
    if (submitted) return all;
    // Before the first save attempt only show errors that are unambiguous mistakes.
    const early: FormErrors = {};
    if (all.to && v.to && v.from) early.to = all.to;
    if (all.times && v.depTime && v.arrTime) early.times = all.times;
    return early;
  }, [v, submitted]);

  // Flights already in the log that these values may duplicate (the edited flight excluded).
  const duplicates = useMemo(
    () =>
      findDuplicates(
        { date: v.date, datePrecision: v.datePrecision, from: v.from, to: v.to, flightNumber: v.flightNumber, depTime: v.datePrecision === 'day' ? v.depTime : undefined },
        flights,
        { excludeId: base?.id },
      ),
    [v.date, v.datePrecision, v.from, v.to, v.flightNumber, v.depTime, flights, base?.id],
  );
  // Editing a flight that already had a twin: still pointed out, but saving other changes never asks.
  const preexisting = useMemo(() => {
    if (!base) return new Set<string>();
    const q = { date: initial.date, datePrecision: initial.datePrecision, from: initial.from, to: initial.to, flightNumber: initial.flightNumber, depTime: initial.depTime };
    return new Set(findDuplicates(q, flights, { excludeId: base.id }).filter((m) => m.kind === 'duplicate').map((m) => m.flight.id));
  }, [base, initial, flights]);
  const openDuplicates = useMemo(() => duplicates.filter((m) => !ackedDuplicates.has(m.flight.id)), [duplicates, ackedDuplicates]);
  const acknowledgeDuplicates = (ids: string[]) => setAckedDuplicates((s) => new Set([...s, ...ids]));

  const unassist = useCallback((...keys: AssistKey[]) => {
    setAssisted((s) => {
      if (!keys.some((k) => s.has(k))) return s;
      const n = new Set(s);
      keys.forEach((k) => n.delete(k));
      return n;
    });
  }, []);

  /** Records a manual edit: the group is now the user's and lookups will never overwrite it. */
  const touch = useCallback((...keys: string[]) => {
    unassist(...(keys as AssistKey[]));
    setEdited((s) => {
      const n = new Set(s);
      keys.forEach((k) => n.add(k));
      return n;
    });
    setAuto((m) => {
      if (!keys.some((k) => m.has(k as FillKey))) return m;
      const n = new Map(m);
      keys.forEach((k) => n.delete(k as FillKey));
      return n;
    });
  }, [unassist]);

  const patch = useCallback((p: Partial<FormValues>) => setV((cur) => ({ ...cur, ...p })), []);

  // ---------- lookup ----------

  /** Replaces all lookup-filled groups with `result` (or clears them when null). */
  const fillFrom = useCallback((result: LookupOutcome['results'][number] | null, fallbackAirline?: LookupOutcome['airline']) => {
    const { v: cur, edited: ed, auto: au } = state.current;
    const lookupKeys = [...au].filter(([, src]) => src !== PREFIX).map(([k]) => k);
    let next = clearFields(cur, lookupKeys);
    const nextAuto: AutoMap = new Map([...au].filter(([, src]) => src === PREFIX));
    // Airline falls back to the flight-number prefix when nothing better is known.
    if (!ed.has('airline') && isEmptyField(next, 'airline') && fallbackAirline) {
      next = { ...next, airline: fallbackAirline };
      nextAuto.set('airline', PREFIX);
    }
    if (result) {
      const replaceable = new Set<FillKey>(nextAuto.has('airline') ? ['airline'] : []);
      const applied = applyLookup(next, result, { edited: ed, replaceable });
      next = applied.values;
      for (const k of applied.filled) nextAuto.set(k, result.key);
    }
    if (next.seatNumber && !ed.has('seatType')) next.seatType = inferSeatType(next.seatNumber, next.aircraftType) ?? next.seatType;
    setV(next);
    setAuto(nextAuto);
  }, []);

  const onOutcome = useCallback(
    (o: LookupOutcome) => {
      // Transient failures keep whatever is already filled.
      if (o.status === 'error' || o.status === 'offline' || o.status === 'invalid') return;
      const best = o.results[0];
      setActiveKey(best?.key ?? null);
      setDismissed(null);
      fillFrom(best && best.confidence >= AUTO_FILL_MIN ? best : null, o.airline);
    },
    [fillFrom],
  );

  const lookup = useFlightLookup({
    enabled: armed,
    flightNumber: v.flightNumber,
    date: v.datePrecision === 'day' ? v.date : '',
    settings,
    flights,
    excludeId: base?.id,
    onOutcome,
  });

  const outcome = lookup.outcome;
  const showCard = armed && outcome?.status === 'found' && dismissed !== outcome && !lookup.loading;
  const active = showCard ? (outcome.results.find((r) => r.key === activeKey) ?? outcome.results[0]) : undefined;
  const filledFromActive = active ? [...auto].filter(([, src]) => src === active.key).map(([k]) => k) : [];
  const isFilled = (k: AssistKey) => {
    if (assisted.has(k)) return true;
    const src = auto.get(k as FillKey);
    return !!src && src !== PREFIX;
  };

  // ---------- field handlers ----------

  /** `cur` with a new flight number, inferring the airline from its prefix unless the user picked one. */
  const withFlightNumber = (cur: FormValues, raw: string): { next: FormValues; nextAuto: AutoMap } => {
    const { edited: ed, auto: au } = state.current;
    const cleaned = raw.toUpperCase().replace(/[^A-Z0-9 ]/g, '');
    const next = { ...cur, flightNumber: cleaned };
    let nextAuto = au;
    if (!ed.has('airline')) {
      const inferred = inferAirline(cleaned);
      const src = au.get('airline');
      if (inferred && (isEmptyField(cur, 'airline') || src)) {
        next.airline = inferred;
        nextAuto = new Map(au).set('airline', PREFIX);
      } else if (!inferred && src === PREFIX) {
        next.airline = undefined;
        nextAuto = new Map(au);
        nextAuto.delete('airline');
      }
    }
    return { next, nextAuto };
  };

  const setFlightNumber = (raw: string) => {
    setArmed(true);
    unassist('flightNumber');
    const { next, nextAuto } = withFlightNumber(state.current.v, raw);
    if (nextAuto !== state.current.auto) setAuto(nextAuto);
    setV(next);
  };

  const setDate = (date: string) => {
    patch({ date });
    unassist('date');
    setArmed(true);
  };

  // ---------- quick entry / screenshot ----------

  /** After a fill from a sheet: highlight what changed and bring the top of the form into view. */
  const showAssisted = (keys: AssistKey[]) => {
    setAssisted(new Set(keys));
    // Let the sheet finish closing (it restores focus to its button) before scrolling.
    setTimeout(() => window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }), 260);
  };

  const applyQuickEntry = (values: Partial<FormValues>) => {
    // A new route/date makes the old arrival day meaningless: back to inferring it.
    let next: FormValues = { ...state.current.v, ...values, arrDayOffset: undefined };
    if (values.flightNumber) {
      const r = withFlightNumber(next, prettyFlightNumber(values.flightNumber));
      next = r.next;
      if (r.nextAuto !== state.current.auto) setAuto(r.nextAuto);
      setArmed(true); // look the flight up for times / aircraft
    }
    setV(next);
    touch('from', 'to');
    showAssisted(['date', 'from', 'to', ...(values.flightNumber ? (['flightNumber'] as const) : [])]);
  };

  const applyScreenshot = (values: Partial<FormValues>, from?: DraftLegRef) => {
    setFromDraft(from);
    setV({
      ...emptyValues({ cabinClass: v.cabinClass, reason: v.reason }),
      ...values,
      flightNumber: prettyFlightNumber(values.flightNumber),
      aircraftName: values.aircraftName || (getAircraftType(values.aircraftType)?.name ?? ''),
      seatType: inferSeatType(values.seatNumber, values.aircraftType),
    });
    setEdited(new Set(['airline', 'from', 'to', 'times', 'aircraft', 'registration', 'seatType']));
    setAuto(new Map());
    setArmed(false);
    setScreenshotReview(true);
    setSubmitted(false);
    if (values.aircraftType || values.seatNumber) setDetailsOpen(true);
    const keys: AssistKey[] = [];
    if (values.date) keys.push('date');
    if (values.flightNumber) keys.push('flightNumber');
    if (values.airline) keys.push('airline');
    if (values.from) keys.push('from');
    if (values.to) keys.push('to');
    if (values.depTime || values.arrTime) keys.push('times');
    if (values.aircraftType) keys.push('aircraft');
    if (values.seatNumber) keys.push('seat');
    showAssisted(keys);
  };

  const setPrecision = (p: DatePrecision) => {
    setV((cur) => {
      const d = /^\d{4}-\d{2}-\d{2}$/.test(cur.date) ? cur.date : todayLocal();
      const date = p === 'year' ? `${d.slice(0, 4)}-01-01` : p === 'month' ? `${d.slice(0, 7)}-01` : d;
      return { ...cur, datePrecision: p, date };
    });
  };

  // A new route or new times change which arrival day makes sense: go back to inferring it
  // (only a tap on the day chip pins it).
  const pickAirport = (role: 'from' | 'to', ident: string) => {
    patch({ [role]: ident, arrDayOffset: undefined });
    touch(role);
    setSheet(null);
  };

  const swap = () => {
    setV((cur) => ({ ...cur, from: cur.to, to: cur.from, arrDayOffset: undefined }));
    touch('from', 'to');
  };

  const setTimes = (p: Partial<FormValues>) => {
    patch('arrDayOffset' in p ? p : { ...p, arrDayOffset: undefined });
    touch('times');
  };

  const setSeatNumber = (seatNumber: string) => {
    unassist('seat');
    setV((cur) => ({
      ...cur,
      seatNumber,
      seatType: state.current.edited.has('seatType') ? cur.seatType : inferSeatType(seatNumber, cur.aircraftType),
    }));
  };

  const setSeatType = (seatType: SeatType | undefined) => {
    patch({ seatType });
    touch('seatType');
  };

  const pickAircraft = (a: { icao?: string; name: string }) => {
    setV((cur) => ({
      ...cur,
      aircraftType: a.icao ?? '',
      aircraftName: a.name,
      seatType: state.current.edited.has('seatType') ? cur.seatType : (inferSeatType(cur.seatNumber, a.icao) ?? cur.seatType),
    }));
    touch('aircraft');
    setSheet(null);
  };

  // ---------- save / delete / back ----------

  const leave = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(base ? `/flights/${base.id}` : '/', { replace: true });
  };

  const goBack = () => {
    if (!dirty || saving) return leave();
    // Pop the guard's history entry (same path as the system Back); it opens the confirm sheet.
    if ((window.history.state as { __overlay?: string } | null)?.__overlay) window.history.back();
    else setConfirmDiscard(true);
  };

  const discard = async () => {
    leavingRef.current = true;
    setLeaving(true);
    await popOverlayEntries(); // the confirm sheet's own entry
    leave();
  };

  const focusFirstError = (errs: FormErrors) => {
    const target =
      (errs.date && document.getElementById('entry-date')) ||
      (errs.flightNumber && fnRef.current) ||
      (errs.from && fromRef.current) ||
      (errs.to && toRef.current) ||
      (errs.times && document.getElementById('entry-dep'));
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
      target.focus({ preventScroll: true });
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return;
    setSubmitted(true);
    setSaveError('');
    const errs = validate(v);
    if (Object.keys(errs).length) {
      focusFirstError(errs);
      return;
    }
    // A likely duplicate the user hasn't waved through: ask once before adding a second copy.
    const dup = openDuplicates.find((m) => m.kind === 'duplicate' && !preexisting.has(m.flight.id));
    if (dup) {
      setDuplicateOf(dup.flight);
      setConfirmDuplicate(true);
      return;
    }
    void save();
  };

  const saveAnyway = async () => {
    acknowledgeDuplicates(openDuplicates.filter((m) => m.kind === 'duplicate').map((m) => m.flight.id));
    // The sheet stays up (busy) while saving: saving pops its history entry and moves on.
    // Closing it first would pop that entry a second time.
    if (!(await save())) setConfirmDuplicate(false);
  };

  const leaveToView = async () => {
    if (!viewTarget) return;
    const id = viewTarget.id;
    leavingRef.current = true;
    setLeaving(true);
    await popOverlayEntries(); // the confirm sheet's own entry
    navigate(`/flights/${id}`, { replace: true });
  };

  /** Saves and leaves the form; resolves false when saving failed. */
  const save = async (): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    const usedLookup = [...auto.values()].some((src) => src !== PREFIX);
    const source = screenshotReview ? 'screenshot' : usedLookup ? 'lookup' : (base?.source ?? 'manual');
    try {
      const input = enrichFlight(valuesToInput(v, { source, base }));
      if (base) {
        await updateFlight(base.id, input);
        // Occasions belong to the trip: a change on one leg applies to all of them.
        if (base.tripId && input.occasion !== base.occasion) await setTripOccasion(base.tripId, input.occasion);
        setSavedLocally(true);
        announceLocalSave();
        void requestPersistentStorageOnce();
        leavingRef.current = true;
        await popOverlayEntries(); // the unsaved-changes guard's entry
        // Back to the detail screen we came from (it updates live), rather than stacking a copy.
        if (location.key !== 'default') goBackScreens(1, () => navigate(`/flights/${base.id}`, { replace: true }));
        else navigate(`/flights/${base.id}`, { replace: true });
      } else {
        const saved = await addFlight(input);
        if (fromDraft) void markLegsHandled(fromDraft.draftId, [fromDraft.index]);
        setSavedLocally(true);
        announceLocalSave();
        // Now there's data worth keeping: ask the browser not to evict it (fire-and-forget).
        void requestPersistentStorageOnce();
        leavingRef.current = true;
        await popOverlayEntries(); // the unsaved-changes guard's entry
        saveEntryDefaults({ cabinClass: v.cabinClass, reason: v.reason });
        navigate(`/flights/${saved.id}`, { replace: true });
      }
      return true;
    } catch (err) {
      console.error(err);
      leavingRef.current = false;
      savingRef.current = false;
      setSavedLocally(false);
      setSaving(false);
      setSaveError("Couldn't save this flight. Please try again.");
      return false;
    }
  };

  const onDelete = async () => {
    if (!base) return;
    await deleteFlight(base.id);
    leavingRef.current = true;
    await popOverlayEntries(); // this sheet's entry and the unsaved-changes guard's
    // Skip the (now deleted) flight's detail screen too.
    if (location.key !== 'default') goBackScreens(2, () => navigate('/', { replace: true }));
    else navigate('/', { replace: true });
  };

  const toggleDetails = () => {
    setDetailsOpen((o) => {
      saveDetailsOpen(!o);
      return !o;
    });
  };

  // ---------- render ----------

  const airline = getAirline(v.airline?.icao) ?? getAirline(v.airline?.iata);
  const airlineName = airline?.name ?? v.airline?.name;
  const prefix = parseFlightNumber(v.flightNumber)?.prefix;
  const airlineSrc = auto.get('airline');

  let status: { kind: 'loading' | 'quiet' | 'warn'; text: string } | null = null;
  if (armed && lookup.loading) status = { kind: 'loading', text: `Looking up ${prettyFlightNumber(v.flightNumber)}…` };
  else if (armed && outcome && outcome.status !== 'found' && outcome.status !== 'invalid')
    status = { kind: outcome.status === 'none' ? 'quiet' : 'warn', text: outcome.message };
  else if (armed && outcome?.status === 'found' && outcome.message.startsWith('Offline')) status = { kind: 'warn', text: outcome.message };

  return (
    <div className="entry">
      <header className="entry-header">
        <button type="button" className="entry-header__btn" onClick={goBack} aria-label={mode === 'edit' ? 'Back' : 'Close'}>
          <Icon name={mode === 'edit' ? 'back' : 'close'} size={22} />
        </button>
        <div className="entry-header__titles">
          <h1 className="entry-header__title">{mode === 'edit' ? 'Edit flight' : 'Log a flight'}</h1>
          {note && <p className="entry-header__note">{note}</p>}
        </div>
        <span className="entry-header__btn" aria-hidden="true" />
      </header>

      {mode === 'new' && <EntryAssist dirty={dirty} clock={settings.clock} onQuick={applyQuickEntry} onScreenshot={applyScreenshot} />}
      <form className={`entry-form${mode === 'new' ? ' entry-form--assist' : ''}`} onSubmit={onSubmit} noValidate>
        {screenshotReview && (
          <p className="entry-banner" role="status">
            <Icon name="sparkle" size={16} />
            <span>
              <strong>Filled from your screenshot.</strong> Check each field before saving — AI can misread details.
              {(!v.date || !v.from || !v.to) && ' Add the missing date or airports.'}
            </span>
          </p>
        )}
        <DuplicateNotice
          matches={openDuplicates}
          hint={
            mode === 'new'
              ? 'Saving this would add a second copy.'
              : preexisting.has(openDuplicates[0]?.flight.id ?? '')
                ? 'Both copies are in your log and count in your stats.'
                : 'With these changes the two would match.'
          }
          onAcknowledge={() => acknowledgeDuplicates(openDuplicates.map((m) => m.flight.id))}
          // With unsaved edits "View it" asks first (a plain link would leave right away).
          onView={dirty ? setViewTarget : undefined}
        />
        <section className="entry-card flight-card" aria-label="Date and flight number">
          <DateField id="entry-date" date={v.date} precision={v.datePrecision} onChange={setDate} error={errors.date} filled={isFilled('date')} />

          <div className="entry-field">
            <label className="field__label" htmlFor="entry-fn">
              Flight number <span className="subtle">· optional</span>
              {isFilled('flightNumber') && <Icon name="sparkle" size={12} className="sparkle-icon" />}
            </label>
            <div className={`fn-input${errors.flightNumber ? ' has-error' : ''}${isFilled('flightNumber') ? ' is-filled' : ''}`}>
              <input
                ref={fnRef}
                id="entry-fn"
                className="fn-input__field"
                value={v.flightNumber}
                onChange={(e) => setFlightNumber(e.target.value)}
                onBlur={() => parseFlightNumber(v.flightNumber) && patch({ flightNumber: prettyFlightNumber(v.flightNumber) })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                placeholder="UA 123"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                maxLength={9}
                aria-invalid={!!errors.flightNumber}
                aria-describedby="entry-fn-status"
              />
              <span className="fn-input__state" aria-hidden="true">
                {lookup.loading && armed ? <span className="spinner" /> : showCard ? <Icon name="sparkle" size={18} className="fn-input__found" /> : null}
              </span>
            </div>
            <p id="entry-fn-status" className={`fn-status${status ? ` fn-status--${status.kind}` : ''}`} aria-live="polite">
              {errors.flightNumber ? <span className="field__error">{errors.flightNumber}</span> : status?.text}
            </p>
          </div>

          <button type="button" className={`picker-row airline-row${isFilled('airline') ? ' is-filled' : ''}`} onClick={() => setSheet('airline')} aria-haspopup="dialog">
            {v.airline ? (
              <AirlineLogo iata={airline?.iata || v.airline.iata} icao={v.airline.icao} name={airlineName} size={36} />
            ) : (
              <span className="picker-row__icon" aria-hidden="true">
                <Icon name="plane" size={18} />
              </span>
            )}
            <span className="picker-row__main">
              <span className="picker-row__label">
                Airline
                {airlineSrc === PREFIX && prefix && <span className="subtle"> · from {prefix}</span>}
                {isFilled('airline') && <Icon name="sparkle" size={12} className="sparkle-icon" />}
              </span>
              <span className={`picker-row__value${airlineName ? '' : ' is-placeholder'}`}>{airlineName || 'Choose airline'}</span>
            </span>
            <Icon name="chevron" size={18} className="picker-row__chev" />
          </button>
        </section>

        {showCard && active && outcome && (
          <LookupCard
            key={outcome.flightNumber + outcome.query.date}
            outcome={outcome}
            active={active}
            filledKeys={filledFromActive}
            diff={lookupDiff(v, active, edited)}
            clock={settings.clock}
            onChoose={(key) => {
              setActiveKey(key);
              const r = outcome.results.find((x) => x.key === key);
              if (r) fillFrom(r, outcome.airline);
            }}
            onApply={() => fillFrom(active, outcome.airline)}
            onUndo={() => fillFrom(null, outcome.airline)}
            onDismiss={() => setDismissed(outcome)}
          />
        )}

        <RouteCard
          from={v.from}
          to={v.to}
          errors={{ from: errors.from, to: errors.to }}
          filled={{ from: isFilled('from'), to: isFilled('to') }}
          unit={settings.distanceUnit}
          onPick={(role) => setSheet(role)}
          onSwap={swap}
          fromRef={fromRef}
          toRef={toRef}
        />


        {v.datePrecision === 'day' && <TimesCard v={v} onChange={setTimes} clock={settings.clock} filled={isFilled('times')} error={errors.times} />}

        <DetailsSection
          v={v}
          open={detailsOpen}
          onToggle={toggleDetails}
          onPatch={(p, key) => {
            if (key === 'seat') setSeatNumber(p.seatNumber ?? '');
            else patch(p);
            if (key === 'registration') touch('registration');
          }}
          onSeatType={setSeatType}
          onPrecision={setPrecision}
          onPickAircraft={() => setSheet('aircraft')}
          tripName={base?.tripId ? base.tripName?.trim() || 'this trip' : undefined}
          filled={{ aircraft: isFilled('aircraft'), registration: isFilled('registration'), seat: isFilled('seat') }}
        />

        {mode === 'edit' && (
          <button type="button" className="btn btn--ghost btn--block entry-delete" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={18} />
            Delete flight
          </button>
        )}

        <div className="entry-actions">
          {saveError && (
            <p className="field__error entry-actions__error" role="alert">
              {saveError}
            </p>
          )}
          <div className="entry-actions__row">
            {mode === 'edit' && (
              <button type="button" className="btn btn--lg entry-actions__cancel" onClick={goBack}>
                Cancel
              </button>
            )}
            <button type="submit" className="btn btn--primary btn--lg btn--block entry-actions__save" disabled={saving}>
              {saving && !savedLocally ? <span className="spinner spinner--inverse" aria-hidden="true" /> : <Icon name="check" size={20} strokeWidth={2.25} />}
              {savedLocally ? 'Saved on this device' : saving ? 'Saving on this device…' : mode === 'edit' ? 'Save changes' : 'Save flight'}
            </button>
          </div>
        </div>
      </form>

      <AirportSheet
        open={sheet === 'from' || sheet === 'to'}
        role={sheet === 'to' ? 'to' : 'from'}
        value={sheet === 'to' ? v.to : v.from}
        other={sheet === 'to' ? v.from : v.to}
        stats={stats}
        onClose={() => setSheet(null)}
        onSelect={(ident) => pickAirport(sheet === 'to' ? 'to' : 'from', ident)}
      />
      <AirlineSheet
        open={sheet === 'airline'}
        value={v.airline}
        stats={stats}
        onClose={() => setSheet(null)}
        onSelect={(a) => {
          patch({ airline: a });
          touch('airline');
          setSheet(null);
        }}
      />
      <AircraftSheet open={sheet === 'aircraft'} value={v.aircraftType} stats={stats} onClose={() => setSheet(null)} onSelect={pickAircraft} />
      <ConfirmSheet
        open={confirmDelete}
        title="Delete this flight?"
        message="It will be removed from your log and stats. This can't be undone."
        confirmLabel="Delete flight"
        icon="trash"
        danger
        onConfirm={onDelete}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmSheet
        open={confirmDuplicate}
        title={mode === 'edit' ? 'Save a duplicate?' : 'Save a second copy?'}
        message={
          duplicateOf && (
            <>
              {duplicateSentence(duplicateOf)}.{' '}
              {mode === 'edit' ? 'With these changes both flights will look the same in your log and stats.' : 'Saving this one too counts the flight twice in your stats.'}
            </>
          )
        }
        confirmLabel="Save anyway"
        icon="copy"
        busy={saving}
        onConfirm={() => void saveAnyway()}
        onCancel={() => setConfirmDuplicate(false)}
      />
      <ConfirmSheet
        open={!!viewTarget}
        title="Leave without saving?"
        message={mode === 'edit' ? 'Your edits to this flight won’t be saved.' : 'The flight you’re entering here won’t be saved.'}
        confirmLabel="View other flight"
        cancelLabel="Keep editing"
        icon="warning"
        onConfirm={() => void leaveToView()}
        onCancel={() => setViewTarget(null)}
      />
      <ConfirmSheet
        open={confirmDiscard}
        title="Discard changes?"
        message={mode === 'edit' ? 'Your edits to this flight won’t be saved.' : 'This flight hasn’t been saved yet.'}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        icon="warning"
        danger
        onConfirm={() => void discard()}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  );
}
