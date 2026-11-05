/** Turning reviewed candidates into a plan, and writing that plan to the database. */
import { db, saveSettings, writeFlights } from '@/lib/db';
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

/** Imported flights count as edited now, so a restore wins over older copies in the cloud. */
function toFlight(f: ImportFlight, index: number, now: number): Flight {
  return compact({ ...f, id: f.id ?? newId(), createdAt: f.createdAt ?? now + index, updatedAt: now + index }) as Flight;
}

export interface CommitOptions {
  /** Delete every existing flight first (backup "replace"). */
  replace?: boolean;
  /** Settings to restore alongside (backup only). */
  settings?: Partial<Settings>;
  onProgress?: (done: number, total: number) => void;
  chunkSize?: number;
}

/** Commits one atomic, recoverable import; reports progress before and after the transaction. */
export async function commitImport(plan: ImportPlan, opts: CommitOptions = {}): Promise<ImportResult> {
  if (opts.replace && !plan.add.length) throw new Error('Nothing to restore — your log was left unchanged.');
  const now = Date.now();
  const total = plan.add.length + plan.update.length;
  opts.onProgress?.(0,total);
  const result = await db.transaction('rw',db.flights,db.history,db.kv,db.trips,async () => {
    const before = await db.flights.toArray();
    const byId = new Map(before.map(f => [f.id,f]));
    const added = plan.add.map((f,i) => toFlight(f,i,now));
    const updated = plan.update.flatMap((u,i) => {
      const old = byId.get(u.id); if(!old)return [];
      const incoming = compact({...u.flight});
      const merged = compact({...old,...incoming,id:old.id,createdAt:old.createdAt,source:old.source,updatedAt:Math.max(now+i,old.updatedAt+1)}) as Flight;
      return [merged];
    });
    await writeFlights(opts.replace ? 'Replace from backup' : 'Import spreadsheet', [...added,...updated], opts.replace ? before.map(f=>f.id) : []);
    const settingsRestored = !!opts.settings && Object.keys(opts.settings).length > 0;
    if(settingsRestored) await saveSettings(opts.settings!);
    return {added:added.length,updated:updated.length,removed:opts.replace ? before.length : 0,settingsRestored};
  });
  opts.onProgress?.(total,total);
  return result;
}
