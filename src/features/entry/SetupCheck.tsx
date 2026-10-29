import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { checkScreenshotSetup, type ScreenshotSetupStatus } from '@/services/screenshot/client';
import './ScreenshotImport.css';

const MARK = { ok: '✓', bad: '✗', na: '–' } as const;
const MARK_LABEL = { ok: 'OK', bad: 'Problem', na: 'Not checked' } as const;

/** "Check setup": runs the server diagnostics and lists each check (✓ / ✗ / –) with what to fix. */
export function SetupCheck() {
  const id = useId();
  const [status, setStatus] = useState<ScreenshotSetupStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const run = async () => {
    setChecking(true);
    try {
      setStatus(await checkScreenshotSetup());
    } catch {
      setStatus({ ready: false, checks: [{ id: 'network', label: 'Server reachable', ok: false, detail: 'Couldn’t run the check. Retry in a moment.' }] });
    } finally {
      setChecking(false);
    }
  };
  // Bring the checklist into view inside the (scrollable) sheet once it arrives.
  useEffect(() => {
    if (status)
      panel.current?.scrollIntoView?.({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [status]);
  return (
    <div className="ss-setup">
      <button type="button" className="btn btn--block" onClick={() => void run()} disabled={checking}>
        {checking ? <span className="spinner" aria-hidden="true" /> : <Icon name="settings" size={18} />}
        {checking ? 'Checking setup…' : status ? 'Check again' : 'Check setup'}
      </button>
      {status && (
        <div ref={panel} className="ss-setup__panel" role="status" aria-labelledby={`${id}-sum`}>
          <p id={`${id}-sum`} className={`ss-setup__summary${status.ready ? ' is-ready' : ''}`}>
            {status.ready ? 'Everything looks ready — try again.' : 'Fix the items marked ✗, redeploy, then check again.'}
          </p>
          <ul className="ss-checks">
            {status.checks.map((c) => {
              const kind = c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'na';
              return (
                <li key={c.id} className={`ss-check ss-check--${kind}`}>
                  <span className="ss-check__mark" role="img" aria-label={MARK_LABEL[kind]}>
                    {MARK[kind]}
                  </span>
                  <span className="ss-check__text">
                    <span className="ss-check__label">{c.label}</span>
                    {c.detail && <span className="ss-check__detail">{c.detail}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {status.model && <p className="ss-note">Model: {status.model}</p>}
        </div>
      )}
    </div>
  );
}
