import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Sheet } from './Sheet';

export interface SheetSection<T> {
  title: string;
  items: T[];
}

export interface CustomOption {
  label: ReactNode;
  onPick: () => void;
}

/**
 * Full-screen search picker implementing the combobox + listbox pattern:
 * autofocused input, ranked results, arrow-key navigation, Enter to pick, Escape to close.
 * With an empty query it shows `sections` (e.g. "Recent & frequent").
 */
export function SearchSheet<T>({
  open,
  title,
  placeholder,
  onClose,
  onSelect,
  search,
  sections,
  getKey,
  renderItem,
  selectedKey,
  custom,
  emptyHint,
  inputMode = 'search',
  autoCapitalize = 'off',
}: {
  open: boolean;
  title: string;
  placeholder: string;
  onClose: () => void;
  onSelect: (item: T) => void;
  search: (q: string) => T[];
  sections?: SheetSection<T>[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  selectedKey?: string;
  custom?: (q: string, results: T[]) => CustomOption | undefined;
  emptyHint?: ReactNode;
  inputMode?: 'search' | 'text';
  autoCapitalize?: 'off' | 'characters' | 'words';
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const results = useMemo(() => (deferred.trim() ? search(deferred) : []), [deferred, search]);
  const customOpt = deferred.trim() && custom ? custom(deferred.trim(), results) : undefined;
  const groups: SheetSection<T>[] = deferred.trim() ? [{ title: '', items: results }] : (sections ?? []).filter((s) => s.items.length);
  const flat = groups.flatMap((g) => g.items);
  const count = flat.length + (customOpt ? 1 : 0);

  useEffect(() => setActive(0), [deferred]);

  // Keep the active option in view during keyboard navigation.
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (i: number) => {
    if (i < flat.length) onSelect(flat[i]);
    else customOpt?.onPick();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (count ? (a + 1) % count : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (count ? (a - 1 + count) % count : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (count) pick(Math.min(active, count - 1));
    }
  };

  const optId = (i: number) => `${id}-opt-${i}`;
  let index = -1;

  return (
    <Sheet open={open} onClose={onClose} labelledBy={`${id}-title`} initialFocus={inputRef} className="search-sheet">
      <div className="search-sheet__head">
        <div className="search-sheet__bar">
          <h2 id={`${id}-title`} className="search-sheet__title">
            {title}
          </h2>
          <button type="button" className="btn btn--ghost search-sheet__cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
        <label className="search-sheet__field">
          <Icon name="search" size={18} className="search-sheet__icon" />
          <span className="visually-hidden">{title}</span>
          <input
            ref={inputRef}
            className="search-sheet__input"
            type="search"
            role="combobox"
            aria-expanded={count > 0}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={count ? optId(Math.min(active, count - 1)) : undefined}
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            inputMode={inputMode}
            autoCapitalize={autoCapitalize}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          {query && (
            <button type="button" className="search-sheet__clear" aria-label="Clear search" onClick={() => (setQuery(''), inputRef.current?.focus())}>
              <Icon name="close" size={16} strokeWidth={2.25} />
            </button>
          )}
        </label>
      </div>

      <div ref={listRef} id={`${id}-list`} role="listbox" aria-label={title} className="search-sheet__list">
        {groups.map((g, gi) => (
          <div key={g.title || gi} role="group" aria-label={g.title || 'Results'} className="search-sheet__group">
            {g.title && (
              <div className="search-sheet__group-title" aria-hidden="true">
                {g.title}
              </div>
            )}
            {g.items.map((item) => {
              index++;
              const i = index;
              const key = getKey(item);
              return (
                <div
                  key={`${g.title}-${key}`}
                  id={optId(i)}
                  data-index={i}
                  role="option"
                  aria-selected={key === selectedKey}
                  className={`search-opt${i === active ? ' is-active' : ''}${key === selectedKey ? ' is-selected' : ''}`}
                  onPointerMove={() => setActive(i)}
                  onClick={() => pick(i)}
                >
                  {renderItem(item)}
                  {key === selectedKey && <Icon name="check" size={18} className="search-opt__check" strokeWidth={2.25} />}
                </div>
              );
            })}
          </div>
        ))}
        {customOpt && (
          <div
            id={optId(flat.length)}
            data-index={flat.length}
            role="option"
            aria-selected={false}
            className={`search-opt search-opt--custom${active === flat.length ? ' is-active' : ''}`}
            onPointerMove={() => setActive(flat.length)}
            onClick={() => customOpt.onPick()}
          >
            <span className="search-opt__plus" aria-hidden="true">
              <Icon name="plus" size={18} />
            </span>
            <span className="search-opt__main">{customOpt.label}</span>
          </div>
        )}
        {!count && <div className="search-sheet__empty">{deferred.trim() ? `No matches for “${deferred.trim()}”` : emptyHint}</div>}
      </div>
    </Sheet>
  );
}
