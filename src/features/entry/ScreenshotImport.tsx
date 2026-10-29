import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { useFlights } from '@/lib/db';
import { ScreenshotError, type ScreenshotErrorCode } from '@/services/screenshot/client';
import { cancelDraft, dismissDraft, MAX_BATCH, startScreenshotDraft, useDraft } from '@/services/screenshot/drafts';
import { useCloudSync } from '@/services/sync/controller';
import { DraftPanel, SavedNotice, type SavedLegs } from '@/features/review/DraftPanel';
import { ReviewBanner } from '@/features/review/ReviewBanner';
import type { FormValues } from './form-model';
import './ScreenshotImport.css';

/** A leg of a screenshot draft (so saving the form can mark it done in To review). */
export interface DraftLegRef {
  draftId: string;
  index: number;
}

/**
 * "Scan screenshot" bottom sheet. Choosing an image creates a draft that is read in the
 * background: the sheet shows its progress, but closing it doesn't cancel anything — the result
 * waits in To review. Once read, flights can be saved straight away (several at once, optionally
 * as a trip) or one can fill the form for editing. Choosing several images reads them all.
 */
export function ScreenshotImport({
  open,
  onClose,
  onApply,
  clock,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (values: Partial<FormValues>, from: DraftLegRef) => void;
  clock: '12h' | '24h';
}) {
  const sync = useCloudSync();
  const flights = useFlights();
  const titleId = useId();
  const [draftId, setDraftId] = useState<string | null>(null);
  const draft = useDraft(draftId);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<{ code: ScreenshotErrorCode; message: string } | null>(null);
  /** Number of screenshots started together (they're reviewed from To review). */
  const [batch, setBatch] = useState(0);
  const [saved, setSaved] = useState<SavedLegs | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const chooseRef = useRef<HTMLButtonElement | null>(null);
  const generation = useRef(0);

  // The draft was finished or discarded elsewhere (To review): back to the start.
  useEffect(() => {
    if (draftId && draft === null && !saved) setDraftId(null);
  }, [draftId, draft, saved]);

  const reset = () => {
    generation.current++;
    setDraftId(null);
    setError(null);
    setBatch(0);
    setSaved(null);
    setPreparing(false);
  };

  const choose = async (files: File[]) => {
    if (!files.length) return;
    reset();
    const current = generation.current;
    setPreparing(true);
    try {
      const picked = files.slice(0, MAX_BATCH);
      const ids: string[] = [];
      for (const file of picked) {
        try {
          ids.push(await startScreenshotDraft(file));
        } catch (e) {
          if (picked.length === 1) throw e; // in a batch, unusable images are skipped
        }
      }
      if (generation.current !== current) return;
      if (ids.length === 1) setDraftId(ids[0]);
      else if (ids.length > 1) setBatch(ids.length);
      else throw new ScreenshotError('image', 'None of these images could be opened. Try PNG or JPEG screenshots.');
    } catch (e) {
      if (generation.current !== current) return;
      setError({ code: e instanceof ScreenshotError ? e.code : 'image', message: e instanceof Error && e.message ? e.message : 'Could not open this image.' });
    } finally {
      if (generation.current === current) setPreparing(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const pick = () => fileInput.current?.click();
  const pickAnother = () => {
    if (draft && draft.status === 'failed') void dismissDraft(draft.id);
    reset();
    pick();
  };
  const cancel = () => {
    if (draftId) void cancelDraft(draftId);
    reset();
  };

  const signedIn = sync.phase === 'signed-in';
  const idle = !saved && !batch && !preparing && !error && !draftId;

  return (
    <Sheet open={open} onClose={onClose} labelledBy={titleId} initialFocus={signedIn && idle ? chooseRef : undefined} className="entry-sheet assist-sheet">
      <div className="assist">
        <div className="assist__head">
          <span className="assist__badge" aria-hidden="true">
            <Icon name="scan" size={20} />
          </span>
          <div className="assist__titles">
            <h2 id={titleId} className="assist__title">
              Scan a screenshot
            </h2>
            <p className="assist__sub">Booking, boarding pass or status page</p>
          </div>
          <button type="button" className="assist__close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>

        {!signedIn ? (
          sync.phase === 'loading' ? (
            <p className="ss-status" role="status">
              <span className="spinner" aria-hidden="true" /> Checking your account…
            </p>
          ) : (
            <div className="ss-signin">
              <p className="ss-signin__title">Sign in to scan screenshots</p>
              <p className="ss-note">
                Reading a screenshot uses your Window Seat account, which keeps imports private and within your daily limit. Manual entry always works, even
                offline.
              </p>
              <div className="assist__actions">
                <button type="button" className="btn btn--lg" onClick={onClose}>
                  Not now
                </button>
                <Link to="/account" className="btn btn--primary btn--lg" onClick={onClose}>
                  <Icon name="user" size={18} /> Sign in
                </Link>
              </div>
            </div>
          )
        ) : (
          <>
            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              accept="image/*"
              multiple
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => void choose([...(e.target.files ?? [])])}
            />

            {saved ? (
              <SavedNotice
                result={saved}
                onLeave={onClose}
                onDone={() => {
                  reset();
                  onClose();
                }}
                onAnother={() => {
                  reset();
                  pick();
                }}
              />
            ) : batch ? (
              <div className="dsaved" role="status">
                <span className="dsaved__icon" aria-hidden="true">
                  <Icon name="scan" size={24} />
                </span>
                <p className="dsaved__title">Reading {batch} screenshots</p>
                <p className="dsaved__sub">They’re read in the background and wait for you in To review.</p>
                <div className="dsaved__actions">
                  <Link to="/review" className="btn btn--lg btn--primary" onClick={onClose}>
                    Open To review
                  </Link>
                  <button
                    type="button"
                    className="btn btn--lg"
                    onClick={() => {
                      reset();
                      onClose();
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : preparing ? (
              <p className="ss-status" role="status">
                <span className="spinner" aria-hidden="true" /> Preparing image…
              </p>
            ) : error ? (
              <>
                <div className="ss-error" role="alert">
                  <Icon name="warning" size={18} />
                  <p>{error.message}</p>
                </div>
                <button type="button" className="btn btn--primary btn--lg btn--block" onClick={pickAnother}>
                  Choose another
                </button>
              </>
            ) : draft ? (
              <DraftPanel
                draft={draft}
                flights={flights}
                clock={clock}
                onEdit={(c) => onApply(c.values, { draftId: draft.id, index: c.index })}
                onSaved={setSaved}
                onChooseAnother={pickAnother}
                onBackground={onClose}
                onCancel={cancel}
              />
            ) : draftId ? (
              <p className="ss-status" role="status">
                <span className="spinner" aria-hidden="true" /> Loading…
              </p>
            ) : (
              <>
                <button ref={chooseRef} type="button" className="ss-choose" onClick={pick}>
                  <span className="ss-choose__icon" aria-hidden="true">
                    <Icon name="image" size={24} />
                  </span>
                  <span className="ss-choose__title">Choose screenshots</span>
                  <span className="ss-choose__hint">One or several · read in the background</span>
                </button>
                <PrivacyNote />
                <ReviewBanner compact />
              </>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function PrivacyNote({ compact }: { compact?: boolean }) {
  return (
    <p className={`ss-privacy${compact ? ' ss-privacy--compact' : ''}`}>
      <Icon name="shield" size={16} />
      <span>
        Your screenshot is sent to Google Gemini to read the flight details. Crop out booking codes and personal details first. The image stays on this device
        until it’s read and isn’t saved in your journal.
      </span>
    </p>
  );
}
