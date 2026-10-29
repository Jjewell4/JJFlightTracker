# Email import (forward booking emails)

Forward an airline or booking confirmation to your personal address
`flights-<token>@windowseat.me` (Settings → Email import) and its flights appear in
**To review**. Nothing is saved until you confirm. Only addresses you allow can forward:
your account email always can; add work and other personal addresses in Settings.

```
mail → Cloudflare Email Routing → Email Worker (workers/email-inbound/worker.js)
     → POST https://windowseat.me/api/inbound-email   (HMAC-signed, INBOUND_SHARED_SECRET)
     → checks sender + daily limit (30) → Gemini reads the flights → Supabase email_inbox
App: pulls email_inbox into To review (on open, on focus, every 2 min); finishing an item
     marks it done so it disappears on every device. The email body is never stored.
```

## Setup

1. **Supabase**: run `supabase/email-import.sql` (safe to re-run).
2. **Vercel** → Settings → Environment Variables (Production), then redeploy:
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API Keys → `service_role`
     (or a new secret key). Server-only: never add a `VITE_` prefix.
   - `INBOUND_SHARED_SECRET` — any long random string (e.g. from a password manager).
   - Check: `https://windowseat.me/api/inbound-email` should show all `true`.
3. **Cloudflare** (windowseat.me):
   - Email → Email Routing → enable (Cloudflare adds the MX/SPF records).
   - Workers & Pages → Create → Worker → paste `workers/email-inbound/worker.js` → Deploy.
     Settings → Variables: `INBOUND_URL` = `https://windowseat.me/api/inbound-email`,
     `INBOUND_SHARED_SECRET` (type Secret) = the same value as in Vercel.
   - Email Routing → Routing rules → Catch-all → Action "Send to a Worker" → that worker.
4. **App**: Settings → Email import → copy your address, add other addresses you forward from.

## Notes

- Mail whose From fails DMARC is refused; unknown senders/addresses are bounced with a reason.
- Emails over ~3.5 MB are refused (forward without attachments). PDFs aren't read yet.
- Cost: Email Routing and Workers are free at this scale; Gemini well under $0.01 per email.
