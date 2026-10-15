import type { GameEventKind } from './gameEvents';
import type { Settings } from './settingsModel';

/**
 * Audio cue and volume model (M8, D-142). Pure data and arithmetic: which notes make each cue, how
 * the three volume sliders and the mute switch turn into bus gains, when the engine may run, and
 * how often a cue may repeat. `audio.ts` plays these notes with the Web Audio API; no sound file
 * exists anywhere in the project.
 */

export type CueId =
  'click' | 'launch' | 'card' | 'arrival' | 'foundSuccess' | 'foundFailure' | 'warning';

export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth';

export interface Note {
  wave: Wave;
  /** Hz at the start. */
  freq: number;
  /** Hz at the end of the note (a glide), or 0 for a steady pitch. */
  glideTo: number;
  startMs: number;
  durMs: number;
  /** Peak gain 0..1 before the bus gains. */
  gain: number;
}

function n(
  wave: Wave,
  freq: number,
  startMs: number,
  durMs: number,
  gain: number,
  glideTo = 0,
): Note {
  return { wave, freq, glideTo, startMs, durMs, gain };
}

export const CUES: Readonly<Record<CueId, readonly Note[]>> = {
  click: [n('triangle', 880, 0, 70, 0.22, 640)],
  launch: [
    n('sine', 196, 0, 700, 0.3, 392),
    n('triangle', 98, 0, 600, 0.22, 196),
    n('sine', 784, 450, 400, 0.12),
  ],
  card: [n('sine', 880, 0, 700, 0.28), n('sine', 1318.5, 140, 800, 0.2)],
  arrival: [
    n('sine', 523.25, 0, 450, 0.24),
    n('sine', 659.25, 160, 450, 0.24),
    n('sine', 783.99, 320, 700, 0.24),
  ],
  foundSuccess: [
    n('triangle', 392, 0, 350, 0.26),
    n('triangle', 523.25, 150, 350, 0.26),
    n('triangle', 659.25, 300, 350, 0.26),
    n('triangle', 783.99, 450, 400, 0.26),
    n('sine', 1046.5, 600, 1100, 0.3),
  ],
  foundFailure: [
    n('triangle', 392, 0, 450, 0.26),
    n('triangle', 311.13, 260, 450, 0.26),
    n('triangle', 233.08, 520, 1000, 0.28, 196),
  ],
  warning: [n('square', 440, 0, 140, 0.1), n('square', 440, 230, 140, 0.1)],
};

export const CUE_IDS: readonly CueId[] = Object.keys(CUES) as CueId[];

/** Game event to the cue that goes with it, or null for none. */
export function cueForEvent(kind: GameEventKind): CueId | null {
  switch (kind) {
    case 'card':
      return 'card';
    case 'arrival':
      return 'arrival';
    case 'founded':
    case 'won':
      return 'foundSuccess';
    case 'foundFailed':
    case 'lost':
      return 'foundFailure';
    case 'lowMargin':
      return 'warning';
  }
}

/** Length of a cue in ms (the end of its last note). */
export function cueDurationMs(cue: CueId): number {
  let end = 0;
  for (const note of CUES[cue]) end = Math.max(end, note.startMs + note.durMs);
  return end;
}

/** The soft ambient pad: slow detuned sines on an open chord. */
export const PAD = {
  /** A2, E3, A3, C#4. */
  freqs: [110, 164.81, 220, 277.18] as readonly number[],
  /** Cents of detune alternating between voices. */
  detuneCents: 6,
  /** Peak gain per voice before the music bus. */
  gain: 0.07,
  /** Slow volume swell period in seconds. */
  swellSeconds: 14,
  /** Fade in on start, in seconds. */
  fadeInSeconds: 4,
};

/** Percent slider to linear gain with a gentle curve (quiet end finer than loud end). */
export function volumeGain(percent: number): number {
  const p = percent < 0 ? 0 : percent > 100 ? 100 : percent;
  return (p * p) / 10000;
}

export interface BusGains {
  /** Master bus; 0 when muted. */
  master: number;
  music: number;
  sfx: number;
}

type VolumeSettings = Pick<Settings, 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'muted'>;

export function busGains(s: VolumeSettings): BusGains {
  return {
    master: s.muted ? 0 : volumeGain(s.masterVolume),
    music: volumeGain(s.musicVolume),
    sfx: volumeGain(s.sfxVolume),
  };
}

/**
 * Should the engine be producing sound? Only after a user gesture unlocked it, never when muted
 * and never while the tab is hidden.
 */
export function audioShouldRun(opts: {
  unlocked: boolean;
  muted: boolean;
  hidden: boolean;
}): boolean {
  return opts.unlocked && !opts.muted && !opts.hidden;
}

/** Minimum gap between two plays of the same cue, in ms. */
export const CUE_MIN_GAP_MS: Readonly<Record<CueId, number>> = {
  click: 40,
  launch: 400,
  card: 400,
  arrival: 400,
  foundSuccess: 800,
  foundFailure: 800,
  warning: 5000,
};

export interface CueLimiter {
  /** True (and the play is recorded) when the cue may sound now. */
  allow(cue: CueId, nowMs: number): boolean;
  reset(): void;
}

export function createCueLimiter(): CueLimiter {
  const last = new Map<CueId, number>();
  return {
    allow(cue, nowMs) {
      const prev = last.get(cue);
      if (prev !== undefined && nowMs - prev < CUE_MIN_GAP_MS[cue] && nowMs >= prev) return false;
      last.set(cue, nowMs);
      return true;
    },
    reset: () => last.clear(),
  };
}
