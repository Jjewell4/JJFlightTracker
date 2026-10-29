import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useReferenceReady } from '@/data/reference';
import { useDrafts } from '@/services/screenshot/drafts';
import { reviewBanner } from './draft-summary';
import './review.css';

/**
 * "To review" entry point, shown only while screenshots are being read or wait to be saved,
 * so it stays out of the way the rest of the time.
 */
export function ReviewBanner({ compact, className = '' }: { compact?: boolean; className?: string }) {
  const drafts = useDrafts();
  useReferenceReady();
  const info = reviewBanner(drafts ?? []);
  if (!info) return null;
  return (
    <Link to={info.href} className={`rbanner${compact ? ' rbanner--compact' : ''} ${className}`}>
      <span className="rbanner__icon" aria-hidden="true">
        {info.state === 'reading' ? <span className="spinner" /> : <Icon name={info.state === 'failed' ? 'warning' : 'scan'} size={20} />}
      </span>
      <span className="rbanner__text">
        <span className="rbanner__title">{info.title}</span>
        {info.sub && <span className="rbanner__sub">{info.sub}</span>}
      </span>
      <Icon name="chevron" size={18} className="rbanner__go" />
    </Link>
  );
}
