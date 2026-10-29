import { describe, expect, it } from 'vitest';
import type { Timeline } from './replay';
import { ReplayPlayer, STEP_MS, type PlayerClock } from './replay-player';

/** Minimal timeline: three flights landing at 1000, 2000 and 3000 ms. */
const TL = {
  items: [{ start: 0 }, { start: 1000 }, { start: 2000 }],
  fly: 1000,
  duration: 3000,
} as unknown as Timeline;

function fakeClock() {
  let now = 0;
  let id = 0;
  const frames = new Map<number, (ts: number) => void>();
  const timers = new Map<number, { at: number; cb: () => void }>();
  const clock: PlayerClock = {
    now: () => now,
    raf: (cb) => (frames.set(++id, cb), id),
    caf: (i) => void frames.delete(i),
    setTimeout: (cb, ms) => (timers.set(++id, { at: now + ms, cb }), id),
    clearTimeout: (i) => void timers.delete(i),
  };
  return {
    clock,
    /** Advances time by ms, firing animation frames every 16 ms and due timers. */
    advance(ms: number) {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + 16);
        for (const [i, t] of [...timers]) {
          if (t.at <= now) {
            timers.delete(i);
            t.cb();
          }
        }
        const due = [...frames];
        frames.clear();
        for (const [, cb] of due) cb(now);
      }
    },
    pending: () => frames.size + timers.size,
  };
}

function setup(reducedMotion = false) {
  const c = fakeClock();
  const frames: number[] = [];
  const statuses: { playing: boolean; ended: boolean }[] = [];
  const p = new ReplayPlayer(TL, { onFrame: (t) => frames.push(t), onStatus: (s) => statuses.push(s) }, { clock: c.clock, reducedMotion });
  return { c, p, frames, statuses };
}

describe('ReplayPlayer', () => {
  it('advances with animation frames and stops at the end', () => {
    const { c, p, statuses } = setup();
    p.play();
    c.advance(1000);
    expect(p.time).toBeGreaterThan(900);
    expect(p.time).toBeLessThanOrEqual(1000);
    c.advance(5000);
    expect(p.time).toBe(3000);
    expect(p.isPlaying).toBe(false);
    expect(statuses[statuses.length - 1]).toEqual({ playing: false, ended: true });
    expect(c.pending()).toBe(0);
  });

  it('applies speed and pauses/resumes', () => {
    const { c, p } = setup();
    p.setSpeed(4);
    p.play();
    c.advance(500);
    expect(p.time).toBeGreaterThan(1800);
    p.pause();
    const t = p.time;
    c.advance(1000);
    expect(p.time).toBe(t);
    expect(c.pending()).toBe(0);
  });

  it('restarts from the beginning when played after the end', () => {
    const { c, p } = setup();
    p.seek(3000);
    expect(p.ended).toBe(true);
    p.play();
    c.advance(100);
    expect(p.time).toBeLessThan(200);
  });

  it('seeks and reports frames', () => {
    const { p, frames } = setup();
    p.seek(1500);
    expect(frames).toEqual([1500]);
    p.seek(-10);
    expect(p.time).toBe(0);
  });

  it('steps flight by flight with reduced motion', () => {
    const { c, p, frames } = setup(true);
    p.play();
    c.advance(20);
    expect(frames).toEqual([1000]);
    c.advance(STEP_MS);
    expect(frames).toEqual([1000, 2000]);
    c.advance(STEP_MS * 3);
    expect(frames).toEqual([1000, 2000, 3000]);
    expect(p.isPlaying).toBe(false);
  });

  it('cleans up on destroy', () => {
    const { c, p } = setup();
    p.play();
    c.advance(50);
    p.destroy();
    expect(c.pending()).toBe(0);
  });
});
