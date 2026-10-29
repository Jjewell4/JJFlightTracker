import type { IconName } from '@/components/Icon';
import type { Insight } from '@/lib/stats';

/** An icon that says what each highlight is about (a window for "Window seat person", a moon for "Night owl"…). */
export function insightIcon(i: Pick<Insight, 'id' | 'kind'>): IconName {
  switch (i.id) {
    case 'seat':
      return i.kind === 'aisle' ? 'aisle' : i.kind === 'middle' ? 'seatMiddle' : 'window';
    case 'hour':
      return i.kind === 'morning' ? 'sunrise' : i.kind === 'afternoon' ? 'sun' : 'moon';
    case 'reason':
      return i.kind === 'business' ? 'briefcase' : i.kind === 'leisure' ? 'palm' : i.kind === 'crew' ? 'plane' : 'suitcase';
    case 'haul':
      return 'route';
    case 'cabin':
      return 'glass';
    default:
      return 'calendar';
  }
}
