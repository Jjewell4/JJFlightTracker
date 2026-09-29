import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** When set, the user must type this word before the confirm button enables. */
  requireText?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Bottom sheet on phones, centered dialog on wide screens. */
export function ConfirmSheet({ open, title, children, confirmLabel, danger, requireText, busy, onConfirm, onCancel }: Props) {
  const [typed, setTyped] = useState('');
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTyped('');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open, busy, onCancel]);

  if (!open) return null;
  const ok = !requireText || typed.trim().toUpperCase() === requireText.toUpperCase();

  return (
    <div className="sheet-scrim" onClick={() => !busy && onCancel()}>
      <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grab" aria-hidden />
        <h2 id={titleId} className="sheet__title">
          {title}
        </h2>
        <div className="sheet__body">{children}</div>
        {requireText && (
          <label className="field">
            <span className="field__label">
              Type <span className="code">{requireText}</span> to confirm
            </span>
            <input
              ref={inputRef}
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              placeholder={requireText}
            />
          </label>
        )}
        <div className="sheet__actions">
          <button type="button" className="btn btn--lg" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`btn btn--lg ${danger ? 'btn--danger-solid' : 'btn--primary'}`} onClick={onConfirm} disabled={!ok || busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
