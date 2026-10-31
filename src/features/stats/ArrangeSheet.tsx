import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { Switch } from '@/components/Switch';
import { saveSettings } from '@/lib/db';
import type { StatsLayout } from '@/lib/types';
import { savePublicLayout } from '@/features/public/api';
import { useCloudSync } from '@/services/sync/controller';
import { moveItem, resolveLayout, sectionTitle, toLayout, type StatsSectionId } from './layout';

type Item = { id: StatsSectionId; hidden: boolean };

/**
 * Arrange the Stats tab: drag a section by its handle (or use the arrows), switch sections off.
 * Changes apply as you go; the public journal picks them up when the sheet closes.
 */
export function ArrangeSheet({ open, layout, onClose }: { open: boolean; layout: StatsLayout | undefined; onClose: () => void }) {
  const sync = useCloudSync();
  const [items, setItems] = useState<Item[]>(() => resolveLayout(layout));
  const changed = useRef(false);
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number; rowH: number; startY: number } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Fresh from the saved layout each time the sheet opens.
  useEffect(() => {
    if (open) {
      setItems(resolveLayout(layout));
      changed.current = false;
    }
  }, [open]);

  const commit = (next: Item[]) => {
    setItems(next);
    changed.current = true;
    void saveSettings({ statsLayout: toLayout(next) });
  };

  const close = () => {
    // Visitors see the same arrangement (silently skipped when not published or offline).
    if (changed.current && sync.userId) void savePublicLayout(sync.userId, toLayout(items)).catch(() => {});
    onClose();
  };

  const onDown = (e: PointerEvent<HTMLButtonElement>, index: number) => {
    const row = (e.currentTarget.closest('li') as HTMLElement | null)?.getBoundingClientRect();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ from: index, to: index, dy: 0, rowH: row?.height || 56, startY: e.clientY });
  };
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    const to = Math.max(0, Math.min(items.length - 1, drag.from + Math.round(dy / drag.rowH)));
    setDrag({ ...drag, dy, to });
  };
  const onUp = () => {
    if (!drag) return;
    if (drag.to !== drag.from) commit(moveItem(items, drag.from, drag.to));
    setDrag(null);
  };

  // While dragging, rows between the start and the drop point step aside by one row.
  const offset = (i: number) => {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.rowH;
    if (drag.from > drag.to && i < drag.from && i >= drag.to) return drag.rowH;
    return 0;
  };

  return (
    <Sheet open={open} onClose={close} label="Arrange stats">
      <div className="sheet__title">Arrange your stats</div>
      <p className="arrange__lead">Drag to reorder, or switch a section off. Your public journal shows the same layout.</p>
      <ol ref={listRef} className={`arrange${drag ? ' is-dragging' : ''}`}>
        {items.map((item, i) => {
          const title = sectionTitle(item.id);
          return (
            <li
              key={item.id}
              className={`arrange__row${drag?.from === i ? ' is-lifted' : ''}${item.hidden ? ' is-off' : ''}`}
              style={offset(i) ? { transform: `translateY(${offset(i)}px)` } : undefined}
            >
              <button
                type="button"
                className="arrange__grip"
                aria-label={`Drag to move ${title}`}
                onPointerDown={(e) => onDown(e, i)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={() => setDrag(null)}
              >
                <Icon name="grip" size={20} strokeWidth={3} />
              </button>
              <span className="arrange__title">{title}</span>
              <span className="arrange__moves">
                <button type="button" className="arrange__move" aria-label={`Move ${title} up`} disabled={i === 0} onClick={() => commit(moveItem(items, i, i - 1))}>
                  <Icon name="chevronUp" size={18} />
                </button>
                <button type="button" className="arrange__move" aria-label={`Move ${title} down`} disabled={i === items.length - 1} onClick={() => commit(moveItem(items, i, i + 1))}>
                  <Icon name="chevronDown" size={18} />
                </button>
              </span>
              <Switch checked={!item.hidden} onChange={(on) => commit(items.map((x, j) => (j === i ? { ...x, hidden: !on } : x)))} label={`Show ${title}`} />
            </li>
          );
        })}
      </ol>
      <div className="arrange__actions">
        <button type="button" className="btn btn--ghost" onClick={() => commit(resolveLayout(undefined))}>
          Reset to default
        </button>
        <button type="button" className="btn btn--primary" onClick={close}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
