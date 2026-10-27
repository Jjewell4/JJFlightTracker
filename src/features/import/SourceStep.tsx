import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { ImportReadError, loadImportFile, loadImportText, type LoadedSource } from '@/services/import';
import { BackupGlyph, LockGlyph, RadarGlyph, SheetGlyph } from './glyphs';

export type SourceKind = 'fr24' | 'generic' | 'backup';

const SOURCES: { kind: SourceKind; title: string; blurb: string; icon: ReactNode; accept: string }[] = [
  { kind: 'fr24', title: 'Flightradar24', blurb: 'Your My Flights export (CSV or Excel)', icon: <RadarGlyph />, accept: '.csv,.xlsx,.txt,text/csv' },
  { kind: 'generic', title: 'CSV or spreadsheet', blurb: 'Any CSV or Excel file — you match the columns', icon: <SheetGlyph />, accept: '.csv,.tsv,.txt,.xlsx,text/csv' },
  { kind: 'backup', title: 'Flight Log backup', blurb: 'A .json file exported from this app', icon: <BackupGlyph />, accept: '.json,application/json' },
];

interface Props {
  source: SourceKind;
  onSource: (s: SourceKind) => void;
  onLoaded: (l: LoadedSource) => Promise<void> | void;
  ready: boolean;
  initialError?: string;
}

export function SourceStep({ source, onSource, onLoaded, ready, initialError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);
  const [dragging, setDragging] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const active = SOURCES.find((s) => s.kind === source)!;

  async function run(work: () => Promise<LoadedSource> | LoadedSource) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onLoaded(await work());
    } catch (e) {
      setError(e instanceof ImportReadError ? e.message : 'Sorry, we couldn’t read that file. Is it a CSV, Excel or JSON export?');
      if (!(e instanceof ImportReadError)) console.error(e);
    } finally {
      setBusy(false);
    }
  }

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file && ready && !busy) void run(() => loadImportFile(file));
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    onFiles(e.dataTransfer.files);
  };

  return (
    <div className="stack import__source">
      <div className="import__privacy">
        <LockGlyph />
        <span>Everything happens in your browser. Your files are never uploaded anywhere.</span>
      </div>

      <div className="import__sources" role="radiogroup" aria-label="Where are your flights coming from?">
        {SOURCES.map((s) => (
          <button
            key={s.kind}
            type="button"
            role="radio"
            aria-checked={s.kind === source}
            className="source-card"
            onClick={() => onSource(s.kind)}
          >
            <span className="source-card__icon">{s.icon}</span>
            <span className="source-card__text">
              <span className="source-card__title">{s.title}</span>
              <span className="source-card__blurb">{s.blurb}</span>
            </span>
            <span className="source-card__radio" aria-hidden />
          </button>
        ))}
      </div>

      {source === 'fr24' && (
        <details className="import__help card">
          <summary>
            <span>How to export from my.flightradar24.com</span>
            <Icon name="chevron" size={18} className="import__help-chevron" />
          </summary>
          <ol className="import__howto">
            <li>
              Sign in at <strong>my.flightradar24.com</strong> in a web browser.
            </li>
            <li>
              Open your <strong>flight list</strong> (My Flights).
            </li>
            <li>
              Choose <strong>Export</strong> (or <strong>Download</strong>) and pick <strong>CSV</strong>.
            </li>
            <li>Come back here and choose the file. Opened it in Excel or Sheets first? An .xlsx file works too.</li>
          </ol>
        </details>
      )}
      {source === 'generic' && (
        <p className="import__hint">
          First row should be headings like <span className="code">Date</span>, <span className="code">From</span>, <span className="code">To</span>. Airports can be IATA (SAN) or ICAO (KSAN) codes. You’ll match the columns on the next screen.
        </p>
      )}
      {source === 'backup' && (
        <p className="import__hint">
          Choose a backup made with <strong>More → Export backup</strong>. You can merge it into your log or replace everything.
        </p>
      )}

      <div
        className={`dropzone${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="dropzone__icon" aria-hidden>
          <Icon name="upload" size={26} />
        </span>
        <div className="dropzone__title">{busy ? 'Reading your file…' : 'Choose a file'}</div>
        <div className="dropzone__sub">{busy ? 'Just a moment' : 'or drop it here'}</div>
        <button type="button" className="btn btn--primary btn--lg dropzone__btn" disabled={busy || !ready} onClick={() => inputRef.current?.click()}>
          <Icon name="file" size={20} /> {ready ? 'Browse files' : 'Loading airports…'}
        </button>
        <input ref={inputRef} type="file" accept={active.accept} className="visually-hidden" onChange={(e) => onFiles(e.target.files)} aria-label="Choose a file to import" />
      </div>

      {error && (
        <div className="import__error" role="alert">
          <Icon name="warning" size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="import__paste">
          {!pasting ? (
            <button type="button" className="btn btn--ghost btn--block" onClick={() => setPasting(true)}>
              Paste text instead
            </button>
          ) : (
            <div className="stack" style={{ gap: 'var(--space-3)' }}>
              <label className="field">
                <span className="field__label">Paste CSV{source === 'backup' ? ' or backup JSON' : ''}</span>
                <textarea
                  className="input mono"
                  rows={6}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={'Date,From,To\n2024-05-01,SAN,LAX'}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </label>
              <div className="row">
                <button type="button" className="btn btn--ghost" onClick={() => setPasting(false)}>
                  Cancel
                </button>
                <span className="spacer" />
                <button type="button" className="btn btn--primary" disabled={busy || !text.trim() || !ready} onClick={() => void run(() => loadImportText(text))}>
                  Read text
                </button>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
