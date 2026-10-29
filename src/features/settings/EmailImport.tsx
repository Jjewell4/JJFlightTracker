import { useEffect, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { ConfirmSheet } from '@/components/Sheet';
import { addSender, EmailSetupError, getForwardingAddress, listSenders, MAX_SENDERS, removeSender } from '@/services/email/client';
import { useCloudSync } from '@/services/sync/controller';

/**
 * Settings → Email import: your personal forwarding address, and the addresses allowed to
 * forward to it (your account email always is; add work and other personal ones here).
 */
export function EmailImport() {
  const sync = useCloudSync();
  const signedIn = sync.phase === 'signed-in';
  const [address, setAddress] = useState<string | null>(null);
  const [senders, setSenders] = useState<{ account: string; extra: string[] } | null>(null);
  const [setup, setSetup] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    Promise.all([getForwardingAddress(), listSenders()])
      .then(([a, s]) => {
        if (!live) return;
        setAddress(a);
        setSenders(s);
      })
      .catch((e) => live && (e instanceof EmailSetupError ? setSetup(e.message) : setError(e instanceof Error ? e.message : 'Couldn’t load email import.')));
    return () => {
      live = false;
    };
  }, [signedIn]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setSenders(await listSenders());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    void run(async () => {
      await addSender(draft);
      setDraft('');
    });
  };

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the address is selectable */
    }
  };

  const rotate = () =>
    void run(async () => {
      setAddress(await getForwardingAddress(true));
      setConfirmRotate(false);
    });

  return (
    <section className="sgroup" aria-labelledby="email-import-title">
      <h2 id="email-import-title" className="section-title sgroup__title">
        Email import
      </h2>
      <div className="list">
        {!signedIn ? (
          <div className="list__row srow">
            <span className="srow__text">
              <span className="srow__title">Forward booking emails</span>
              <span className="srow__sub">Sign in to get a personal address that turns confirmation emails into flights to review.</span>
            </span>
          </div>
        ) : setup ? (
          <div className="list__row srow">
            <span className="srow__text">
              <span className="srow__title">Not set up yet</span>
              <span className="srow__sub">{setup}</span>
            </span>
          </div>
        ) : (
          <>
            <div className="list__row srow srow--stack">
              <span className="srow__text">
                <span className="srow__title">Your forwarding address</span>
                <span className="srow__sub">Forward airline or booking emails here. The flights appear in To review — nothing is saved until you confirm.</span>
              </span>
              <div className="skey">
                <input className="input email-import__address" value={address ?? 'Loading…'} readOnly aria-label="Your forwarding address" onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="btn" onClick={() => void copy()} disabled={!address}>
                  <Icon name={copied ? 'check' : 'copy'} size={18} /> {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="list__row srow srow--stack">
              <span className="srow__text">
                <span className="srow__title">Forward from</span>
                <span className="srow__sub">Only these addresses can send to your forwarding address. Add your work and other personal emails.</span>
              </span>
              <ul className="email-import__senders">
                {senders?.account && (
                  <li>
                    <span>{senders.account}</span>
                    <span className="email-import__tag">Account</span>
                  </li>
                )}
                {senders?.extra.map((e) => (
                  <li key={e}>
                    <span>{e}</span>
                    <button type="button" className="btn btn--ghost email-import__remove" aria-label={`Remove ${e}`} disabled={busy} onClick={() => void run(() => removeSender(e))}>
                      <Icon name="close" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
              {(senders?.extra.length ?? 0) < MAX_SENDERS && (
                <form className="skey" onSubmit={add}>
                  <input
                    className="input"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="work@company.com"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    aria-label="Add an address that can forward"
                  />
                  <button type="submit" className="btn" disabled={busy || !draft.trim()}>
                    <Icon name="plus" size={18} /> Add
                  </button>
                </form>
              )}
              {error && (
                <p className="field__error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <button type="button" className="list__row srow" onClick={() => setConfirmRotate(true)} disabled={busy || !address}>
              <span className="srow__text">
                <span className="srow__title">Get a new address</span>
                <span className="srow__sub">If your address ends up somewhere it shouldn’t, replace it.</span>
              </span>
            </button>
          </>
        )}
      </div>
      <ConfirmSheet
        open={confirmRotate}
        title="Get a new address?"
        message="Your current forwarding address will stop working. Update any forwarding rules or saved contacts afterwards."
        confirmLabel="Get new address"
        busy={busy}
        onConfirm={rotate}
        onCancel={() => setConfirmRotate(false)}
      />
    </section>
  );
}
