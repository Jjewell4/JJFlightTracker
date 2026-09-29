import { forwardRef } from 'react';
import { Icon } from '@/components/Icon';
import { getAirport } from '@/data/reference';
import { distanceKm, estimateDurationMin } from '@/lib/geo';
import { formatDuration } from '@/lib/time';
import { airportCity, flagEmoji, formatDistance } from './format';

interface EndpointProps {
  role: 'from' | 'to';
  ident: string;
  error?: string;
  filled?: boolean;
  onPick: () => void;
}

const Endpoint = forwardRef<HTMLButtonElement, EndpointProps>(function Endpoint({ role, ident, error, filled, onPick }, ref) {
  const a = getAirport(ident);
  const label = role === 'from' ? 'From' : 'To';
  const code = a ? a.iata || a.ident : ident;
  return (
    <button
      ref={ref}
      type="button"
      className={`route-end route-end--${role}${ident ? '' : ' is-empty'}${error ? ' has-error' : ''}${filled ? ' is-filled' : ''}`}
      onClick={onPick}
      aria-haspopup="dialog"
      aria-invalid={!!error}
      aria-label={a ? `${label}: ${a.name}, ${a.city}. Change` : `${label}: choose airport`}
    >
      <span className="route-end__label">
        {role === 'from' ? <Icon name="takeoff" size={14} /> : <Icon name="landing" size={14} />}
        {label}
        {filled && <Icon name="sparkle" size={12} className="sparkle-icon" />}
      </span>
      <span className="route-end__code">{code || '···'}</span>
      <span className="route-end__city">
        {a ? (
          <>
            {airportCity(a)} <span aria-hidden="true">{flagEmoji(a.country)}</span>
          </>
        ) : ident ? (
          'Unknown airport'
        ) : (
          'Choose airport'
        )}
      </span>
    </button>
  );
});

export function RouteCard({
  from,
  to,
  errors,
  filled,
  unit,
  onPick,
  onSwap,
  fromRef,
  toRef,
}: {
  from: string;
  to: string;
  errors: { from?: string; to?: string };
  filled: { from?: boolean; to?: boolean };
  unit: 'mi' | 'km';
  onPick: (role: 'from' | 'to') => void;
  onSwap: () => void;
  fromRef?: React.Ref<HTMLButtonElement>;
  toRef?: React.Ref<HTMLButtonElement>;
}) {
  const a = getAirport(from);
  const b = getAirport(to);
  const km = a && b && a.ident !== b.ident ? distanceKm(a, b) : undefined;
  const error = errors.from && errors.to && !from && !to ? 'Choose where you flew from and to' : (errors.from ?? errors.to);
  return (
    <section className="entry-card route-card" aria-label="Route">
      <div className="route-card__ends">
        <Endpoint ref={fromRef} role="from" ident={from} error={errors.from} filled={filled.from} onPick={() => onPick('from')} />
        <button type="button" className="route-card__swap" onClick={onSwap} aria-label="Swap departure and arrival" disabled={!from && !to}>
          <Icon name="swap" size={18} className="route-card__swap-icon" />
        </button>
        <Endpoint ref={toRef} role="to" ident={to} error={errors.to} filled={filled.to} onPick={() => onPick('to')} />
      </div>
      <div className={`route-card__meta${km ? ' is-visible' : ''}`} aria-live="polite">
        <span className="route-card__line" aria-hidden="true" />
        {km ? (
          <span className="route-card__stats">
            <Icon name="plane" size={14} className="route-card__plane" />
            <span className="tabular">{formatDistance(km, unit)}</span>
            <span className="route-card__dot" aria-hidden="true">
              ·
            </span>
            <span className="tabular" title="Estimated flight time">
              ~{formatDuration(estimateDurationMin(km))}
            </span>
          </span>
        ) : (
          <span className="route-card__stats route-card__stats--hint">
            <Icon name="plane" size={14} className="route-card__plane" />
            Pick both airports
          </span>
        )}
        <span className="route-card__line" aria-hidden="true" />
      </div>
      {error && (
        <p className="field__error route-card__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
