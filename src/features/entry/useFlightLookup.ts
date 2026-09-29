import { useEffect, useRef, useState } from 'react';
import { parseFlightNumber } from '@/lib/flight-utils';
import type { Flight, Settings } from '@/lib/types';
import { lookupFlight, type LookupOutcome } from '@/services/lookup';

export interface LookupState {
  loading: boolean;
  outcome: LookupOutcome | null;
}

/**
 * Debounced flight lookup. Cancels stale requests; `onOutcome` fires once per completed
 * lookup (never for aborted ones).
 */
export function useFlightLookup(opts: {
  enabled: boolean;
  flightNumber: string;
  date: string;
  settings: Pick<Settings, 'enableAdsbdb' | 'aeroDataBoxKey'>;
  flights: readonly Flight[] | undefined;
  excludeId?: string;
  onOutcome: (o: LookupOutcome) => void;
  delayMs?: number;
}): LookupState {
  const { enabled, flightNumber, date, settings, flights, excludeId, delayMs = 550 } = opts;
  const [state, setState] = useState<LookupState>({ loading: false, outcome: null });
  const onOutcome = useRef(opts.onOutcome);
  onOutcome.current = opts.onOutcome;
  const flightsRef = useRef(flights);
  flightsRef.current = flights;
  const flightsReady = flights !== undefined;

  const valid = enabled && !!parseFlightNumber(flightNumber);
  const key = valid ? `${flightNumber.replace(/\s+/g, '').toUpperCase()}|${date}` : '';

  useEffect(() => {
    if (!key || !flightsReady) {
      setState((s) => (s.loading || s.outcome ? { loading: false, outcome: null } : s));
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      lookupFlight({ flightNumber, date }, { settings, flights: flightsRef.current, excludeId, signal: ctrl.signal })
        .then((outcome) => {
          if (ctrl.signal.aborted) return;
          setState({ loading: false, outcome });
          onOutcome.current(outcome);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setState({ loading: false, outcome: null });
        });
    }, delayMs);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // flightNumber/date are captured through `key`.
  }, [key, flightsReady, settings.enableAdsbdb, settings.aeroDataBoxKey, excludeId, delayMs]);

  return state;
}
