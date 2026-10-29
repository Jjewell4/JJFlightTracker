/**
 * Window Seat — Cloudflare Email Worker.
 * Paste into a Worker (Cloudflare → Workers & Pages → Create → Hello World → Edit code), then set:
 *   INBOUND_URL            https://windowseat.me/api/inbound-email
 *   INBOUND_SHARED_SECRET  same random value as in Vercel (Secret type)
 * and route flights-*@windowseat.me (or a catch-all) to it under Email → Email Routing → Routes.
 * It forwards each email, signed, to the app; the app reads the flights. No dependencies.
 */
const MAX_BYTES = 3_500_000;

async function sign(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async email(message, env) {
    if (message.rawSize > MAX_BYTES) {
      message.setReject('This email is too large to import. Forward it without attachments.');
      return;
    }
    const raw = await new Response(message.raw).text();
    const body = JSON.stringify({ raw, to: message.to, from: message.from });
    const timestamp = String(Date.now());
    const response = await fetch(env.INBOUND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Timestamp': timestamp, 'X-Signature': await sign(env.INBOUND_SHARED_SECRET, `${timestamp}.${body}`) },
      body,
    });
    const result = await response.json().catch(() => ({}));
    // Tell the sender when their email can't be used, so it doesn't vanish silently.
    if (['unknown-address', 'sender-not-allowed', 'limit'].includes(result.outcome)) message.setReject(result.message || 'This email could not be imported.');
    else if (!response.ok) message.setReject(result.error || 'Window Seat couldn’t process this email right now. Please try again later.');
  },
};
