import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import './Sheet.css';

const EXIT_MS = 240;

/**
 * Modal sheet: full-screen on phones (`variant="full"`) or a bottom action sheet
 * (`variant="bottom"`); centered card on wide screens. Handles portal, scrim, Escape,
 * focus trap, scroll lock and focus restore. Stays mounted briefly to animate out.
 */
export function Sheet({
  open,
  onClose,
  label,
  labelledBy,
  variant = 'full',
  initialFocus,
  children,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  label?: string;
  labelledBy?: string;
  variant?: 'full' | 'bottom';
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
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
    <div className={`sheet sheet--${variant}${closing ? ' is-closing' : ''} ${className}`} onKeyDown={onKeyDown}>
      <div className="sheet__scrim" onClick={() => onCloseRef.current()} aria-hidden="true" />
      <div ref={panelRef} className="sheet__panel" role="dialog" aria-modal="true" aria-label={label} aria-labelledby={labelledBy} tabIndex={-1}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmation action sheet (e.g. delete). */
export function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  danger,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Sheet open={open} onClose={onCancel} variant="bottom" labelledBy={`${id}-t`} initialFocus={cancelRef}>
      <div className="confirm">
        <h2 id={`${id}-t`} className="confirm__title">
          {title}
        </h2>
        {message && <p className="confirm__msg">{message}</p>}
        <div className="confirm__actions">
          <button type="button" className={`btn btn--lg btn--block ${danger ? 'btn--danger-solid' : 'btn--primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button ref={cancelRef} type="button" className="btn btn--lg btn--block" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </Sheet>
  );
}
