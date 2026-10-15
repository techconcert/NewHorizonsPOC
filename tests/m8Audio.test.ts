// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { OUTCOME } from '../src/shared/colony';
import {
  FoundTier,
  LAST_ROLL_SLOTS,
  LR_DAY,
  LR_KIND,
  LR_REGION,
  LR_RESULT,
  LR_STRIDE,
} from '../src/shared/planetfall';
import {
  createSnapshot,
  META_COLONY_COUNT,
  META_EXPEDITION_COUNT,
  META_OUTCOME,
  META_PENDING_COUNT,
  META_SHIP_COUNT,
} from '../src/shared/snapshot';
import { SHIP_STATE } from '../src/shared/transit';
import {
  audioShouldRun,
  busGains,
  createCueLimiter,
  CUE_IDS,
  CUE_MIN_GAP_MS,
  CUES,
  cueDurationMs,
  cueForEvent,
  PAD,
  volumeGain,
} from '../src/ui/audioModel';
import {
  createGameEventDetector,
  createGameFacts,
  eventAnnouncement,
  readGameFacts,
  type GameEventKind,
  type GameFacts,
} from '../src/ui/gameEvents';
import { createFrameStats, FRAME_RING } from '../src/ui/frameStats';

describe('audio cue model', () => {
  it('has the seven cues the game needs', () => {
    expect([...CUE_IDS].sort()).toEqual(
      ['arrival', 'card', 'click', 'foundFailure', 'foundSuccess', 'launch', 'warning'].sort(),
    );
  });

  it('every note is playable: positive pitch, length and gain under 1', () => {
    for (const id of CUE_IDS) {
      expect(CUES[id].length).toBeGreaterThan(0);
      for (const n of CUES[id]) {
        expect(n.freq).toBeGreaterThan(20);
        expect(n.freq).toBeLessThan(5000);
        expect(n.durMs).toBeGreaterThan(20);
        expect(n.startMs).toBeGreaterThanOrEqual(0);
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(0.5);
        expect(n.glideTo).toBeGreaterThanOrEqual(0);
      }
      expect(CUE_MIN_GAP_MS[id]).toBeGreaterThan(0);
    }
  });

  it('literal durations: click 70 ms, card 940 ms, success 1700 ms', () => {
    expect(cueDurationMs('click')).toBe(70);
    expect(cueDurationMs('card')).toBe(940);
    expect(cueDurationMs('foundSuccess')).toBe(1700);
    expect(cueDurationMs('foundFailure')).toBe(1520);
  });

  it('success rises and failure falls', () => {
    const up = CUES.foundSuccess.map((n) => n.freq);
    expect([...up].sort((a, b) => a - b)).toEqual(up);
    const down = CUES.foundFailure.map((n) => n.freq);
    expect([...down].sort((a, b) => b - a)).toEqual(down);
  });

  it('the pad is a soft chord', () => {
    expect(PAD.freqs).toEqual([110, 164.81, 220, 277.18]);
    expect(PAD.gain).toBeLessThan(0.1);
  });

  it('maps volume sliders to gains with a squared curve', () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(50)).toBe(0.25);
    expect(volumeGain(100)).toBe(1);
    expect(volumeGain(-10)).toBe(0);
    expect(volumeGain(500)).toBe(1);
  });

  it('muting zeroes the master bus only', () => {
    const on = busGains({ masterVolume: 50, musicVolume: 80, sfxVolume: 20, muted: false });
    expect(on).toEqual({ master: 0.25, music: 0.64, sfx: 0.04 });
    const off = busGains({ masterVolume: 50, musicVolume: 80, sfxVolume: 20, muted: true });
    expect(off.master).toBe(0);
  });

  it('the engine runs only after a gesture, unmuted and with the tab visible', () => {
    expect(audioShouldRun({ unlocked: true, muted: false, hidden: false })).toBe(true);
    expect(audioShouldRun({ unlocked: false, muted: false, hidden: false })).toBe(false);
    expect(audioShouldRun({ unlocked: true, muted: true, hidden: false })).toBe(false);
    expect(audioShouldRun({ unlocked: true, muted: false, hidden: true })).toBe(false);
  });

  it('limits how often one cue repeats', () => {
    const l = createCueLimiter();
    expect(l.allow('warning', 1000)).toBe(true);
    expect(l.allow('warning', 2000)).toBe(false);
    expect(l.allow('warning', 6001)).toBe(true);
    expect(l.allow('click', 6001)).toBe(true);
    expect(l.allow('click', 6020)).toBe(false);
    expect(l.allow('click', 6050)).toBe(true);
    l.reset();
    expect(l.allow('warning', 6051)).toBe(true);
  });

  it('maps every game event to the right cue', () => {
    const map: Record<GameEventKind, string | null> = {
      card: 'card',
      arrival: 'arrival',
      founded: 'foundSuccess',
      foundFailed: 'foundFailure',
      lowMargin: 'warning',
      won: 'foundSuccess',
      lost: 'foundFailure',
    };
    for (const [k, v] of Object.entries(map)) expect(cueForEvent(k as GameEventKind)).toBe(v);
  });
});

function facts(over: Partial<GameFacts> = {}): GameFacts {
  return { ...createGameFacts(), ...over };
}

function run(seq: GameFacts[]): GameEventKind[][] {
  const d = createGameEventDetector();
  return seq.map((f) => {
    const out: GameEventKind[] = [];
    d.update(f, (k) => out.push(k));
    return out;
  });
}

describe('game event detector', () => {
  it('learns on the first call and fires on increases', () => {
    const r = run([
      facts({ pendingCards: 1, colonies: 2 }),
      facts({ pendingCards: 1, colonies: 2 }),
      facts({ pendingCards: 2, colonies: 2 }),
      facts({ pendingCards: 0, colonies: 3 }),
      facts({ pendingCards: 0, colonies: 3, arrivedShips: 1 }),
      facts({ pendingCards: 0, colonies: 3, arrivedShips: 1, lowMarginShips: 1 }),
    ]);
    expect(r).toEqual([[], [], ['card'], ['founded'], ['arrival'], ['lowMargin']]);
  });

  it('fires foundFailed when a new failed record appears', () => {
    const r = run([
      facts(),
      facts({ failedFoundings: 1, failedKey: 70 }),
      facts({ failedFoundings: 1, failedKey: 70 }),
      facts({ failedFoundings: 1, failedKey: 130 }),
      facts({ failedFoundings: 0, failedKey: 0 }),
    ]);
    expect(r).toEqual([[], ['foundFailed'], [], ['foundFailed'], []]);
  });

  it('fires won or lost once when the run ends', () => {
    expect(
      run([facts(), facts({ outcome: OUTCOME.Won }), facts({ outcome: OUTCOME.Won })]),
    ).toEqual([[], ['won'], []]);
    expect(run([facts(), facts({ outcome: OUTCOME.LostHomeworld })])).toEqual([[], ['lost']]);
    expect(run([facts({ outcome: OUTCOME.Won }), facts({ outcome: OUTCOME.Won })])).toEqual([
      [],
      [],
    ]);
  });

  it('reset makes the next call a fresh start (a new world)', () => {
    const d = createGameEventDetector();
    const out: GameEventKind[] = [];
    d.update(facts({ colonies: 1 }), (k) => out.push(k));
    d.reset();
    d.update(facts({ colonies: 5, pendingCards: 3 }), (k) => out.push(k));
    expect(out).toEqual([]);
  });

  it('says something for every event', () => {
    const kinds: GameEventKind[] = [
      'card',
      'arrival',
      'founded',
      'foundFailed',
      'lowMargin',
      'won',
      'lost',
    ];
    for (const k of kinds) expect(eventAnnouncement(k).length).toBeGreaterThan(10);
    expect(eventAnnouncement('card')).toBe(
      'Event card pending. The game is paused until you answer it.',
    );
  });

  it('reads the facts from a snapshot', () => {
    const snap = createSnapshot();
    snap.meta[META_PENDING_COUNT] = 2;
    snap.meta[META_COLONY_COUNT] = 3;
    snap.meta[META_OUTCOME] = OUTCOME.Running;
    snap.meta[META_SHIP_COUNT] = 4;
    snap.shipState[0] = SHIP_STATE.Arrived;
    snap.shipState[1] = SHIP_STATE.InOrbit;
    snap.shipState[2] = SHIP_STATE.InTransit;
    snap.shipColonists[2] = 10;
    snap.shipMargin[2] = 80; // under 100%: low
    snap.shipState[3] = SHIP_STATE.InTransit;
    snap.shipColonists[3] = 10;
    snap.shipMargin[3] = 140; // fine
    snap.meta[META_EXPEDITION_COUNT] = 1;
    const o = 1 * LR_STRIDE; // expedition 0, slot 1
    expect(LAST_ROLL_SLOTS).toBeGreaterThan(1);
    snap.expeditionRolls[o + LR_KIND] = 2;
    snap.expeditionRolls[o + LR_RESULT] = FoundTier.Failed;
    snap.expeditionRolls[o + LR_DAY] = 9;
    snap.expeditionRolls[o + LR_REGION] = 3;
    const f = createGameFacts();
    readGameFacts(snap, f);
    expect(f).toEqual({
      pendingCards: 2,
      arrivedShips: 2,
      colonies: 3,
      lowMarginShips: 1,
      failedFoundings: 1,
      failedKey: (9 + 1) * 64 + 3 + 1,
      outcome: 0,
    });
  });
});

describe('frame statistics', () => {
  it('is empty at first', () => {
    const s = createFrameStats();
    expect(s.count()).toBe(0);
    expect(s.percentile(50)).toBe(0);
    expect(s.summary()).toBe('p50 - | p95 -');
  });

  it('computes p50 and p95 with 0.5 ms resolution', () => {
    const s = createFrameStats();
    for (let i = 0; i < 95; i++) s.add(16.6);
    for (let i = 0; i < 5; i++) s.add(40);
    expect(s.count()).toBe(100);
    expect(s.percentile(50)).toBe(17);
    expect(s.percentile(95)).toBe(17);
    expect(s.percentile(96)).toBe(40.5);
    expect(s.percentile(100)).toBe(40.5);
    expect(s.summary()).toBe('p50 17.0 | p95 17.0 ms');
  });

  it('keeps only the last frames in the ring and ignores bad values', () => {
    const s = createFrameStats();
    for (let i = 0; i < FRAME_RING; i++) s.add(100);
    for (let i = 0; i < FRAME_RING; i++) s.add(10);
    s.add(NaN);
    s.add(-3);
    s.add(0);
    expect(s.count()).toBe(FRAME_RING);
    expect(s.percentile(100)).toBe(10.5);
    s.reset();
    expect(s.count()).toBe(0);
  });

  it('puts very slow frames in the last bucket', () => {
    const s = createFrameStats();
    s.add(5000);
    expect(s.percentile(50)).toBe(200);
  });
});
