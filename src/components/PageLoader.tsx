/** Route-level Suspense fallback. Appears only if a screen takes a moment to load. */
export function PageLoader() {
  return (
    <div className="page-loader" role="status" aria-busy="true">
      <span className="page-loader__ring" aria-hidden />
      <span className="visually-hidden">Loading…</span>
    </div>
  );
}
