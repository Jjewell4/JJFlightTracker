import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Bottom sheet on phones, centered dialog on wide screens. Closes on scrim tap / Escape,
 * moves focus inside while open and restores it on close.
 */
export function Sheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const first = panel.current?.querySelector<HTMLElement>('button, a[href]');
    first?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="sheet" role="presentation" onClick={onClose}>
      <div className="sheet__panel" role="dialog" aria-modal="true" aria-label={label} ref={panel} onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" aria-hidden />
        {children}
      </div>
    </div>,
    document.body,
  );
}
