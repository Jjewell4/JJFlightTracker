import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { ConfirmSheet } from '@/components/Sheet';
import { resolveForeignFlights, useCloudSync } from '@/services/sync/controller';
import './settings.css';

/**
 * Shown when an account signs in on a device that still holds another account's flights:
 * nothing is uploaded until the user chooses to add them to this account or remove them.
 */
export function ForeignFlights() {
  const sync = useCloudSync();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const n = sync.foreignFlights;
  if (!n || sync.phase !== 'signed-in') return null;
  const choose = async (choice: 'adopt' | 'discard') => {
    setBusy(true);
    try {
      await resolveForeignFlights(choice);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  const flights = `${n.toLocaleString('en-US')} ${n === 1 ? 'flight' : 'flights'}`;
  return (
    <section className="foreign" role="alert">
      <p className="foreign__title">
        <Icon name="warning" size={18} /> {flights} on this device came from another account
      </p>
      <p className="foreign__text">
        They haven’t been added to {sync.email ?? 'this account'}. Add them if they’re yours; remove them if this device was used by someone else (they stay in their own account).
      </p>
      <div className="foreign__actions">
        <button type="button" className="btn btn--lg" disabled={busy} onClick={() => setConfirm(true)}>
          Remove from device
        </button>
        <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={() => void choose('adopt')}>
          Add to my account
        </button>
      </div>
      <ConfirmSheet
        open={confirm}
        title={`Remove ${flights} from this device?`}
        message="They’re removed from this device only. If they were synced to another account, they’re still there."
        confirmLabel="Remove"
        danger
        busy={busy}
        onConfirm={() => void choose('discard')}
        onCancel={() => setConfirm(false)}
      />
    </section>
  );
}
