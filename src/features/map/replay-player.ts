/**
 * Playback clock for the map replay. Drives `onFrame(t)` from requestAnimationFrame
 * (or, with reduced motion, steps flight-by-flight on a timer) without touching React
 * state per frame. Timers are injectable so the clock is unit-testable.
 */
import { nextStepTime, type Speed, type Timeline } from './replay';

export interface PlayerCallbacks {
  /** Called with the playback time (ms at 1×) whenever it changes. */
  onFrame: (t: number) => void;
  /** Called when playing / ended flips. */
  onStatus: (s: { playing: boolean; ended: boolean }) => void;
}

export interface PlayerClock {
  now: () => number;
  raf: (cb: (ts: number) => void) => number;
  caf: (id: number) => void;
  setTimeout: (cb: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

const browserClock = (): PlayerClock => ({
  now: () => performance.now(),
  raf: (cb) => requestAnimationFrame(cb),
  caf: (id) => cancelAnimationFrame(id),
  setTimeout: (cb, ms) => window.setTimeout(cb, ms),
  clearTimeout: (id) => window.clearTimeout(id),
});

/** Real time between reduced-motion steps at 1×. */
export const STEP_MS = 900;
/** A reduced-motion replay takes about this many steps (big logs reveal several flights per step). */
export const REDUCED_STEPS = 36;

export class ReplayPlayer {
  private tl: Timeline;
  private t = 0;
  private speed: Speed = 1;
  private playing = false;
  private stepped: boolean;
  private raf = 0;
  private timer = 0;
  private last = 0;
  private readonly clock: PlayerClock;

  constructor(
    tl: Timeline,
    private readonly cb: PlayerCallbacks,
    opts: { reducedMotion?: boolean; clock?: PlayerClock } = {},
  ) {
    this.tl = tl;
    this.stepped = !!opts.reducedMotion;
    this.clock = opts.clock ?? browserClock();
  }

  get time() {
    return this.t;
  }
  get isPlaying() {
    return this.playing;
  }
  get ended() {
    return this.tl.duration > 0 && this.t >= this.tl.duration;
  }

  /** Swaps the timeline (scope changed) and rewinds. */
  setTimeline(tl: Timeline) {
    this.tl = tl;
    this.seek(0);
  }

  setSpeed(speed: Speed) {
    this.speed = speed;
    if (this.playing && this.stepped) this.schedule();
  }

  setReducedMotion(on: boolean) {
    if (on === this.stepped) return;
    const was = this.playing;
    this.halt();
    this.stepped = on;
    if (was) this.play();
  }

  play() {
    if (!this.tl.items.length) return;
    if (this.ended) this.seek(0);
    this.playing = true;
    this.emitStatus();
    this.schedule();
  }

  pause() {
    if (!this.playing) return;
    this.halt();
    this.emitStatus();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    this.t = Math.max(0, Math.min(this.tl.duration, t));
    this.last = this.clock.now();
    this.cb.onFrame(this.t);
    if (this.ended && this.playing) {
      this.halt();
      this.emitStatus();
    } else if (!this.playing) {
      this.emitStatus();
    }
  }

  destroy() {
    this.halt();
  }

  private halt() {
    this.playing = false;
    if (this.raf) this.clock.caf(this.raf);
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.raf = 0;
    this.timer = 0;
  }

  private schedule() {
    if (this.raf) this.clock.caf(this.raf);
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.raf = 0;
    this.timer = 0;
    if (this.stepped) {
      // First step lands right away so pressing play gives immediate feedback.
      const step = () => {
        this.timer = 0;
        if (!this.playing) return;
        this.advance(nextStepTime(this.tl, this.t, this.tl.duration / REDUCED_STEPS));
        if (this.playing) this.timer = this.clock.setTimeout(step, STEP_MS / this.speed);
      };
      this.timer = this.clock.setTimeout(step, this.t === 0 ? 0 : STEP_MS / this.speed);
      return;
    }
    this.last = this.clock.now();
    const tick = (ts: number) => {
      this.raf = 0;
      if (!this.playing) return;
      // Clamp long gaps (backgrounded tab, debugger) so playback never jumps ahead.
      const dt = Math.min(250, Math.max(0, ts - this.last));
      this.last = ts;
      this.advance(this.t + dt * this.speed);
      if (this.playing) this.raf = this.clock.raf(tick);
    };
    this.raf = this.clock.raf(tick);
  }

  private advance(t: number) {
    this.t = Math.min(this.tl.duration, t);
    this.cb.onFrame(this.t);
    if (this.t >= this.tl.duration) {
      this.halt();
      this.emitStatus();
    }
  }

  private emitStatus() {
    this.cb.onStatus({ playing: this.playing, ended: this.ended });
  }
}
