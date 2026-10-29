/**
 * The app mark. Phones get the detailed artwork (dotted map under the wing), which reads well at
 * header size there; the desktop sidebar keeps the simplified one that matches the favicon.
 */
const BASE = import.meta.env.BASE_URL;
const DETAILED = `${BASE}icons/mark.svg`;
const SIMPLE = `${BASE}favicon.svg`;
/** Same breakpoint as the sidebar layout. */
const DESKTOP = '(min-width: 960px)';

export function BrandMark({ size, variant = 'auto', className = 'brand-mark' }: { size: number; variant?: 'auto' | 'detailed' | 'simple'; className?: string }) {
  if (variant !== 'auto')
    return <img className={className} src={variant === 'simple' ? SIMPLE : DETAILED} width={size} height={size} alt="" />;
  return (
    <picture style={{ display: 'contents' }}>
      <source media={DESKTOP} srcSet={SIMPLE} />
      <img className={className} src={DETAILED} width={size} height={size} alt="" />
    </picture>
  );
}
