/**
 * "Play your history" bar: play/pause, scrubber with the current date, speed,
 * scope and close. Owns the playback clock and pushes frames straight to the map
 * and to a few DOM nodes, so React doesn't re-render while it plays.
 */
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { Icon } from '@/components/Icon';
import { usePrefersReducedMotion } from '@/features/flights/use-reduced-motion';
import { kmToMiles } from '@/lib/geo';
import type { FlightMap } from './flight-map';
import { compactNumber } from './map-data';
import type { ReplayData } from './map-style';
import {
  frameAt,
  liveGeoJSON,
  nextSpeed,
  pastGeoJSON,
  replayDateLabel,
  visibleAirports,
  visitedCountries,
  type ReplayFrame,
  type Speed,
  type Timeline,
} from './replay';
import { ReplayPlayer } from './replay-player';

interface ReplayBarProps {
  map: FlightMap;
  timeline: Timeline;
  unit: 'km' | 'mi';
  years: number[];
  year: number | null;
  onYear: (year: number | null) => void;
  onClose: () => void;
}

const SCRUB_MAX = 1000;

function PlayGlyph({ playing, ended }: { playing: boolean; ended: boolean }) {
  if (playing) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <rect x="6" y="4.5" width="4.2" height="15" rx="1.2" />
        <rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" />
      </svg>
    );
  }
  if (ended) return <Icon name="refresh" size={20} strokeWidth={2} />;
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 4.8v14.4a1 1 0 0 0 1.5.86l11.3-7.2a1 1 0 0 0 0-1.72L9.5 3.94A1 1 0 0 0 8 4.8Z" />
    </svg>
  );
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function ReplayBar({ map, timeline, unit, years, year, onYear, onClose }: ReplayBarProps) {
  const reduced = usePrefersReducedMotion();
  const [status, setStatus] = useState({ playing: false, ended: false });
  const [speed, setSpeed] = useState<Speed>(1);
  const scopeId = useId();

  const scrubRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLSpanElement>(null);
  const flightsRef = useRef<HTMLSpanElement>(null);
  const distRef = useRef<HTMLSpanElement>(null);
  const countriesRef = useRef<HTMLSpanElement>(null);
  const playerRef = useRef<ReplayPlayer | null>(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const unitRef = useRef(unit);
  unitRef.current = unit;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  // ---------- frame rendering (outside React) ----------
  const lastFrame = useRef<ReplayFrame | null>(null);
  const renderFrame = useRef<(t: number) => void>(() => {});
  renderFrame.current = (t: number) => {
    const fr = frameAt(timeline, t);
    const prev = lastFrame.current;
    lastFrame.current = fr;
    const still = reducedRef.current;

    const patch: Partial<ReplayData> = {};
    if (!prev || prev.landed !== fr.landed) {
      patch.past = pastGeoJSON(timeline, fr.landed);
      patch.countries = visitedCountries(timeline, fr.landed);
    }
    if (!prev || prev.started !== fr.started) patch.airports = visibleAirports(timeline, fr.started);
    const moving = fr.active.length > 0 || (prev?.active.length ?? 0) > 0;
    if (!prev || moving || still) patch.live = liveGeoJSON(timeline, fr, still);
    if (Object.keys(patch).length) map.updateReplay(patch);

    const set = (el: HTMLElement | null, text: string) => {
      if (el && el.textContent !== text) el.textContent = text;
    };
    const f = timeline.items[Math.max(0, fr.current)]?.flight;
    const label = replayDateLabel(f);
    set(dateRef.current, label);
    set(flightsRef.current, `${fr.flights.toLocaleString('en-US')} ${plural(fr.flights, 'flight', 'flights')}`);
    const dist = unitRef.current === 'mi' ? kmToMiles(fr.distanceKm) : fr.distanceKm;
    set(distRef.current, `${compactNumber(dist)} ${unitRef.current}`);
    set(countriesRef.current, `${fr.countries} ${plural(fr.countries, 'country', 'countries')}`);
    const scrub = scrubRef.current;
    if (scrub) {
      const p = timeline.duration > 0 ? fr.t / timeline.duration : 0;
      const v = String(Math.round(p * SCRUB_MAX));
      if (scrub.value !== v) scrub.value = v;
      scrub.style.setProperty('--p', `${(p * 100).toFixed(2)}%`);
      scrub.setAttribute('aria-valuetext', `${label}, ${fr.flights} of ${timeline.items.length} flights`);
    }
  };

  // ---------- player lifecycle ----------
  useEffect(() => {
    const player = new ReplayPlayer(
      timeline,
      { onFrame: (t) => renderFrame.current(t), onStatus: setStatus },
      { reducedMotion: reducedRef.current },
    );
    playerRef.current = player;
    lastFrame.current = null;
    map.setReplay({
      past: pastGeoJSON(timeline, 0),
      live: { type: 'FeatureCollection', features: [] },
      airports: [],
      countries: [],
    });
    player.setSpeed(speedRef.current);
    player.seek(0);
    player.play();
    return () => {
      player.destroy();
      playerRef.current = null;
    };
  }, [timeline, map]);

  // Leave replay mode when the bar goes away.
  useEffect(() => () => map.setReplay(null), [map]);

  useEffect(() => playerRef.current?.setSpeed(speed), [speed]);
  useEffect(() => {
    playerRef.current?.setReducedMotion(reduced);
    // Re-render the current frame in the new style (moving head vs. whole arc).
    lastFrame.current = null;
    renderFrame.current(playerRef.current?.time ?? 0);
  }, [reduced]);

  // Pause when the tab is hidden.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) playerRef.current?.pause();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const onScrub = (e: ChangeEvent<HTMLInputElement>) => {
    playerRef.current?.seek((Number(e.target.value) / SCRUB_MAX) * timeline.duration);
  };

  const { playing, ended } = status;
  const total = timeline.items.length;

  return (
    <div className="map-glass map-replay" role="region" aria-label="Flight history replay">
      <div className="map-replay__head">
        <span className="map-replay__date" ref={dateRef} aria-hidden />
        <label className="map-replay__scope">
          <span className="visually-hidden" id={scopeId}>
            Replay scope
          </span>
          <select aria-labelledby={scopeId} value={year ?? ''} onChange={(e) => onYear(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All time</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <Icon name="chevron" size={14} className="map-replay__scope-chev" />
        </label>
      </div>

      <div className="map-replay__controls">
        <button
          type="button"
          className="map-replay__play"
          aria-label={playing ? 'Pause' : ended ? 'Replay from start' : 'Play'}
          onClick={() => playerRef.current?.toggle()}
          disabled={!total}
        >
          <PlayGlyph playing={playing} ended={ended} />
        </button>
        <input
          ref={scrubRef}
          className="map-replay__scrub"
          type="range"
          min={0}
          max={SCRUB_MAX}
          step={1}
          defaultValue={0}
          aria-label="Timeline"
          onChange={onScrub}
          disabled={!total}
        />
        <button
          type="button"
          className="map-replay__btn map-replay__speed"
          aria-label={`Speed ${speed}×, change speed`}
          onClick={() => setSpeed(nextSpeed(speed))}
        >
          {speed}×
        </button>
        <button type="button" className="map-replay__btn" aria-label="Close replay" onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
      </div>

      <div className="map-replay__stats" aria-live="off">
        {total ? (
          <>
            <span ref={flightsRef} />
            <span ref={distRef} />
            <span ref={countriesRef} />
          </>
        ) : (
          <span>No mapped flights {year != null ? `in ${year}` : 'yet'}</span>
        )}
      </div>
    </div>
  );
}
