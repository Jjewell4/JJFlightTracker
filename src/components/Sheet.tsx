import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { useBackDismiss } from './useBackDismiss';
import { useKeyboardInset } from './useKeyboardInset';
import './Sheet.css';

const EXIT_MS = 240;

/**
 * The app's one modal sheet: a bottom action sheet (`variant="bottom"`, default) or a
 * full-screen picker on phones (`variant="full"`); a centered card on wide screens.
 * Handles portal, scrim, Escape, Android Back, focus trap, scroll lock and focus
 * restore, and stays mounted briefly to animate out.
 */
export function Sheet({
  open,
  onClose,
  label,
  labelledBy,
  variant = 'bottom',
  initialFocus,
  dismissible = true,
  role = 'dialog',
  children,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  label?: string;
  labelledBy?: string;
  variant?: 'full' | 'bottom';
  initialFocus?: RefObject<HTMLElement | null>;
  /** False while busy: scrim, Escape and Back do nothing. */
  dismissible?: boolean;
  role?: 'dialog' | 'alertdialog';
  children: ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissRef = useRef(dismissible);
  dismissRef.current = dismissible;
  const requestClose = () => {
    if (dismissRef.current) onCloseRef.current();
  };

  useBackDismiss(open, requestClose);
  useKeyboardInset(open && mounted && variant === 'bottom', rootRef);

  // Mount/unmount with exit animation.
  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement | null;
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = setTimeout(() => {
      setMounted(false);
      setClosing(false);
      const el = restoreRef.current;
      if (el && document.contains(el)) el.focus({ preventScroll: true });
    }, EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);

  // Escape (window-level so it works wherever focus is).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Initial focus + scroll lock while open.
  useLayoutEffect(() => {
    if (!open || !mounted) return;
    const target = initialFocus?.current ?? panelRef.current;
    target?.focus({ preventScroll: true });
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open, mounted, initialFocus]);

  if (!mounted) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const focusables = [...panelRef.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div ref={rootRef} className={`sheet sheet--${variant}${closing ? ' is-closing' : ''} ${className}`} onKeyDown={onKeyDown}>
      <div className="sheet__scrim" onClick={requestClose} aria-hidden="true" />
      <div ref={panelRef} className="sheet__panel" role={role} aria-modal="true" aria-label={label} aria-labelledby={labelledBy} tabIndex={-1}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Confirmation sheet (delete, replace…). Optionally requires typing a word before the
 * confirm button enables, for the truly destructive actions.
 */
export function ConfirmSheet({
  open,
  title,
  message,
  children,
  icon,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger,
  requireText,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  children?: ReactNode;
  icon?: IconName;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** When set, the user must type this word before the confirm button enables. */
  requireText?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);
  const ok = !requireText || typed.trim().toUpperCase() === requireText.toUpperCase();

  return (
    <Sheet
      open={open}
      onClose={onCancel}
      variant="bottom"
      role="alertdialog"
      labelledBy={`${id}-t`}
      initialFocus={requireText ? inputRef : cancelRef}
      dismissible={!busy}
    >
      <div className="confirm">
        {icon && (
          <span className={`confirm__icon${danger ? '' : ' confirm__icon--muted'}`} aria-hidden>
            <Icon name={icon} size={22} />
          </span>
        )}
        <h2 id={`${id}-t`} className="confirm__title">
          {title}
        </h2>
        {(message || children) && <div className="confirm__body">{message ?? children}</div>}
        {requireText && (
          <label className="field confirm__field">
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
              enterKeyHint="done"
              placeholder={requireText}
            />
          </label>
        )}
        <div className="confirm__actions">
          <button ref={cancelRef} type="button" className="btn btn--lg" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className={`btn btn--lg ${danger ? 'btn--danger-solid' : 'btn--primary'}`} onClick={onConfirm} disabled={!ok || busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
