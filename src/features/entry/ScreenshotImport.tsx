import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAircraftType, getAirport } from '@/data/reference';
import { Icon } from '@/components/Icon';
import { useCloudSync } from '@/services/sync/controller';
import { inferAirline } from '@/services/lookup';
import { prepareScreenshot, readScreenshot } from '@/services/screenshot/client';
import type { ScreenshotFlight, ScreenshotResult } from '@/services/screenshot/schema';
import type { FormValues } from './form-model';
import './ScreenshotImport.css';

export function screenshotValues(f: ScreenshotFlight): Partial<FormValues> {
  return {
    date: f.date, datePrecision: 'day', from: getAirport(f.from)?.ident ?? '', to: getAirport(f.to)?.ident ?? '',
    flightNumber: f.flightNumber, airline: inferAirline(f.flightNumber), depTime: f.depTime, arrTime: f.arrTime,
    arrDayOffset: f.arrDayOffset ?? undefined, aircraftType: getAircraftType(f.aircraftType)?.icao ?? '',
    aircraftName: '', seatNumber: f.seatNumber,
  };
}

export function ScreenshotImport({ onApply, dirty }: { onApply: (values: Partial<FormValues>) => void; dirty: boolean }) {
  const sync = useCloudSync();
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ScreenshotResult | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const request = useRef<AbortController | null>(null);
  const panel = useRef<HTMLDetailsElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; request.current?.abort(); }, []);
  const cancel = () => { request.current?.abort(); request.current = null; setBusy(false); };
  const choose = async (file?: File) => {
    if (!file) return;
    const current = ++generation.current;
    cancel(); setPreparing(true); setError(''); setPreview(''); setResult(null); setSelected(null);
    try {
      const image = await prepareScreenshot(file);
      if (generation.current === current) setPreview(image);
    } catch (e) { if (generation.current === current) setError(e instanceof Error ? e.message : 'Could not open this image.'); }
    finally { if (generation.current === current) setPreparing(false); }
  };
  const extract = async () => {
    if (!preview || request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setResult(null); setSelected(null);
    const timeout = setTimeout(() => controller.abort('timeout'), 60_000);
    try {
      const found = await readScreenshot(preview, controller.signal);
      if (!controller.signal.aborted) setResult(found);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not read the screenshot.');
      else if (controller.signal.reason === 'timeout') setError('Reading took too long. Try again with a smaller crop.');
    } finally { clearTimeout(timeout); if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  return <details className="screenshot-import card" ref={panel}>
    <summary><Icon name="image" size={20} /><span>Import a screenshot<small>Read flight details with AI</small></span><Icon name="chevron" size={18} /></summary>
    <p>Choose a booking, boarding pass or flight-status screenshot. Review the details before saving.</p>
    {sync.phase !== 'signed-in' ? <p><Link to="/account">Sign in</Link> to read screenshots. Manual entry always works offline.</p> : <>
      <label className="field"><span className="field__label">Flight screenshot · PNG, JPEG or WebP · up to 10 MB</span>
        <input ref={fileInput} className="input screenshot-import__file" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || preparing} onChange={e => { void choose(e.target.files?.[0]); }} />
      </label>
      {preparing && <p role="status">Preparing image…</p>}
      {preview && <>
        <img className="screenshot-import__preview" src={preview} alt="Screenshot selected for flight extraction" />
        <p className="screenshot-import__privacy">When you tap Read screenshot, this image is sent to Google Gemini. Crop out booking codes and personal details first. We don’t store the image in your journal.</p>
        <div className="screenshot-import__actions"><button type="button" className="btn btn--primary" disabled={busy} onClick={() => void extract()}><Icon name="sparkle" size={18} />{busy ? 'Reading screenshot…' : 'Read screenshot'}</button>
          {busy && <button type="button" className="btn" onClick={cancel}>Cancel</button>}
          {!busy && <button type="button" className="btn btn--ghost" onClick={() => { setPreview(''); setResult(null); setSelected(null); setError(''); if (fileInput.current) fileInput.current.value = ''; }}>Remove image</button>}
        </div>
      </>}
      {busy && <p role="status">Reading the visible flight details. This can take a few moments.</p>}
      {error && <p className="field__error" role="alert">{error}</p>}
      {result && <section aria-label="Extracted flights">
        <h2 className="section-title">Review {result.flights.length === 1 ? 'your flight' : `${result.flights.length} flights`}</h2>
        <p>AI can misread details. Choose one flight to fill the form; nothing is saved yet.</p>
        {!!result.warnings.length && <ul className="screenshot-import__warnings">{result.warnings.map((w,i) => <li key={i}>{w}</li>)}</ul>}
        {result.flights.map((f,i) => <article className="screenshot-import__flight" key={i}>
          <strong>{f.from || '?'} → {f.to || '?'}</strong><span>{f.flightNumber || 'Flight number not found'} · {f.date || 'Date/year needs confirmation'}</span>
          <span>{f.depTime || 'Time unknown'} → {f.arrTime || 'Time unknown'}{f.arrDayOffset ? ` (${f.arrDayOffset > 0 ? '+' : ''}${f.arrDayOffset} day)` : ''}</span>
          {(!getAirport(f.from) || !getAirport(f.to)) && <span className="field__error">Choose any unrecognized airports in the form.</span>}
          {f.aircraftType && <span>Aircraft: {f.aircraftType}</span>}{f.seatNumber && <span>Seat: {f.seatNumber}</span>}
          <button type="button" className="btn" onClick={() => { onApply(screenshotValues(f)); setSelected(i); if (panel.current) panel.current.open = false; }}>{selected === i ? 'Fill form again' : dirty ? 'Replace form with this flight' : 'Use this flight'}</button>
        </article>)}
        {selected !== null && <p role="status">Form filled below. Confirm the date, airports and times, then tap Save flight.</p>}
      </section>}
    </>}
  </details>;
}
