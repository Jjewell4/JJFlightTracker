# TODO: Log flights by forwarding confirmation emails (Cloudflare)

Status: **planned, not started.** Owner decision: use Cloudflare Email Routing + an Email Worker.

## Goal

Forward an airline/OTA confirmation email to a private address (e.g.
`flights-<secret>@<your-domain>`) and the flights show up in an in-app **"To review"** inbox.
Nothing is saved to the log until the user confirms each flight (same review flow as screenshot
import). Never save guessed dates or routes directly from an email.

## Cost (checked Oct 2026 — re-verify before building)

- Cloudflare Email Routing (inbound): free, unlimited. Email Workers run on the Workers free tier.
  Large messages (> 25 MiB) unsupported. <https://developers.cloudflare.com/email-service/platform/pricing/>
- Domain on Cloudflare DNS: ~$10/year if one isn't already available.
- Gemini extraction: well under $0.01 per email with the existing `GEMINI_API_KEY`.
- Alternatives considered: Postmark inbound (~$16.50–18/mo paid tiers), Resend receiving (pricing
  for received mail unclear). Not needed if Cloudflare works.

## What the user sets up (~15 min)

1. Add a domain to Cloudflare (or use an existing one) and enable **Email Routing**.
2. Create a catch-all or `flights-*` route → **Send to a Worker** → the worker below.
3. Add Worker secrets: `INBOUND_SHARED_SECRET` (random, also set in Vercel) and the Vercel URL.
4. Vercel env: `INBOUND_SHARED_SECRET`; Supabase: run the new `supabase/email-inbox.sql`.
5. In the app: More → Email import → copy your personal forwarding address.

## Architecture

```
mail → Cloudflare Email Routing → Email Worker (parse MIME, verify, forward JSON)
     → POST https://<app>/api/inbound-email  (HMAC-signed with INBOUND_SHARED_SECRET)
     → Vercel function: verify signature → look up user by address token → Gemini extract
     → insert pending legs into Supabase `email_inbox` (per user, RLS)
App: "To review" inbox (badge) → open item → choose flights → fills the normal flight form → Save
```

### Cloudflare Email Worker (`workers/email-inbound/`, new)
- `email(message, env)` handler; parse with `postal-mime`.
- Reject unless SPF/DKIM pass for the `From` domain (Cloudflare exposes auth results in headers).
- Extract: recipient local part token, From address, Subject, text body (fallback: HTML → text),
  Date. Drop attachments except small PDFs (optional, phase 2).
- Truncate body to ~60 KB; POST JSON with `X-Signature: HMAC-SHA256(body, secret)` and a
  timestamp header (reject > 5 min skew to prevent replay).
- Idempotency: send `Message-ID`; server dedupes.

### Server (`api/inbound-email.ts` + `server/email.ts`, new)
- Verify HMAC + timestamp; 401 otherwise. No user session involved (machine-to-machine).
- Map address token → user via Supabase `email_addresses` table (service role key needed
  server-side only for this lookup/insert — new secret `SUPABASE_SERVICE_ROLE_KEY`, never exposed
  to the browser; or a SECURITY DEFINER RPC callable with the anon key + shared secret).
- Sender check: From must equal the account email or an allowed forwarding address the user added.
- Per-user quota (reuse the screenshot quota pattern: 30/day, 300/month) and idempotency on
  Message-ID.
- Gemini: text prompt reusing the screenshot schema (up to 6 segments, explicit years only,
  airport codes, times, flight numbers, booking ref ignored). Treat email as untrusted data; never
  follow instructions in it.
- Insert `{ user_id, received_at, subject, from, legs jsonb, warnings jsonb, status: 'pending' }`.
  Don't store the raw email body (privacy); store only extracted legs + subject.

### Supabase (`supabase/email-inbox.sql`, new, re-runnable)
- `email_addresses(user_id, token unique, created_at, revoked_at)` — one active token per user,
  rotatable.
- `email_inbox(id, user_id, received_at, message_id unique per user, subject, sender, legs, warnings,
  status pending|done|dismissed)` with RLS: owner can select/update status/delete own rows.
- RPC `email_inbox_insert(...)` SECURITY DEFINER, only callable by the server (check shared secret
  or restrict to service role).

### App

> Since this plan was written, screenshot imports gained a **To review** inbox
> (`src/features/review/`, device-only drafts in Dexie). Email items should land in the same
> inbox: fetch pending `email_inbox` rows for signed-in users, map them to `ImportDraft`-shaped
> items (`source: 'email'`), and reuse `DraftPanel`/`saveLegs` for multi-leg + "save as a trip".
- Settings → **Email import**: show/copy personal address, rotate token, list allowed senders,
  setup status (like the screenshot "Check setup").
- **To review** inbox: entry point on Home (small badge card only when items are pending) and in
  Log. Each item lists extracted legs; "Use this flight" opens the flight form prefilled (reuse
  `screenshotValues`-style mapping + duplicate warning). Mark done / dismiss.
- Sync: inbox items come from Supabase directly (signed-in only); flights saved normally.

## Tests to write
- Worker: MIME fixtures (United, Delta, Alaska, Southwest, Expedia, forwarded-from-Gmail),
  signature creation.
- Server: HMAC/timestamp rejection, unknown token, sender mismatch, quota, idempotency,
  Gemini failure mapping (reuse `describeGeminiFailure`), no raw-body persistence.
- SQL: PGlite tests for RLS and token uniqueness (pattern from `quota.test.ts`).
- App: inbox rendering, apply-to-form, dismiss.

## Open questions
- Which domain to use (user to provide).
- Support PDFs (e-tickets) in phase 2? Gemini can read PDFs directly.
- Auto-detect cancellations/schedule changes ("your flight time changed") → update existing
  flight instead of adding? Phase 2.
