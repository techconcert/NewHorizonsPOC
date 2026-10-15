import { audioShouldRun, busGains, createCueLimiter, CUES, PAD, type CueId } from './audioModel';
import type { Settings } from './settingsModel';

/**
 * Web Audio engine (M8, D-142). Everything is synthesised from oscillators: an ambient pad on the
 * music bus and short cues on the sfx bus. The AudioContext is created only after the first user
 * gesture (`unlock`), never while muted, and is suspended while the tab is hidden. If the browser
 * has no Web Audio, every call does nothing.
 */

export interface AudioEngine {
  /** Call from a user gesture (pointer, key, touch). Idempotent. */
  unlock(): void;
  /** New volumes / mute from the settings. */
  apply(s: Pick<Settings, 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'muted'>): void;
  /** The tab became hidden (true) or visible (false). */
  setHidden(hidden: boolean): void;
  play(cue: CueId): void;
  /** True while a context exists and is running (for the Settings dialog and tests by hand). */
  active(): boolean;
  dispose(): void;
}

type AudioCtor = typeof AudioContext;

function audioConstructor(): AudioCtor | null {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function createAudioEngine(): AudioEngine {
  const limiter = createCueLimiter();
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let music: GainNode | null = null;
  let sfx: GainNode | null = null;
  let padStop: (() => void) | null = null;
  let unlocked = false;
  let hidden = typeof document !== 'undefined' && document.hidden;
  let vol = { masterVolume: 70, musicVolume: 40, sfxVolume: 70, muted: false };
  let failed = false;

  function applyGains(): void {
    if (!ctx || !master || !music || !sfx) return;
    const g = busGains(vol);
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(g.master, t, 0.05);
    music.gain.setTargetAtTime(g.music, t, 0.05);
    sfx.gain.setTargetAtTime(g.sfx, t, 0.05);
  }

  function startPad(c: AudioContext, bus: GainNode): () => void {
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const swell = c.createGain();
    swell.gain.value = 1;
    const padGain = c.createGain();
    padGain.gain.value = 0;
    padGain.gain.setTargetAtTime(PAD.gain, c.currentTime, PAD.fadeInSeconds / 3);
    filter.connect(swell);
    swell.connect(padGain);
    padGain.connect(bus);
    const lfo = c.createOscillator();
    lfo.frequency.value = 1 / PAD.swellSeconds;
    const depth = c.createGain();
    depth.gain.value = 0.3;
    lfo.connect(depth);
    depth.connect(swell.gain);
    lfo.start();
    const oscs: OscillatorNode[] = [lfo];
    PAD.freqs.forEach((f, i) => {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = i % 2 === 0 ? PAD.detuneCents : -PAD.detuneCents;
      o.connect(filter);
      o.start();
      oscs.push(o);
    });
    return () => {
      for (const o of oscs) {
        try {
          o.stop();
        } catch {
          /* already stopped */
        }
      }
    };
  }

  function ensureContext(): void {
    if (ctx || failed) return;
    const Ctor = audioConstructor();
    if (!Ctor) {
      failed = true;
      return;
    }
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      music = ctx.createGain();
      sfx = ctx.createGain();
      music.connect(master);
      sfx.connect(master);
      master.connect(ctx.destination);
      applyGains();
      padStop = startPad(ctx, music);
    } catch {
      failed = true;
      ctx = null;
    }
  }

  function sync(): void {
    const run = audioShouldRun({ unlocked, muted: vol.muted, hidden });
    if (run) ensureContext();
    if (!ctx) return;
    applyGains();
    if (run) void ctx.resume().catch(() => undefined);
    else void ctx.suspend().catch(() => undefined);
  }

  return {
    unlock() {
      if (unlocked) return;
      unlocked = true;
      sync();
    },
    apply(s) {
      vol = {
        masterVolume: s.masterVolume,
        musicVolume: s.musicVolume,
        sfxVolume: s.sfxVolume,
        muted: s.muted,
      };
      sync();
    },
    setHidden(h) {
      hidden = h;
      sync();
    },
    play(cue) {
      if (!ctx || !sfx || ctx.state !== 'running') return;
      if (!audioShouldRun({ unlocked, muted: vol.muted, hidden })) return;
      if (!limiter.allow(cue, ctx.currentTime * 1000)) return;
      const t0 = ctx.currentTime;
      for (const note of CUES[cue]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const start = t0 + note.startMs / 1000;
        const end = start + note.durMs / 1000;
        o.type = note.wave;
        o.frequency.setValueAtTime(note.freq, start);
        if (note.glideTo > 0) o.frequency.exponentialRampToValueAtTime(note.glideTo, end);
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(note.gain, start + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, end);
        o.connect(g);
        g.connect(sfx);
        o.start(start);
        o.stop(end + 0.03);
        o.onended = () => {
          o.disconnect();
          g.disconnect();
        };
      }
    },
    active: () => ctx !== null && ctx.state === 'running',
    dispose() {
      padStop?.();
      padStop = null;
      if (ctx) void ctx.close().catch(() => undefined);
      ctx = null;
      master = null;
      music = null;
      sfx = null;
    },
  };
}
