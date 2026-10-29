import { useMemo, useState } from 'react';
import { getAircraftType } from '@/data/reference';
import { FAMILY_LABELS, layoutLabel, seatPosition } from '@/lib/cabin-layout';
import type { Flight } from '@/lib/types';
import { CardHead, Section } from './parts';
import { fmtInt, fmtPct, plural } from './format';
import { computeSeatMap, describePosition, SEAT_MAP_MIN, type SeatMap as SeatMapData, type SeatMapGroup } from './seat-map';
import './SeatMap.css';

/** Layout rows drawn; the rest are summarized in the footnote. */
const MAX_ROWS = 2;
/** Shade steps (1 = fewest, 4 = most); 0 is an empty outline. */
const LEVELS = 4;

const resolveType = (code: string) => getAircraftType(code)?.icao;

const level = (count: number, max: number) => (count > 0 && max > 0 ? Math.max(1, Math.ceil((count / max) * LEVELS)) : 0);

/** Where the user sits in the cabin, drawn as one representative row per aircraft layout. */
export function SeatMap({ flights }: { flights: Flight[] }) {
  const data = useMemo(() => computeSeatMap(flights, resolveType), [flights]);
  if (data.placed < SEAT_MAP_MIN || !data.top) return null;
  return <SeatMapCard data={data} />;
}

interface Selection {
  row: number;
  index: number;
}

function SeatMapCard({ data }: { data: SeatMapData }) {
  // A second row only when it has enough seats to say something.
  const rows = data.groups.slice(0, MAX_ROWS).filter((g, i) => i === 0 || g.flights >= SEAT_MAP_MIN);
  const top = data.top!;
  const topRow = Math.max(0, rows.indexOf(top.group));
  const [sel, setSel] = useState<Selection>({ row: topRow, index: top.index });
  // One shared scale so the two rows compare honestly.
  const max = Math.max(...rows.flatMap((g) => g.counts));
  const selected = rows[sel.row] ?? rows[0];
  const selIndex = Math.min(sel.index, selected.counts.length - 1);
  const selCount = selected.counts[selIndex];

  const sideTotal = data.sides.left + data.sides.center + data.sides.right;
  const sides = (['left', 'center', 'right'] as const).filter((s) => data.sides[s] > 0);
  const others = data.groups.slice(rows.length);
  const otherFlights = others.reduce((a, g) => a + g.flights, 0);
  const inferred = rows.reduce((a, g) => a + g.inferred, 0);
  const typeOnly = (['window', 'aisle', 'middle'] as const).filter((t) => data.typeOnly[t] > 0);
  const typeOnlyTotal = typeOnly.reduce((a, t) => a + data.typeOnly[t], 0);

  return (
    <Section id="seats" title="In the cabin">
      <article className="card stats-card seatmap">
        <CardHead
          title="Where you sit"
          subtitle={
            <>
              You pick <strong>{top.letter}</strong> most — {describePosition(top.position)}
            </>
          }
        />

        {rows.map((g, r) => (
          <SeatRow key={g.layout.id} group={g} max={max} selected={sel.row === r ? selIndex : -1} onSelect={(index) => setSel({ row: r, index })} />
        ))}

        <p className="seatmap-readout" role="status" aria-live="polite">
          <span className="seatmap-readout__value">
            {fmtInt(selCount)} {plural(selCount, 'flight')}
          </span>
          <span className="seatmap-readout__label">
            Seat {selected.letters[selIndex]} · {describePosition(seatPosition(selected.layout, selIndex))}
            {selected.flights > 0 && ` · ${fmtPct(selCount / selected.flights)} of ${rowName(selected).toLowerCase()} flights`}
          </span>
        </p>

        <div className="seatmap-foot">
          {sides.length > 1 && (
            <p className="seatmap-sides">
              {sides.map((s, i) => (
                <span key={s}>
                  {i > 0 && ' · '}
                  {s === 'center' ? 'Center' : s === 'left' ? 'Left side' : 'Right side'} <strong>{fmtPct(data.sides[s] / sideTotal)}</strong>
                </span>
              ))}
            </p>
          )}
          <ul className="seatmap-legend" aria-hidden="true">
            <li>
              <span className="seatmap-key" data-level={0} /> Never
            </li>
            <li>
              Fewer
              {Array.from({ length: LEVELS }, (_, i) => (
                <span key={i} className="seatmap-key" data-level={i + 1} />
              ))}
              More
            </li>
          </ul>
        </div>

        <p className="stats-card__foot">
          {typeOnlyTotal > 0 &&
            `${fmtInt(typeOnlyTotal)} more ${plural(typeOnlyTotal, 'flight has', 'flights have')} only a seat type: ${typeOnly.map((t) => `${fmtInt(data.typeOnly[t])} ${t}`).join(', ')}. `}
          {otherFlights > 0 && `${fmtInt(otherFlights)} ${plural(otherFlights, 'flight')} on other layouts (${others.map((g) => g.layout.id).join(', ')}) aren’t drawn. `}
          {inferred > 0 && `${fmtInt(inferred)} ${plural(inferred, 'seat')} without an aircraft type ${inferred === 1 ? 'is' : 'are'} placed by seat letter. `}
          {data.unplaced > 0 && `${fmtInt(data.unplaced)} ${plural(data.unplaced, 'seat doesn’t', 'seats don’t')} fit the aircraft’s usual layout. `}
          Rows show each aircraft’s usual economy layout; airlines and cabins vary.
        </p>
      </article>
    </Section>
  );
}

const rowName = (g: SeatMapGroup) => `${FAMILY_LABELS[g.layout.family]} ${layoutLabel(g.layout)}`;

function SeatRow({ group, max, selected, onSelect }: { group: SeatMapGroup; max: number; selected: number; onSelect: (index: number) => void }) {
  const name = rowName(group);
  let start = 0;
  const blocks = group.layout.blocks.map((n) => {
    const idx = Array.from({ length: n }, (_, i) => start + i);
    start += n;
    return idx;
  });
  return (
    <div className="seatmap-row">
      <div className="seatmap-row__head">
        <span className="seatmap-row__name">
          {FAMILY_LABELS[group.layout.family]} <span className="seatmap-row__layout">{layoutLabel(group.layout)}</span>
        </span>
        <span className="seatmap-row__count">
          {fmtInt(group.flights)} {plural(group.flights, 'flight')}
        </span>
      </div>
      <div className="seatmap-cabin" role="group" aria-label={`${name} row, ${fmtInt(group.flights)} ${plural(group.flights, 'flight')}`}>
        {blocks.map((idx, b) => (
          <div key={b} className="seatmap-block">
            {idx.map((i) => {
              const count = group.counts[i];
              const letter = group.letters[i];
              return (
                <button
                  key={i}
                  type="button"
                  className="seatmap-seat"
                  data-level={level(count, max)}
                  aria-pressed={selected === i}
                  aria-label={`Seat ${letter}, ${describePosition(seatPosition(group.layout, i))}: ${fmtInt(count)} ${plural(count, 'flight')}`}
                  onClick={() => onSelect(i)}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && onSelect(i)}
                  onFocus={() => onSelect(i)}
                >
                  <span className="seatmap-seat__shape" aria-hidden="true">
                    {letter}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
