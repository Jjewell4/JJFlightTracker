/** A few one-off glyphs that aren't in the shared icon set (same 24px / 1.75 stroke style). */
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export function LockGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

export function SheetGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5V20" />
    </svg>
  );
}

export function BackupGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M12 3.5v11M8 10.5l4 4 4-4" />
      <path d="M4.5 15v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15" />
    </svg>
  );
}

export function RadarGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12 18 6.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
