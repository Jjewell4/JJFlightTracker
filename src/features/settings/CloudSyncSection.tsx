import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, syncLabel } from '@/components/AccountButton';
import { Icon } from '@/components/Icon';
import { useCloudSync } from '@/services/sync/controller';
import { ForeignFlights } from './ForeignFlights';

/** Settings entry for the account: status at a glance, details on /account. */
export function CloudSyncSection({ Group }: { Group: (p: { title?: string; footer?: ReactNode; children: ReactNode }) => ReactNode }) {
  const sync = useCloudSync();
  if (sync.phase === 'disabled') return null;
  const signedIn = sync.phase === 'signed-in';
  return (
    <>
    <ForeignFlights />
    <Group title="Account">
      <Link to="/account" className="list__row srow">
        <Avatar size={36} />
        <span className="srow__text">
          <span className="srow__title">{signedIn ? sync.email : 'Sign in to back up & sync'}</span>
          <span className="srow__sub">{sync.phase === 'loading' ? 'Checking…' : signedIn ? `Cloud sync on · ${syncLabel(sync).toLowerCase()}` : 'Your flights are only on this device'}</span>
        </span>
        <Icon name="chevron" size={16} className="srow__chev" />
      </Link>
    </Group>
    </>
  );
}
