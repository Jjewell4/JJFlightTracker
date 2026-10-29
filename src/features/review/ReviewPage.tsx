import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useReferenceReady } from '@/data/reference';
import { useFlights, useSettings } from '@/lib/db';
import type { ImportDraft } from '@/lib/types';
import { dismissDraft, useDrafts } from '@/services/screenshot/drafts';
import { DraftPanel, SavedNotice, type SavedLegs } from './DraftPanel';
import { draftDetail, draftHeadline } from './draft-summary';
import './review.css';

/** /review (every draft) and /review/:id (one draft: pick its flights and save them). */
export default function ReviewPage() {
  const { id } = useParams();
  const drafts = useDrafts();
  const flights = useFlights();
  const { clock } = useSettings();
  const ready = useReferenceReady();
  const navigate = useNavigate();
  const location = useLocation();
  const [saved, setSaved] = useState<SavedLegs | null>(null);

  const goBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(id ? '/review' : '/', { replace: true });
  };

  const header = (
    <header className="review__header">
      <button type="button" className="review__back" onClick={goBack} aria-label="Back">
        <Icon name="back" size={22} />
      </button>
      <h1 className="review__title">To review</h1>
    </header>
  );

  if (!drafts || !ready) {
    return (
      <div className="review" aria-busy="true">
        {header}
        <div className="skeleton" style={{ height: 160, borderRadius: 'var(--radius-lg)' }} />
      </div>
    );
  }

  if (id) {
    const draft = drafts.find((d) => d.id === id);
    return (
      <div className="review">
        {header}
        {saved ? (
          <div className="card review__panel">
            <SavedNotice
              result={saved}
              onDone={() => {
                setSaved(null);
                if (!drafts.some((d) => d.id === id)) goBack();
              }}
            />
          </div>
        ) : draft ? (
          <>
            <div className="card review__panel">
              <DraftPanel
                draft={draft}
                flights={flights}
                clock={clock}
                onEdit={(c) => navigate(`/flights/new?draft=${encodeURIComponent(draft.id)}&leg=${c.index}`)}
                onSaved={setSaved}
              />
            </div>
            {draft.status !== 'failed' && (
              <button
                type="button"
                className="btn btn--ghost btn--block review__discard"
                onClick={() => {
                  void dismissDraft(draft.id);
                  goBack();
                }}
              >
                <Icon name="trash" size={18} /> {draft.status === 'reading' ? 'Stop and discard' : 'Discard the rest'}
              </button>
            )}
          </>
        ) : (
          <div className="empty">
            <Icon name="check" size={32} />
            <p className="empty__title">All done</p>
            <p>Everything from this screenshot is saved or discarded.</p>
            <Link to="/review" className="btn btn--primary">
              Back to To review
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="review">
      {header}
      <p className="review__lead">Screenshots being read or waiting for you to save their flights. They stay on this device until you’re done.</p>
      {drafts.length === 0 ? (
        <div className="empty">
          <Icon name="scan" size={32} />
          <p className="empty__title">Nothing to review</p>
          <p>Scan a booking or boarding pass screenshot from Log a flight.</p>
          <Link to="/flights/new" className="btn btn--primary">
            Log a flight
          </Link>
        </div>
      ) : (
        <ul className="review__list">
          {drafts.map((d) => (
            <li key={d.id}>
              <DraftCard draft={d} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DraftCard({ draft }: { draft: ImportDraft }) {
  return (
    <Link to={`/review/${draft.id}`} className="card card--interactive review__card">
      {draft.thumb ? (
        <img className="review__thumb" src={draft.thumb} alt="" />
      ) : (
        <span className="review__thumb review__thumb--icon" aria-hidden="true">
          <Icon name="scan" size={22} />
        </span>
      )}
      <span className="review__text">
        <span className="review__name">{draftHeadline(draft)}</span>
        <span className={`review__meta${draft.status === 'failed' ? ' review__meta--warn' : ''}`}>
          {draft.status === 'reading' && <span className="spinner" aria-hidden="true" />}
          {draftDetail(draft)}
        </span>
      </span>
      <Icon name="chevron" size={18} className="review__chevron" />
    </Link>
  );
}
