/** Tiny fetch wrapper: timeout + external cancellation, typed failures, never hangs. */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type HttpFailure = 'timeout' | 'network' | 'aborted';

export class HttpError extends Error {
  constructor(public readonly kind: HttpFailure) {
    super(kind);
  }
}

export interface JsonResponse {
  status: number;
  /** Parsed body, or null for empty (e.g. 204) / non-JSON bodies. */
  data: unknown;
}

export const DEFAULT_TIMEOUT_MS = 6000;

export async function fetchJson(
  url: string,
  opts: { headers?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number; fetchImpl?: FetchLike } = {},
): Promise<JsonResponse> {
  const { headers, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const doFetch = opts.fetchImpl ?? (globalThis.fetch?.bind(globalThis) as FetchLike | undefined);
  if (!doFetch) throw new HttpError('network');
  if (signal?.aborted) throw new HttpError('aborted');

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await doFetch(url, { headers, signal: ctrl.signal });
    let data: unknown = null;
    if (res.status !== 204) {
      const text = await res.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
    }
    return { status: res.status, data };
  } catch {
    if (timedOut) throw new HttpError('timeout');
    if (signal?.aborted || ctrl.signal.aborted) throw new HttpError('aborted');
    throw new HttpError('network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
