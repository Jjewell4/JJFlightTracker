import type { ReactNode } from 'react';
import { useCountUp } from './hooks';

/** Number that counts up the first time it scrolls into view. */
export function CountUp({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const [ref, v] = useCountUp<HTMLSpanElement>(value);
  return (
    <span ref={ref} className={className} aria-label={format(value)}>
      <span aria-hidden>{format(v)}</span>
    </span>
  );
}

export function Section({ id, title, children, className }: { id: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`stats-section ${className ?? ''}`} aria-labelledby={`stats-${id}`}>
      <h2 id={`stats-${id}`} className="section-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function CardHead({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <header className="stats-card__head">
      <div className="stats-card__titles">
        <h3 className="stats-card__title">{title}</h3>
        {subtitle && <p className="stats-card__subtitle">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg stats-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className="seg__opt" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
