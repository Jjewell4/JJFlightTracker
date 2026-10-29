import type { MouseEvent, ReactNode } from 'react';
import type { ParamPatch } from './journal-state';

/** Moves between journal views. `href` is undefined in the owner's in-app preview. */
export interface JournalNav {
  go(patch: ParamPatch): void;
  href(patch: ParamPatch): string | undefined;
}

/**
 * A real link on the public page (deep-linkable, opens in a new tab with a modifier key)
 * and a plain button in the in-app preview, which must never navigate the Settings screen.
 */
export function JournalLink({
  nav,
  to,
  current,
  className,
  children,
  label,
}: {
  nav: JournalNav;
  to: ParamPatch;
  current?: boolean;
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  const href = nav.href(to);
  if (href === undefined)
    return (
      <button type="button" className={className} aria-pressed={current === undefined ? undefined : current} aria-label={label} onClick={() => nav.go(to)}>
        {children}
      </button>
    );
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    nav.go(to);
  };
  return (
    <a href={href} className={className} aria-current={current ? 'page' : undefined} aria-label={label} onClick={onClick}>
      {children}
    </a>
  );
}
