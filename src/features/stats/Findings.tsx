import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import type { Finding } from '@/lib/insights';
import { airlineHref, airportHref } from '@/features/explore/links';
import { TrendBars } from './charts/TrendBars';
import { Section } from './parts';

const INITIAL = 6;

function href(link: Finding['link']): string | undefined {
  if (!link) return undefined;
  if (link.trip) return `/trips/${encodeURIComponent(link.trip)}`;
  if (link.airline) return airlineHref(link.airline);
  if (link.airport) return airportHref(link.airport);
  if (link.occasion) return `/?occasion=${link.occasion}`;
  return undefined;
}

/**
 * Insights: the quick highlights row, then findings about how categories differ and how the log
 * changes over time — strongest first, each with its evidence.
 */
export function InsightsSection({ highlights, findings, readOnly }: { highlights: React.ReactNode; findings: Finding[]; readOnly: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? findings : findings.slice(0, INITIAL);
  return (
    <Section id="insights" title="Insights">
      {highlights}
      {shown.length > 0 && (
        <ul className="stats-findings">
          {shown.map((f, n) => (
            <li key={f.id} className="stats-finding card animate-in" style={{ animationDelay: `${80 + n * 50}ms` }}>
              <FindingBody finding={f} readOnly={readOnly} />
            </li>
          ))}
        </ul>
      )}
      {findings.length > INITIAL && (
        <button type="button" className="stats-rank__more" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show ${findings.length - INITIAL} more`}
          <Icon name="chevron" size={16} className={all ? 'is-open' : undefined} />
        </button>
      )}
    </Section>
  );
}

function FindingBody({ finding: f, readOnly }: { finding: Finding; readOnly: boolean }) {
  const to = readOnly ? undefined : href(f.link);
  const max = f.visual ? Math.max(...f.visual.items.map((i) => i.value), 0.0001) : 1;
  return (
    <>
      <div className="stats-finding__head">
        <span className={`stats-finding__icon stats-finding__icon--${f.kind}`} aria-hidden>
          <Icon name={f.icon} size={18} />
        </span>
        <div className="stats-finding__text">
          <p className="stats-finding__title">{f.title}</p>
          <p className="stats-finding__detail">{f.detail}</p>
        </div>
      </div>
      {f.visual?.type === 'bars' && (
        <ul className="stats-finding__bars">
          {f.visual.items.map((i) => (
            <li key={i.label}>
              <span className="stats-finding__label">{i.label}</span>
              <span className="stats-finding__track" aria-hidden>
                <span style={{ width: `${Math.max(3, (i.value / max) * 100)}%` }} />
              </span>
              <span className="stats-finding__value">{i.display}</span>
            </li>
          ))}
        </ul>
      )}
      {f.visual?.type === 'series' && (
        <div className="stats-finding__series">
          <TrendBars
            data={f.visual.items.map((i, k) => ({ key: String(k), label: i.label, value: i.value, title: i.display }))}
            formatValue={(v) => f.visual!.items.find((i) => i.value === v)?.display ?? String(Math.round(v))}
            label={f.title}
            height={40}
          />
        </div>
      )}
      {to && (
        <Link to={to} className="stats-finding__link">
          See the {f.link?.trip ? 'trip' : f.link?.airline ? 'airline' : f.link?.airport ? 'airport' : 'flights'} <Icon name="chevron" size={14} />
        </Link>
      )}
    </>
  );
}
