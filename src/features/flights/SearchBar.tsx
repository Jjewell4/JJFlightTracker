import { forwardRef } from 'react';
import { Icon } from '@/components/Icon';
import type { FilterOption, FilterOptions, FlightFilters } from './flight-logic';

interface ChipSelectProps {
  label: string;
  anyLabel: string;
  value: string | undefined;
  options: FilterOption[];
  onChange: (v: string | undefined) => void;
  /** Label shown on the chip when a value is selected (defaults to the option label). */
  short?: (o: FilterOption) => string;
}

/** A pill that opens the native picker (great on iOS/Android) via an invisible <select>. */
function ChipSelect({ label, anyLabel, value, options, onChange, short }: ChipSelectProps) {
  const selected = options.find((o) => o.value === value);
  if (options.length < 2 && !selected) return null;
  return (
    <label className="chip fchip" aria-pressed={selected ? 'true' : 'false'}>
      <span className="fchip__text">{selected ? (short ? short(selected) : selected.label) : label}</span>
      <svg className="fchip__caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <select className="fchip__select" aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{anyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} ({o.count})
          </option>
        ))}
      </select>
    </label>
  );
}

interface Props {
  query: string;
  onQuery: (q: string) => void;
  filters: FlightFilters;
  onFilters: (f: FlightFilters) => void;
  options: FilterOptions;
}

export const SearchBar = forwardRef<HTMLDivElement, Props>(function SearchBar({ query, onQuery, filters, onFilters, options }, ref) {
  const set = (patch: Partial<FlightFilters>) => onFilters({ ...filters, ...patch });
  const any = Object.values(filters).some(Boolean);
  return (
    <div className="fsearch" ref={ref}>
      <div className="fsearch__box">
        <Icon name="search" size={18} className="fsearch__icon" />
        <input
          className="fsearch__input"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Search flights, airports, airlines…"
          aria-label="Search flights"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onQuery('');
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        {query && (
          <button type="button" className="fsearch__clear" onClick={() => onQuery('')} aria-label="Clear search">
            <Icon name="close" size={14} strokeWidth={2.25} />
          </button>
        )}
      </div>
      <div className="fsearch__chips" role="group" aria-label="Filters">
        <ChipSelect label="Year" anyLabel="All years" value={filters.year} options={options.years} onChange={(year) => set({ year })} />
        <ChipSelect label="Airline" anyLabel="All airlines" value={filters.airline} options={options.airlines} onChange={(airline) => set({ airline })} />
        <ChipSelect
          label="Airport"
          anyLabel="All airports"
          value={filters.airport}
          options={options.airports}
          onChange={(airport) => set({ airport })}
          short={(o) => o.label.split(' · ')[0]}
        />
        <ChipSelect label="Class" anyLabel="Any class" value={filters.cabin} options={options.cabins} onChange={(cabin) => set({ cabin: cabin as FlightFilters['cabin'] })} />
        <ChipSelect label="Reason" anyLabel="Any reason" value={filters.reason} options={options.reasons} onChange={(reason) => set({ reason: reason as FlightFilters['reason'] })} />
        {any && (
          <button type="button" className="chip fchip fchip--clear" onClick={() => onFilters({})}>
            <Icon name="close" size={12} strokeWidth={2.25} />
            Clear
          </button>
        )}
      </div>
    </div>
  );
});
