import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import type { FormValues } from './form-model';
import { parseQuickEntry } from './quick-entry';

/** "Quick entry" bottom sheet: type a route + ISO date (+ flight number) to fill the form. */
export function QuickEntry({
  open,
  onClose,
  onApply,
  dirty,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (values: Partial<FormValues>) => void;
  /** The form already has edits: say what will be replaced. */
  dirty: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (open) setError(false);
  }, [open]);

  const submit = () => {
    const values = parseQuickEntry(text);
    if (!values) {
      setError(true);
      inputRef.current?.focus();
      return;
    }
    onApply(values);
    setText('');
  };

  return (
    <Sheet open={open} onClose={onClose} labelledBy={`${id}-t`} initialFocus={inputRef} className="entry-sheet assist-sheet">
      <form
        className="assist"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation(); // the sheet is portaled, but React events still bubble to the page
          submit();
        }}
        noValidate
      >
        <div className="assist__head">
          <span className="assist__badge" aria-hidden="true">
            <Icon name="keyboard" size={20} />
          </span>
          <div className="assist__titles">
            <h2 id={`${id}-t`} className="assist__title">
              Quick entry
            </h2>
            <p className="assist__sub">Type a route and date to fill the form</p>
          </div>
          <button type="button" className="assist__close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>

        <label className="field">
          <span className="field__label">Route, date and optional flight number</span>
          <input
            ref={inputRef}
            className="input qe-input"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(false);
            }}
            placeholder="SAN → LAX 2026-11-15 UA123"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            aria-invalid={error}
            aria-describedby={`${id}-help${error ? ` ${id}-err` : ''}`}
          />
        </label>
        <p id={`${id}-help`} className="qe-help">
          Two airport codes and a YYYY-MM-DD date, e.g. <span className="code">SAN-LAX 2026-11-15 UA123</span>
        </p>
        {error && (
          <p id={`${id}-err`} role="alert" className="field__error">
            Use two known airport codes, a valid YYYY-MM-DD date, and an optional flight number.
          </p>
        )}
        {dirty && <p className="qe-help qe-help--warn">Replaces the route, date and flight number already in the form.</p>}

        <div className="assist__actions">
          <button type="button" className="btn btn--lg" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary btn--lg" disabled={!text.trim()}>
            Fill flight details
          </button>
        </div>
      </form>
    </Sheet>
  );
}
