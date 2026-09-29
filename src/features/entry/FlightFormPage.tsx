import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useReferenceReady } from '@/data/reference';
import { useFlight, useFlights } from '@/lib/db';
import { airportCode } from '@/lib/flight-utils';
import { formatFlightDate } from '@/lib/time';
import type { Flight } from '@/lib/types';
import { FlightForm } from './FlightForm';
import { duplicateValues, emptyValues, flightToValues, nonEmptyGroups, returnValues, type FormValues } from './form-model';
import { getEntryDefaults } from './prefs';
import './FlightFormPage.css';

/**
 * /flights/new (optionally ?return=<id> or ?duplicate=<id>) and /flights/:id/edit.
 * Waits for reference data and the source flight, then mounts a fresh form.
 */
export default function FlightFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const returnId = id ? null : params.get('return');
  const duplicateId = id || returnId ? null : params.get('duplicate');
  const sourceId = id ?? returnId ?? duplicateId ?? undefined;
  const source = useFlight(sourceId);
  const flights = useFlights();
  const ready = useReferenceReady();

  if (!ready || (sourceId && source === undefined)) return <FormSkeleton edit={!!id} />;

  if (id && !source) {
    return (
      <div className="entry">
        <div className="empty">
          <Icon name="warning" size={32} />
          <p className="empty__title">Flight not found</p>
          <p>It may have been deleted.</p>
          <Link to="/" className="btn btn--primary">
            Back to flights
          </Link>
        </div>
      </div>
    );
  }

  const src = source ?? undefined;
  let initial: FormValues;
  let initialEdited: string[] = [];
  let note: string | undefined;
  if (id && src) {
    initial = flightToValues(src);
    initialEdited = [...nonEmptyGroups(initial), ...(initial.seatType ? ['seatType'] : [])];
  } else if (returnId && src) {
    initial = returnValues(src);
    initialEdited = nonEmptyGroups(initial);
    note = `Return of ${describe(src)}`;
  } else if (duplicateId && src) {
    initial = duplicateValues(src);
    initialEdited = [...nonEmptyGroups(initial), ...(initial.seatType ? ['seatType'] : [])];
    note = `Copy of ${describe(src)}`;
  } else {
    initial = emptyValues(getEntryDefaults());
  }

  return (
    <FlightForm
      key={`${id ?? ''}|${returnId ?? ''}|${duplicateId ?? ''}`}
      mode={id ? 'edit' : 'new'}
      initial={initial}
      initialEdited={initialEdited}
      base={id ? src : undefined}
      flights={flights}
      note={note}
    />
  );
}

function describe(f: Flight): string {
  return `${airportCode(f.from)} → ${airportCode(f.to)} · ${formatFlightDate(f.date, f.datePrecision)}`;
}

function FormSkeleton({ edit }: { edit: boolean }) {
  return (
    <div className="entry" aria-busy="true">
      <header className="entry-header">
        <span className="entry-header__btn" />
        <div className="entry-header__titles">
          <h1 className="entry-header__title">{edit ? 'Edit flight' : 'Log a flight'}</h1>
        </div>
        <span className="entry-header__btn" />
      </header>
      <div className="entry-form">
        <div className="skeleton entry-skel" style={{ height: 220 }} />
        <div className="skeleton entry-skel" style={{ height: 150 }} />
        <div className="skeleton entry-skel" style={{ height: 120 }} />
      </div>
    </div>
  );
}
