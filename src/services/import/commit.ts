/** Turning reviewed candidates into a plan, and writing that plan to the database. */
import { db, saveSettings } from '@/lib/db';
import type { Flight, Settings } from '@/lib/types';
import { candidateStatus, type ImportCandidate, type ImportFlight } from './candidates';

export type DuplicatePolicy = 'skip' | 'update';

export interface ImportPlan {
  add: ImportFlight[];
  update: { id: string; flight: ImportFlight }[];
  /** Duplicates left untouched. */
  skippedDuplicates: number;
  /** Rows the user skipped or that still have errors. */
  skippedRows: number;
}

export function planImport(opts: {
  candidates: ImportCandidate[];
  /** candidate key → existing flight id. */
  duplicates: Map<string, string>;
  /** candidate keys the user chose to skip. */
  skipped: Set<string>;
  policy: DuplicatePolicy;
}): ImportPlan {
  const plan: ImportPlan = { add: [], update: [], skippedDuplicates: 0, skippedRows: 0 };
  for (const c of opts.candidates) {
    if (opts.skipped.has(c.key) || candidateStatus(c) === 'error') {
      plan.skippedRows++;
      continue;
    }
    const dupId = opts.duplicates.get(c.key);
    if (dupId) {
      if (opts.policy === 'update') plan.update.push({ id: dupId, flight: c.flight });
      else plan.skippedDuplicates++;
    } else {
      plan.add.push(c.flight);
    }
  }
  return plan;
}

export interface ImportResult {
  added: number;
  updated: number;
  /** Flights removed first (replace mode). */
  removed: number;
  settingsRestored: boolean;
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')) as T;
}

function toFlight(f: ImportFlight, index: number, now: number): Flight {
  return compact({ ...f, id: f.id ?? newId(), createdAt: f.createdAt ?? now + index, updatedAt: f.updatedAt ?? now + index }) as Flight;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export interface CommitOptions {
  /** Delete every existing flight first (backup "replace"). */
  replace?: boolean;
  /** Settings to restore alongside (backup only). */
  settings?: Partial<Settings>;
  onProgress?: (done: number, total: number) => void;
  chunkSize?: number;
}

/** Writes the plan to IndexedDB in chunks, reporting progress. */
export async function commitImport(plan: ImportPlan, opts: CommitOptions = {}): Promise<ImportResult> {
  const now = Date.now();
  const total = plan.add.length + plan.update.length;
  const chunk = opts.chunkSize ?? 40;
  let done = 0;
  const report = () => opts.onProgress?.(done, total);
  report();

  let removed = 0;
  // Never wipe the log for an empty (or entirely unreadable) backup.
  if (opts.replace && plan.add.length === 0) throw new Error('Nothing to restore — your log was left unchanged.');
  if (opts.replace) {
    // One transaction: never leave the log half-replaced.
    const flights = plan.add.map((f, i) => toFlight(f, i, now));
    removed = await db.transaction('rw', db.flights, async () => {
      const n = await db.flights.count();
      await db.flights.clear();
      await db.flights.bulkPut(flights);
      return n;
    });
    done = total;
    report();
  } else {
    for (let i = 0; i < plan.add.length; i += chunk) {
      const flights = plan.add.slice(i, i + chunk).map((f, j) => toFlight(f, i + j, now));
      await db.flights.bulkPut(flights);
      done += flights.length;
      report();
      await tick();
    }
    for (let i = 0; i < plan.update.length; i += chunk) {
      const part = plan.update.slice(i, i + chunk);
      const existing = await db.flights.bulkGet(part.map((u) => u.id));
      const merged: Flight[] = [];
      part.forEach((u, j) => {
        const old = existing[j];
        if (!old) return;
        const incoming = compact({ ...u.flight }) as Partial<Flight>;
        merged.push(
          compact({ ...old, ...incoming, id: old.id, createdAt: old.createdAt, source: old.source, updatedAt: now + i + j }) as Flight,
        );
      });
      await db.flights.bulkPut(merged);
      done += part.length;
      report();
      await tick();
    }
  }

  let settingsRestored = false;
  if (opts.settings && Object.keys(opts.settings).length) {
    await saveSettings(opts.settings);
    settingsRestored = true;
  }
  return { added: plan.add.length, updated: plan.update.length, removed, settingsRestored };
}
