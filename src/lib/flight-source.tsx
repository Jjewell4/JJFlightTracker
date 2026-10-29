/**
 * Where a screen's flights come from.
 *
 * The Map and Stats screens read their data through `useFlightSource()` instead of
 * talking to IndexedDB directly, so the same screens can render:
 *
 * - the signed-in owner's local log (the default — `withFlightSource` wraps a screen in
 *   `LocalFlightSource` when nothing else provides a source), and
 * - a public journal (or the owner's preview of it), which supplies an already-projected,
 *   read-only list of flights through `<FlightSourceProvider>`.
 *
 * `fields` says which optional flight fields the source can contain, so screens hide
 * sections that would otherwise render empty ("0 window seats") for public data.
 */
import { createContext, useContext, useMemo, type ComponentType, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFlights, useSettings } from './db';
import type { Flight, Settings } from './types';

/** Optional flight fields a source may carry. */
export interface FlightFields {
  /** Departure/arrival times and recorded durations. */
  times: boolean;
  cabin: boolean;
  /** Seat type / seat number. */
  seat: boolean;
  reason: boolean;
  /** Tail numbers. */
  registration: boolean;
  flightNumber: boolean;
  /** Day-precision dates (day-of-week patterns, busiest day). */
  exactDates: boolean;
}

/** The owner's own log can contain every field. */
export const ALL_FIELDS: FlightFields = {
  times: true,
  cabin: true,
  seat: true,
  reason: true,
  registration: true,
  flightNumber: true,
  exactDates: true,
};

/** Minimal search-param style view state (e.g. `year`) owned by the hosting page. */
export interface ViewParams {
  get(key: string): string | null;
  set(key: string, value: string | null): void;
}

export interface FlightSource {
  /** Every flight in the source (upcoming ones included); undefined while loading. */
  flights: Flight[] | undefined;
  /**
   * Read-only, visitor-facing view of someone's journal: no editing calls to action and
   * never a link to a flight's detail page or into the owner's app.
   */
  readOnly: boolean;
  unit: Settings['distanceUnit'];
  clock: Settings['clock'];
  /** ISO country code of "home"; '' when unknown (public journals). */
  homeCountry: string;
  fields: FlightFields;
  params: ViewParams;
  /** Lets a hosting page show a filtered flight list (e.g. from a map airport card). */
  showFlights?: (filter: { airport?: string; year?: number | null }) => void;
}

const SourceContext = createContext<FlightSource | null>(null);

export function FlightSourceProvider({ value, children }: { value: FlightSource; children: ReactNode }) {
  return <SourceContext.Provider value={value}>{children}</SourceContext.Provider>;
}

/** The surrounding flight source. Screens wrapped with `withFlightSource` always have one. */
export function useFlightSource(): FlightSource {
  const source = useContext(SourceContext);
  if (!source) throw new Error('useFlightSource() needs a FlightSourceProvider or withFlightSource()');
  return source;
}

/** The owner's local IndexedDB log; view state lives in the router's search params. */
export function LocalFlightSource({ children }: { children: ReactNode }) {
  const flights = useFlights();
  const settings = useSettings();
  const [search, setSearch] = useSearchParams();
  const params = useMemo<ViewParams>(
    () => ({
      get: (key) => search.get(key),
      set: (key, value) =>
        setSearch(
          (p) => {
            const next = new URLSearchParams(p);
            if (value === null) next.delete(key);
            else next.set(key, value);
            return next;
          },
          { replace: true },
        ),
    }),
    [search, setSearch],
  );
  const value = useMemo<FlightSource>(
    () => ({
      flights,
      readOnly: false,
      unit: settings.distanceUnit,
      clock: settings.clock,
      homeCountry: settings.homeCountry,
      fields: ALL_FIELDS,
      params,
    }),
    [flights, settings.distanceUnit, settings.clock, settings.homeCountry, params],
  );
  return <FlightSourceProvider value={value}>{children}</FlightSourceProvider>;
}

/**
 * Wraps a screen so it reads the surrounding source, falling back to the local log.
 * The owner's routes render screens bare, so their behaviour is unchanged.
 */
export function withFlightSource<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  function Sourced(props: P) {
    const provided = useContext(SourceContext);
    if (provided) return <Screen {...props} />;
    return (
      <LocalFlightSource>
        <Screen {...props} />
      </LocalFlightSource>
    );
  }
  Sourced.displayName = `withFlightSource(${Screen.displayName || Screen.name || 'Screen'})`;
  return Sourced;
}
