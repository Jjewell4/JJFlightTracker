import { useCallback, useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useBackDismiss } from '@/components/useBackDismiss';
import { loadReference, useReferenceReady } from '@/data/reference';
import { useFlights, useSettings } from '@/lib/db';
import { flightDistanceKm } from '@/lib/flight-utils';
import {
  analyzeSheet,
  candidatesFromSheet,
  commitImport,
  findDuplicates,
  fixCandidate,
  mappingIsComplete,
  planImport,
  requestPersistentStorage,
  type CandidateFix,
  type ColumnMapping,
  type DateOrder,
  type DuplicatePolicy,
  type ImportCandidate,
  type ImportResult,
  type LoadedSource,
  type ParsedBackup,
  type Sheet,
  type SheetFormat,
} from '@/services/import';
import { DoneStep, ProgressView, type DoneSummary } from './DoneStep';
import { MappingStep } from './MappingStep';
import { ReviewStep } from './ReviewStep';
import { SourceStep, type SourceKind } from './SourceStep';
import './import.css';

type Step = 'source' | 'mapping' | 'review' | 'importing' | 'done';

interface TableState {
  sheet: Sheet;
  fileName?: string;
  xlsx: boolean;
  format: SheetFormat;
  mapping: ColumnMapping;
  dateOrder: DateOrder;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function ImportPage() {
  const refReady = useReferenceReady();
  const existing = useFlights();
  const settings = useSettings();

  const [step, setStep] = useState<Step>('source');
  const [source, setSource] = useState<SourceKind>('fr24');
  const [table, setTable] = useState<TableState | null>(null);
  const [backup, setBackup] = useState<{ data: ParsedBackup; fileName?: string } | null>(null);
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [policy, setPolicy] = useState<DuplicatePolicy>('skip');
  const [replace, setReplace] = useState(false);
  const [restoreSettings, setRestoreSettings] = useState(true);
  const [notice, setNotice] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [done, setDone] = useState<{ result: ImportResult; summary: DoneSummary } | null>(null);

  const isBackup = !!backup;

  const duplicates = useMemo(
    () => (replace || !existing ? new Map<string, string>() : findDuplicates(candidates, existing)),
    [candidates, existing, replace],
  );

  const reset = useCallback(() => {
    setStep('source');
    setTable(null);
    setBackup(null);
    setCandidates([]);
    setSkipped(new Set());
    setPolicy('skip');
    setReplace(false);
    setNotice(undefined);
    setError(undefined);
    setDone(null);
  }, []);

  // ---- a file (or pasted text) was read
  const handleLoaded = useCallback(
    async (loaded: LoadedSource) => {
      await loadReference();
      setSkipped(new Set());
      setPolicy('skip');
      setReplace(false);
      setError(undefined);

      if (loaded.kind === 'backup') {
        setBackup({ data: loaded.backup, fileName: loaded.fileName });
        setTable(null);
        setCandidates(loaded.backup.candidates);
        setNotice(source === 'backup' ? undefined : 'That file is a Flight Log backup, so we read it as one.');
        setStep('review');
        return;
      }

      const a = analyzeSheet(loaded.sheet);
      const t: TableState = { sheet: loaded.sheet, fileName: loaded.fileName, xlsx: loaded.xlsx, ...a };
      setBackup(null);
      setTable(t);
      if (source === 'backup') {
        setNotice('That looks like a spreadsheet rather than a backup, so we’ll map its columns.');
        setStep('mapping');
        return;
      }
      if (a.format === 'fr24' && mappingIsComplete(a.mapping)) {
        setNotice(source === 'generic' ? 'Flightradar24 format detected — columns matched automatically.' : undefined);
        setCandidates(candidatesFromSheet(loaded.sheet, a.mapping, { source: 'fr24', dateOrder: a.dateOrder }));
        setStep('review');
        return;
      }
      setNotice(
        source === 'fr24'
          ? 'This doesn’t look like a Flightradar24 export, so please check how its columns map.'
          : undefined,
      );
      setStep('mapping');
    },
    [source],
  );

  // ---- mapping confirmed
  const applyMapping = useCallback(
    (mapping: ColumnMapping, dateOrder: DateOrder) => {
      if (!table) return;
      const next = { ...table, mapping, dateOrder };
      setTable(next);
      setCandidates(candidatesFromSheet(table.sheet, mapping, { source: table.format === 'fr24' ? 'fr24' : 'csv', dateOrder }));
      setSkipped(new Set());
      setStep('review');
    },
    [table],
  );

  const fixRow = useCallback(
    (key: string, fix: CandidateFix) => {
      setCandidates((list) => list.map((c) => (c.key === key ? fixCandidate(c, fix, table?.dateOrder) : c)));
    },
    [table?.dateOrder],
  );

  const toggleSkip = useCallback((key: string) => {
    setSkipped((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }, []);

  const setAllSkipped = useCallback((keys: string[], skip: boolean) => {
    setSkipped((s) => {
      const n = new Set(s);
      for (const k of keys) skip ? n.add(k) : n.delete(k);
      return n;
    });
  }, []);

  // ---- run
  const runImport = useCallback(async () => {
    const plan = planImport({ candidates, duplicates, skipped, policy });
    setProgress({ done: 0, total: plan.add.length + plan.update.length });
    setStep('importing');
    setError(undefined);
    try {
      const started = Date.now();
      const result = await commitImport(plan, {
        replace: isBackup && replace,
        settings: isBackup && restoreSettings ? backup?.data.settings : undefined,
        onProgress: (d, total) => setProgress({ done: d, total }),
      });
      await wait(Math.max(0, 900 - (Date.now() - started)));
      void requestPersistentStorage();
      const imported = [...plan.add, ...plan.update.map((u) => u.flight)];
      const airports = new Set<string>();
      let km = 0;
      for (const f of imported) {
        airports.add(f.from);
        airports.add(f.to);
        km += flightDistanceKm(f) ?? 0;
      }
      const years = imported.map((f) => Number(f.date.slice(0, 4))).filter(Boolean);
      setDone({
        result,
        summary: {
          flights: result.added + result.updated,
          airports: airports.size,
          km,
          firstYear: years.length ? Math.min(...years) : undefined,
          lastYear: years.length ? Math.max(...years) : undefined,
          skippedDuplicates: plan.skippedDuplicates,
          skippedRows: plan.skippedRows,
        },
      });
      setStep('done');
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Something went wrong while saving.');
      setStep('review');
    }
  }, [candidates, duplicates, skipped, policy, isBackup, replace, restoreSettings, backup]);

  const back = () => {
    if (step === 'review') setStep(table && !isBackup ? 'mapping' : 'source');
    else if (step === 'mapping') setStep('source');
  };

  // Android Back steps back through the wizard instead of abandoning a reviewed file.
  useBackDismiss(step === 'mapping' || step === 'review', back);

  const steps = ['Choose', ...(table && !isBackup ? ['Columns'] : []), 'Review', 'Import'];
  const currentIdx = step === 'source' ? 0 : step === 'mapping' ? 1 : step === 'review' ? steps.length - 2 : steps.length - 1;

  return (
    <div className="import animate-in">
      {step !== 'done' && (
        <header className="import__header">
          {step === 'mapping' || step === 'review' ? (
            <button type="button" className="btn btn--ghost btn--icon import__back" onClick={back} aria-label="Back">
              <Icon name="back" size={22} />
            </button>
          ) : null}
          <div className="import__heading">
            <h1 className="page-title">{step === 'mapping' ? 'Match columns' : step === 'review' ? 'Review' : step === 'importing' ? 'Importing' : 'Import flights'}</h1>
            <p className="page-subtitle">
              {step === 'source' && 'Bring your history in from Flightradar24, a spreadsheet or a backup.'}
              {step === 'mapping' && 'Tell us which column is which. We’ve made our best guess.'}
              {step === 'review' && 'Check everything looks right before it’s saved.'}
              {step === 'importing' && 'Saving to this device…'}
            </p>
          </div>
          <ol className="import__steps" aria-label={`Step ${currentIdx + 1} of ${steps.length}: ${steps[currentIdx]}`}>
            {steps.map((s, i) => (
              <li key={s} className={i === currentIdx ? 'is-current' : i < currentIdx ? 'is-done' : ''} title={s} />
            ))}
          </ol>
        </header>
      )}

      {step === 'source' && <SourceStep source={source} onSource={setSource} onLoaded={handleLoaded} ready={refReady} initialError={error} />}

      {step === 'mapping' && table && (
        <MappingStep sheet={table.sheet} initialMapping={table.mapping} initialDateOrder={table.dateOrder} notice={notice} onContinue={applyMapping} />
      )}

      {step === 'importing' && <ProgressView done={progress.done} total={progress.total} />}

      {step === 'review' && (
        <ReviewStep
          candidates={candidates}
          duplicates={duplicates}
          skipped={skipped}
          policy={policy}
          onPolicy={setPolicy}
          onFix={fixRow}
          onToggleSkip={toggleSkip}
          onSetSkipped={setAllSkipped}
          onImport={runImport}
          notice={notice}
          error={error}
          fileName={table?.fileName ?? backup?.fileName}
          formatLabel={backup ? 'Flight Log backup' : table?.format === 'fr24' ? 'Flightradar24 export' : table?.xlsx ? 'Excel spreadsheet' : 'Spreadsheet'}
          onChangeColumns={table && !isBackup ? () => setStep('mapping') : undefined}
          backup={backup ? { data: backup.data, replace, onReplace: setReplace, restoreSettings, onRestoreSettings: setRestoreSettings, currentCount: existing?.length ?? 0 } : undefined}
        />
      )}

      {step === 'done' && done && <DoneStep summary={done.summary} result={done.result} unit={settings.distanceUnit} onAgain={reset} />}
    </div>
  );
}
