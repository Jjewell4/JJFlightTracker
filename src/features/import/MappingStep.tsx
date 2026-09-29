import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  FIELD_LABELS,
  MAPPING_FIELDS,
  cellText,
  detectDateOrder,
  mappingIsComplete,
  type ColumnMapping,
  type DateOrder,
  type MappingField,
  type Sheet,
} from '@/services/import';

interface Props {
  sheet: Sheet;
  initialMapping: ColumnMapping;
  initialDateOrder: DateOrder;
  notice?: string;
  onContinue: (mapping: ColumnMapping, dateOrder: DateOrder) => void;
}

const REQUIRED: MappingField[] = ['date', 'from', 'to'];
const OPTIONAL: MappingField[] = MAPPING_FIELDS.filter((f) => !REQUIRED.includes(f) && f !== 'route');

export function MappingStep({ sheet, initialMapping, initialDateOrder, notice, onContinue }: Props) {
  const [mapping, setMapping] = useState<ColumnMapping>(initialMapping);
  const [dateOrder, setDateOrder] = useState<DateOrder>(initialDateOrder);
  const [showAll, setShowAll] = useState(false);
  const [routeMode, setRouteMode] = useState(initialMapping.route !== undefined && initialMapping.route >= 0);

  const sample = sheet.rows.find((r) => r.some((c) => cellText(c))) ?? [];
  const complete = mappingIsComplete(mapping);
  const dateCol = mapping.date;
  const slashDates = useMemo(
    () => dateCol !== undefined && dateCol >= 0 && sheet.rows.slice(0, 60).some((r) => /^\s*\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(cellText(r[dateCol]))),
    [sheet, dateCol],
  );
  const evidence = useMemo(() => (dateCol !== undefined && dateCol >= 0 ? detectDateOrder(sheet.rows.map((r) => r[dateCol])) : 'mdy'), [sheet, dateCol]);

  const set = (field: MappingField, value: string) => setMapping((m) => ({ ...m, [field]: value === '' ? undefined : Number(value) }));

  const row = (field: MappingField) => {
    const idx = mapping[field];
    const meta = FIELD_LABELS[field];
    const example = idx !== undefined && idx >= 0 ? cellText(sample[idx]) : '';
    const missing = (REQUIRED.includes(field) || field === 'route') && (idx === undefined || idx < 0);
    return (
      <label key={field} className="mapping__row">
        <span className="mapping__label">
          {meta.label}
          {REQUIRED.includes(field) && <span className="mapping__req"> *</span>}
        </span>
        <select className="input" value={idx ?? ''} onChange={(e) => set(field, e.target.value)} aria-invalid={missing}>
          <option value="">{REQUIRED.includes(field) ? 'Choose a column…' : 'Not in my file'}</option>
          {sheet.headers.map((h, i) => (
            <option key={i} value={i}>
              {h}
            </option>
          ))}
        </select>
        <span className="mapping__example">{example ? `e.g. ${example.length > 44 ? `${example.slice(0, 44)}…` : example}` : (meta.hint ?? '')}</span>
      </label>
    );
  };

  const optionalShown = showAll ? OPTIONAL : OPTIONAL.filter((f) => mapping[f] !== undefined && mapping[f]! >= 0);

  return (
    <div className="stack">
      {notice && (
        <div className="import__notice">
          <Icon name="info" size={18} />
          <span>{notice}</span>
        </div>
      )}
      <p className="import__hint">
        Found <strong>{sheet.rows.length.toLocaleString()}</strong> rows{sheet.sheetName ? <> in “{sheet.sheetName}”</> : null}. Fields marked * are required.
      </p>

      <section className="stack" style={{ gap: 'var(--space-3)' }}>
        <h2 className="section-title" style={{ margin: 0 }}>Required</h2>
        <div className="mapping card card--flush">
          {row('date')}
          {routeMode ? row('route') : (<>{row('from')}{row('to')}</>)}
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setMapping((m) => (routeMode ? { ...m, route: undefined } : { ...m, from: undefined, to: undefined, route: m.route ?? 0 }));
            setRouteMode(!routeMode);
          }}
        >
          {routeMode ? 'Use separate From and To columns' : 'My file has one route column (e.g. SAN-LAX)'}
        </button>
      </section>

      {slashDates && (
        <section className="stack" style={{ gap: 'var(--space-2)' }}>
          <h2 className="section-title" style={{ margin: 0 }}>Date format</h2>
          <div className="seg" role="group" aria-label="Date order">
            <button type="button" className="seg__opt" aria-pressed={dateOrder === 'mdy'} onClick={() => setDateOrder('mdy')}>
              Month / Day / Year
            </button>
            <button type="button" className="seg__opt" aria-pressed={dateOrder === 'dmy'} onClick={() => setDateOrder('dmy')}>
              Day / Month / Year
            </button>
          </div>
          {evidence !== dateOrder && <p className="field__hint">Your dates look {evidence === 'dmy' ? 'day-first' : 'month-first'}.</p>}
        </section>
      )}

      <section className="stack" style={{ gap: 'var(--space-3)' }}>
        <h2 className="section-title" style={{ margin: 0 }}>Optional</h2>
        <div className="mapping card card--flush">{optionalShown.map(row)}</div>
        {!showAll && optionalShown.length < OPTIONAL.length && (
          <button type="button" className="btn btn--ghost" onClick={() => setShowAll(true)}>
            Show all {OPTIONAL.length} optional fields
          </button>
        )}
      </section>

      <div className="import__bar">
        <button type="button" className="btn btn--primary btn--lg btn--block" disabled={!complete} onClick={() => onContinue(mapping, dateOrder)}>
          Continue to review
        </button>
      </div>
    </div>
  );
}
