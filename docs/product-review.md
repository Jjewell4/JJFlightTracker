# Flight Log product review

## Findings and changes

- Home was a long archive with a summary card. It now provides lifetime totals,
  an offline route-network preview, return/repeat actions, upcoming flights and
  five recent flights. The full searchable log has its own route and bounded
  pagination; expanded batches survive navigation to a flight and back.
- Stats exposed all sections without navigation. Section shortcuts now jump to
  patterns, records, favorites and places. Repeated distance/duration records
  for the same flight were removed in the preceding change.
- Direct flight entry crashed in Chromium because an effect returned the result
  of `scrollTo`, which can be a Promise. The effect now returns nothing; tests
  simulate that browser behavior. Browser checks create and save a flight.
- Quick entry accepts explicit airport codes, an ISO date and an optional flight
  number. Invalid or ambiguous input stays in the editor. Filled fields remain
  reviewable; nothing saves automatically.
- General CSV/Excel is the default import path. Portable CSV export uses readable
  columns and enum names; FR24 compatibility remains separately available.
  Formula-like text is escaped for spreadsheet safety. JSON is still the
  lossless backup, including metadata not representable in generic CSV.
- Password authentication replaces email OTP login. Existing account IDs are
  preserved. Signup, recovery and password changes are implemented. Actual
  project configuration and email delivery require deployment validation.
- Static shell resources revalidate; hashed bundles cache immutably. Updates are
  checked on startup/foreground/reconnect and periodically. Activation remains
  explicit so editing work is not silently lost. Offline versions cannot update
  until a connection is available.

## Validation

Vitest covers domain logic, forms, sync, password API wrappers, password sign-in
UI, quick-entry parsing, CSV round-trip and formula escaping. `scripts/smoke.mjs`
checks actual browser rendering at 390, 768 and 1440 pixels, creates a flight,
opens the archive and downloads CSV. The production build generates a service
worker. A separate local release simulation verified that a changed worker
produces an update prompt, activates on request and serves the app offline.

Light-theme mobile and desktop screenshots, plus the dark desktop overview, were inspected during this pass.
These checks do not establish live Supabase auth, Vercel response headers,
external lookup services or native iOS install behavior.

## Remaining integration work

Inbound email cannot be delivered to a static app. A future implementation needs
an inbound provider/webhook, verified provider signatures, per-account routing,
idempotency, attachment limits, and a review inbox for extracted flight legs.
Do not save guessed dates or routes directly from an email. The current quick
entry is explicit text entry, not an email parser.

Before release, configure Supabase's recovery redirect allowlist and production
SMTP. Existing signed-in users can set a password immediately; signed-out users
can recover their existing account. Confirmation and recovery remain subject to
email-service limits even though normal password login sends no email.

## Independent Sol review of public sharing

A separate GPT-6.1 Sol agent reviewed the implementation and exercised the UI.
Four findings were addressed and then rechecked by that agent at 390px:

1. Retry owner-profile loading after an error, so a transient failure does not
   permanently hide publishing/unpublishing controls.
2. Show unpublish errors inside the confirmation dialog; do not claim successful
   revocation until the request succeeds.
3. Show cities alongside airport codes; search city/airport names, airlines and
   formatted dates; supply an accessible “from … to …” route label.
4. Make the exact-date privacy control at least 44px tall for touch use.

The revised distance story replaces decorative planet tiles with compact
comparisons and a next-milestone track. Percentages round consistently (e.g.
2.078 lunar distances displays 2.08× and 8%, rather than 2.08× and 7%).
Window Seat branding now uses the favicon artwork in the app header/sidebar,
onboarding and public journal; existing storage and backup identifiers remain
unchanged for compatibility.

## Live journals and mobile follow-up

Public snapshots have been replaced by a live privacy-filtered query of synced
flights. Visitor pages poll while visible and refresh on reconnection/foreground.
The mobile bar now provides Home, Log, Map, Stats and More; Add flight is explicit
in the Log header. The Home upload controls were removed. The map keeps the dot
style with stronger contrast and tighter framing. The distance comparison returns
to the original Earth-to-Moon arc, using real land-mask detail and compact
milestone information rather than separate planet tiles.
