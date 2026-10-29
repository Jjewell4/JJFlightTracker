import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getAircraftType } from '@/data/reference';
import type { Flight } from '@/lib/types';
import { CardHead, Section, Seg } from './parts';
import { fmtInt, fmtPct, plural } from './format';
import {
  computeSeatMap,
  describePosition,
  dominantThird,
  seatHeadline,
  thirdOf,
  thirdRanges,
  SEAT_MAP_MIN,
  THIRDS,
  WINDOW_MIN,
  type PlaneMap,
  type SeatMap as SeatMapData,
  type Third,
} from './seat-map';
import { seatPosition } from '@/lib/cabin-layout';
import './SeatMap.css';

/** Shade steps (1 = fewest, 4 = most); 0 is an empty outline. */
const LEVELS = 4;
/** Planes offered in the toggle, and the fewest seats a second plane needs to be offered. */
const MAX_PLANES = 3;
const TOGGLE_MIN = 8;
/** Most-used seats listed as buttons (the keyboard / screen reader way into the map). */
const TOP_SEATS = 6;

const resolveType = (code: string) => getAircraftType(code)?.icao;
const level = (count: number, max: number) => (count > 0 && max > 0 ? Math.max(1, Math.ceil((count / max) * LEVELS)) : 0);
const THIRD_LABEL: Record<Third, string> = { front: 'Front', middle: 'Middle', back: 'Back' };

/** Where the user sits, drawn as their seats on a top-down plan of the aircraft they fly most. */
export function SeatMap({ flights }: { flights: Flight[] }) {
  const data = useMemo(() => computeSeatMap(flights, resolveType), [flights]);
  if (data.drawn < SEAT_MAP_MIN || !data.planes.length || data.planes[0].stats.seats < 3) return null;
  return <SeatMapCard data={data} />;
}

interface Selection {
  row: number;
  index: number;
}

const topSeats = (plane: PlaneMap) => [...plane.seats].sort((a, b) => b.count - a.count || a.row - b.row || a.index - b.index);

function SeatMapCard({ data }: { data: SeatMapData }) {
  const shown = data.planes.filter((p, i) => i === 0 || p.stats.seats >= TOGGLE_MIN).slice(0, MAX_PLANES);
  const [key, setKey] = useState(shown[0].key);
  const plane = shown.find((p) => p.key === key) ?? shown[0];
  const [selByPlane, setSelByPlane] = useState<Record<string, Selection>>({});
  const best = topSeats(plane)[0];
  const sel = selByPlane[plane.key] ?? { row: best.row, index: best.index };
  const select = (s: Selection) => setSelByPlane((m) => ({ ...m, [plane.key]: s }));

  const hidden = data.planes.filter((p) => !shown.includes(p));
  const hiddenSeats = hidden.reduce((a, p) => a + p.flights, 0);
  const labels = labelPlanes(shown);
  const inferred = plane.inferred;
  const typeOnly = (['window', 'aisle', 'middle'] as const).filter((t) => data.typeOnly[t] > 0);
  const typeOnlyTotal = typeOnly.reduce((a, t) => a + data.typeOnly[t], 0);
  const s = plane.stats;
  const third = dominantThird(s);

  return (
    <Section id="seats" title="In the cabin">
      <article className="card stats-card seatmap">
        <CardHead title="Where you sit" subtitle={seatHeadline(data.overall, data.planes[0])} />
        {shown.length > 1 && <Seg label="Aircraft" value={plane.key} onChange={setKey} options={shown.map((p) => ({ value: p.key, label: labels[p.key] }))} />}

        <div className="seatmap-body">
          <PlaneView plane={plane} sel={sel} onSelect={select} />

          <div className="seatmap-side">
            <Readout plane={plane} sel={sel} />

            <dl className="seatmap-stats">
              <div className="seatmap-stat">
                <dt>Median row</dt>
                <dd className="seatmap-stat__value">{fmtInt(s.medianRow)}</dd>
                <dd className="seatmap-stat__sub">{third ? `${fmtPct(s.thirds[third] / s.seats)} in the ${third === 'middle' ? 'middle' : third} third` : `of ${plane.rows} rows`}</dd>
              </div>
              {s.windows.total >= WINDOW_MIN && (
                <>
                  <div className="seatmap-stat">
                    <dt>Window at wing</dt>
                    <dd className="seatmap-stat__value">{fmtPct(s.windows.overWing / s.windows.total)}</dd>
                    <dd className="seatmap-stat__sub">vs ≈{fmtPct(s.wingShare)} of rows</dd>
                  </div>
                  <div className="seatmap-stat">
                    <dt>Window side</dt>
                    <dd className="seatmap-stat__value">{s.windows.left === s.windows.right ? 'Even' : s.windows.left > s.windows.right ? 'Left' : 'Right'}</dd>
                    <dd className="seatmap-stat__sub">
                      {fmtInt(s.windows.left)} L · {fmtInt(s.windows.right)} R windows
                    </dd>
                  </div>
                </>
              )}
            </dl>

            <div className="seatmap-top">
              <h4 className="seatmap-top__title">Your most-used seats</h4>
              <div className="seatmap-top__list">
                {topSeats(plane)
                  .slice(0, TOP_SEATS)
                  .map((seat) => (
                    <button
                      key={`${seat.row}${seat.letter}`}
                      type="button"
                      className="seatmap-chip"
                      aria-pressed={sel.row === seat.row && sel.index === seat.index}
                      aria-label={`Seat ${seat.row}${seat.letter}: ${fmtInt(seat.count)} ${plural(seat.count, 'flight')}`}
                      onClick={() => select(seat)}
                    >
                      {seat.row}
                      {seat.letter}
                      {seat.count > 1 && <span className="seatmap-chip__count">×{seat.count}</span>}
                    </button>
                  ))}
              </div>
            </div>

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
              <li>
                <span className="seatmap-key seatmap-key--wing" /> Over the wing (approx.)
              </li>
            </ul>
          </div>
        </div>

        <p className="stats-card__foot">
          {plane.beyond > 0 && `${fmtInt(plane.beyond)} ${plural(plane.beyond, 'seat')} past row ${plane.rows} ${plane.beyond === 1 ? 'isn’t' : 'aren’t'} drawn. `}
          {hiddenSeats > 0 && `${fmtInt(hiddenSeats)} ${plural(hiddenSeats, 'seat')} on other aircraft (${hidden.map((p) => p.plan.label).join(', ')}) ${hiddenSeats === 1 ? 'isn’t' : 'aren’t'} drawn. `}
          {data.noRow > 0 && `${fmtInt(data.noRow)} ${plural(data.noRow, 'seat has', 'seats have')} a letter but no row. `}
          {typeOnlyTotal > 0 &&
            `${fmtInt(typeOnlyTotal)} more ${plural(typeOnlyTotal, 'flight has', 'flights have')} only a seat type: ${typeOnly.map((t) => `${fmtInt(data.typeOnly[t])} ${t}`).join(', ')}. `}
          {inferred > 0 && `${fmtInt(inferred)} ${plural(inferred, 'seat')} without an aircraft type ${inferred === 1 ? 'is' : 'are'} placed by seat letter. `}
          {data.unplaced > 0 && `${fmtInt(data.unplaced)} ${plural(data.unplaced, 'seat doesn’t', 'seats don’t')} fit the aircraft’s usual layout. `}
          Drawn as a typical {plane.plan.label} economy cabin; row numbers and the wing position are approximate and vary by airline.
        </p>
      </article>
    </Section>
  );
}

/** Toggle labels; a layout suffix only when two planes share a name. */
function labelPlanes(planes: PlaneMap[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of planes) out[p.key] = planes.some((q) => q !== p && q.plan.label === p.plan.label) ? `${p.plan.label} ${p.layout.id}` : p.plan.label;
  return out;
}

function Readout({ plane, sel }: { plane: PlaneMap; sel: Selection }) {
  const seat = plane.seats.find((x) => x.row === sel.row && x.index === sel.index);
  const count = seat?.count ?? 0;
  const pos = seatPosition(plane.layout, sel.index);
  const wing = sel.row >= plane.plan.wing[0] && sel.row <= plane.plan.wing[1];
  const parts = [
    `${fmtInt(count)} ${plural(count, 'flight')}`,
    describePosition(pos),
    wing ? 'over the wing' : `${thirdOf(sel.row, plane.rows)} third`,
  ];
  return (
    <p className="seatmap-readout" role="status" aria-live="polite">
      <span className="seatmap-readout__value">
        Seat {sel.row}
        {plane.letters[sel.index]}
      </span>
      <span className="seatmap-readout__label">{parts.join(' · ')}</span>
    </p>
  );
}

/* ------------------------------------------------------------------------------------------ *
 * The drawing. Units are SVG user units; the viewBox scales to the card width.
 * ------------------------------------------------------------------------------------------ */

const SEAT_PITCH = 10; // across
const SEAT = 8;
const AISLE = 9;
const WALL = 7;
const ROW = 10.5; // along
const PAD = 6;
const ANNOT = 56;
/** Tap radius in screen pixels: taps snap to the nearest flown seat within this. */
const SNAP_PX = 24;

function geometry(plane: PlaneMap) {
  const { layout, plan, rows } = plane;
  const nSeats = layout.blocks.reduce((a, b) => a + b, 0);
  const cabinW = nSeats * SEAT_PITCH + (layout.blocks.length - 1) * AISLE;
  const fusW = cabinW + 2 * WALL;
  const prop = plan.engines === 'prop';
  const span = prop ? fusW * 1.35 : 40 + fusW * 0.65; // wing reach beyond the fuselage side
  const halfW = fusW / 2 + span;
  const cx = PAD + halfW;
  const fl = cx - fusW / 2;
  const fr = cx + fusW / 2;
  const noseLen = fusW * 1.15;
  const y0 = PAD + noseLen + 12;
  const rowY = (r: number) => y0 + (r - 1) * ROW;
  const cabinEnd = rowY(rows + 1);
  const tailStart = cabinEnd + 4;
  const tailLen = fusW * 1.55;
  const tailEnd = tailStart + tailLen;

  const colX: number[] = [];
  let x = fl + WALL;
  layout.blocks.forEach((n, b) => {
    for (let i = 0; i < n; i++) colX.push(x + i * SEAT_PITCH + SEAT_PITCH / 2);
    x += n * SEAT_PITCH + (b < layout.blocks.length - 1 ? AISLE : 0);
  });

  const w0 = Math.min(plan.wing[0], rows);
  const w1 = Math.min(plan.wing[1], rows);
  return {
    width: 2 * halfW + ANNOT + PAD * 2,
    height: tailEnd + PAD,
    cx, fl, fr, fusW, cabinW, span, noseLen, y0, rowY, cabinEnd, tailStart, tailLen, tailEnd, colX, w0, w1, prop,
    rowCenter: (r: number) => rowY(r) + ROW / 2,
  };
}

type Geo = ReturnType<typeof geometry>;

function PlaneView({ plane, sel, onSelect }: { plane: PlaneMap; sel: Selection; onSelect: (s: Selection) => void }) {
  const g = useMemo(() => geometry(plane), [plane]);
  const svgRef = useRef<SVGSVGElement>(null);
  const max = Math.max(...plane.seats.map((x) => x.count));
  const counts = useMemo(() => new Map(plane.seats.map((x) => [x.row * 100 + x.index, x.count])), [plane]);
  const s = plane.stats;
  const third = dominantThird(s);

  // Snap a tap to the nearest flown seat (small seats, generous target); else the seat under it.
  const pick = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM?.();
    if (!svg || !ctm) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const r = SNAP_PX / ctm.a;
    let hit: Selection | undefined;
    let bestD = r * r;
    for (const seat of plane.seats) {
      const d = (g.colX[seat.index] - pt.x) ** 2 + (g.rowCenter(seat.row) - pt.y) ** 2;
      if (d <= bestD) [bestD, hit] = [d, seat];
    }
    if (!hit && pt.x >= g.fl + WALL && pt.x <= g.fr - WALL && pt.y >= g.y0 && pt.y < g.cabinEnd) {
      const row = Math.floor((pt.y - g.y0) / ROW) + 1;
      const index = g.colX.reduce((bi, cx, i) => (Math.abs(cx - pt.x) < Math.abs(g.colX[bi] - pt.x) ? i : bi), 0);
      hit = { row, index };
    }
    if (hit) onSelect({ row: hit.row, index: hit.index });
  };

  const summary =
    `Top-down seat map of a typical ${plane.plan.label} cabin, ${plane.rows} rows, ${plane.layout.blocks.join('-')} seating. ` +
    `${fmtInt(s.seats)} ${plural(s.seats, 'flight')} drawn across ${fmtInt(plane.seats.length)} ${plural(plane.seats.length, 'seat')}: ` +
    THIRDS.map((t) => `${fmtPct(s.thirds[t] / s.seats)} ${t}`).join(', ') +
    `. Wing roughly beside rows ${g.w0}–${g.w1}.`;

  return (
    <div className="seatmap-plane">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${g.width.toFixed(1)} ${g.height.toFixed(1)}`}
        role="img"
        aria-label={summary}
        onPointerUp={pick}
        onPointerMove={(e) => e.pointerType === 'mouse' && e.buttons === 0 && pick(e)}
      >
        <Airframe g={g} plane={plane} />

        {/* Over-wing rows, tinted inside the cabin. */}
        <rect className="sm-wingband" x={g.fl + 2} y={g.rowY(g.w0)} width={g.fusW - 4} height={(g.w1 - g.w0 + 1) * ROW} />

        {/* Column letters and row numbers. */}
        {plane.letters.map((l, i) => (
          <text key={l + i} className="sm-label sm-label--letter" x={g.colX[i]} y={g.y0 - 4} textAnchor="middle">
            {l}
          </text>
        ))}
        {Array.from({ length: plane.rows }, (_, i) => i + 1)
          .filter((r) => r === 1 || r % 5 === 0)
          .map((r) => (
            <text key={r} className="sm-label" x={g.fl - 4} y={g.rowCenter(r) + 3} textAnchor="end">
              {r}
            </text>
          ))}

        {/* Seats: every seat of every row, flown ones shaded. */}
        <g>
          {Array.from({ length: plane.rows }, (_, i) =>
            g.colX.map((x, index) => {
              const row = i + 1;
              const c = counts.get(row * 100 + index) ?? 0;
              return <rect key={row * 100 + index} className="sm-seat" data-level={level(c, max)} x={x - SEAT / 2} y={g.rowY(row) + (ROW - SEAT) / 2} width={SEAT} height={SEAT} rx={2} />;
            }),
          )}
        </g>
        {sel.row <= plane.rows && (
          <rect className="sm-sel" x={g.colX[sel.index] - SEAT / 2 - 2.5} y={g.rowY(sel.row) + (ROW - SEAT) / 2 - 2.5} width={SEAT + 5} height={SEAT + 5} rx={3.5} />
        )}

        {/* Front / middle / back shares. */}
        <Thirds g={g} plane={plane} highlight={third} />

        {/* Wing note on the left wing. */}
        <text className="sm-label sm-label--wing" x={g.fl - g.span * 0.5} y={g.rowY(g.w0) + g.span * 0.5 * (g.prop ? 0.08 : 0.5) + 10} textAnchor="middle">
          <tspan>Wing</tspan>
          <tspan x={g.fl - g.span * 0.5} dy={10}>
            ≈ rows {g.w0}–{g.w1}
          </tspan>
        </text>
      </svg>
    </div>
  );
}

function Thirds({ g, plane, highlight }: { g: Geo; plane: PlaneMap; highlight?: Third }) {
  const ranges = thirdRanges(plane.rows);
  const x = g.width - PAD - ANNOT + 10;
  const s = plane.stats;
  return (
    <g>
      {THIRDS.map((t) => {
        const [a, b] = ranges[t];
        const top = g.rowY(a) + 2;
        const bot = g.rowY(b + 1) - 2;
        const mid = (top + bot) / 2;
        return (
          <g key={t} className={`sm-third${highlight === t ? ' sm-third--on' : ''}`}>
            <path className="sm-third__line" d={`M${x - 3} ${top} H${x} V${bot} H${x - 3}`} />
            <text className="sm-third__name" x={x + 6} y={mid - 3}>
              {THIRD_LABEL[t]}
            </text>
            <text className="sm-third__pct" x={x + 6} y={mid + 11}>
              {fmtPct(s.thirds[t] / s.seats)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Wings, engines, tail and fuselage, drawn back to front. */
function Airframe({ g, plane }: { g: Geo; plane: PlaneMap }) {
  const { cx, fl, fr, fusW, span, noseLen, tailStart, tailLen, tailEnd, prop } = g;
  const { plan } = plane;
  const top = PAD;
  const sweep = prop ? 0.08 : 0.5;
  const rootLE = g.rowY(g.w0) - 3;
  const rootTE = g.rowY(g.w1 + 1) + 3;
  const chord = rootTE - rootLE;
  const tipLE = rootLE + span * sweep;
  const tipChord = chord * (prop ? 0.6 : 0.3);
  const wing = (dir: 1 | -1) => {
    const root = dir > 0 ? fr - 2 : fl + 2;
    const tip = dir > 0 ? fr + span : fl - span;
    const kinkX = root + dir * span * 0.3;
    const kinkY = rootTE + (prop ? 0 : span * 0.3 * 0.12);
    return `M${root} ${rootLE} L${tip} ${tipLE} Q${tip + dir * 3} ${tipLE + tipChord / 2} ${tip} ${tipLE + tipChord} L${kinkX} ${kinkY} L${root} ${rootTE} Z`;
  };
  const leAt = (off: number) => rootLE + off * sweep;

  const engines: { x: number; y: number; w: number; h: number }[] = [];
  const nacW = Math.max(12, fusW * 0.2);
  if (plan.engines === 'wing') {
    const spots = plan.quad ? [0.3, 0.64] : [0.36];
    for (const f of spots) {
      const len = Math.min(Math.max(chord * 0.55, 26), 42) * (f > 0.5 ? 0.85 : 1);
      for (const dir of [1, -1] as const) {
        const off = span * f;
        const x = dir > 0 ? fr + off : fl - off;
        engines.push({ x: x - nacW / 2, y: leAt(off) - len * 0.55, w: nacW, h: len });
      }
    }
  } else if (plan.engines === 'prop') {
    const len = chord * 0.95;
    for (const dir of [1, -1] as const) {
      const off = span * 0.3;
      const x = dir > 0 ? fr + off : fl - off;
      engines.push({ x: x - nacW * 0.4, y: leAt(off) - len * 0.4, w: nacW * 0.8, h: len });
    }
  } else {
    const len = fusW * 0.9;
    const w = fusW * 0.3;
    const y = tailStart + tailLen * 0.08;
    engines.push({ x: fr - w * 0.15, y, w, h: len }, { x: fl - w * 0.85, y, w, h: len });
  }

  const hsY = tailStart + tailLen * 0.52;
  const hsChord = tailLen * 0.28;
  const hsSpan = fusW * 1.15;
  const stab = (dir: 1 | -1) =>
    `M${cx} ${hsY} L${cx + dir * hsSpan} ${hsY + hsSpan * 0.42} L${cx + dir * hsSpan} ${hsY + hsSpan * 0.42 + hsChord * 0.38} L${cx} ${hsY + hsChord} Z`;
  const tw = fusW * 0.07;
  const body =
    `M${fl} ${top + noseLen} C${fl} ${top + noseLen * 0.32} ${cx - fusW * 0.3} ${top} ${cx} ${top} ` +
    `C${cx + fusW * 0.3} ${top} ${fr} ${top + noseLen * 0.32} ${fr} ${top + noseLen} ` +
    `L${fr} ${tailStart} C${fr} ${tailStart + tailLen * 0.55} ${cx + tw} ${tailEnd - tailLen * 0.15} ${cx + tw} ${tailEnd} ` +
    `L${cx - tw} ${tailEnd} C${cx - tw} ${tailEnd - tailLen * 0.15} ${fl} ${tailStart + tailLen * 0.55} ${fl} ${tailStart} Z`;
  const glassY = top + noseLen * 0.4;

  return (
    <g aria-hidden="true">
      <path className="sm-wing" d={wing(1)} />
      <path className="sm-wing" d={wing(-1)} />
      <path className="sm-wing" d={stab(1)} />
      <path className="sm-wing" d={stab(-1)} />
      {engines.map((e, i) => (
        <rect key={i} className="sm-engine" x={e.x} y={e.y} width={e.w} height={e.h} rx={e.w / 2} />
      ))}
      {prop &&
        engines.map((e, i) => <line key={`p${i}`} className="sm-prop" x1={e.x + e.w / 2 - fusW * 0.4} x2={e.x + e.w / 2 + fusW * 0.4} y1={e.y - 2} y2={e.y - 2} />)}
      <path className="sm-body" d={body} />
      <path className="sm-glass" d={`M${cx - fusW * 0.26} ${glassY + 5} Q${cx} ${glassY - 5} ${cx + fusW * 0.26} ${glassY + 5}`} />
      <rect className="sm-fin" x={cx - 2.5} y={tailStart + tailLen * 0.3} width={5} height={tailLen * 0.66} rx={2.5} />
    </g>
  );
}
