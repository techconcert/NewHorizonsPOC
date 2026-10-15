// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { COMMAND_TYPES } from '../src/shared/commands';
import {
  TYPE_CODE,
  COMMAND_FIELDS,
  getLoggedCommand,
  SPEED_LOG_RESERVE,
  validateCommand,
} from '../src/sim/commands';
import { COMMAND_LOG_CAPACITY, G_LOG } from '../src/sim/components';
import { tickDay } from '../src/sim/tick';
import { createWorld, submit } from '../src/sim/world';

describe('command validation', () => {
  it('rejects unknown and malformed commands with a reason', () => {
    const w = createWorld(1);
    expect(submit(w, { type: 'Nope' })).toEqual({ ok: false, reason: 'UNKNOWN_COMMAND' });
    expect(submit(w, null)).toEqual({ ok: false, reason: 'UNKNOWN_COMMAND' });
    expect(submit(w, 'LaunchShip')).toEqual({ ok: false, reason: 'UNKNOWN_COMMAND' });
    expect(submit(w, { type: 'ReEmbark' })).toEqual({ ok: false, reason: 'INVALID_SHAPE' });
    expect(submit(w, { type: 'ReEmbark', expedition: 1.5 })).toEqual({
      ok: false,
      reason: 'INVALID_SHAPE',
    });
    expect(submit(w, { type: 'SetGameSpeed', speed: 3 })).toEqual({
      ok: false,
      reason: 'INVALID_SPEED',
    });
  });

  it('every command type is implemented: a well-formed command reaches its state checks (never NOT_IMPLEMENTED_YET)', () => {
    const w = createWorld(1);
    const samples: Record<string, unknown> = {
      LaunchShip: {
        colony: 1,
        target: 1,
        hull: 0,
        passengers: 1,
        supplies: 1,
        fuel: 1,
        speed: 0,
        kit: 0,
        security: 0,
      },
      RerouteShip: { ship: 1, target: 1 },
      FormExpedition: { ship: 1, explorers: 1, guards: 0, supplies: 1, kit: 0, stance: 1 },
      ExploreRegion: { expedition: 1, region: 1, region2: -1 },
      FoundColony: { expedition: 1, region: 1 },
      ReEmbark: { expedition: 1 },
      SetColonyStance: { colony: 99, stance: 0 },
      BuildDistrict: { colony: 99, region: 1, district: 1 },
      BuildSpaceport: { colony: 99, region: 1 },
      ChooseTech: { tech: 99 },
      SetGameSpeed: { speed: 1 },
      ResolveEventChoice: { card: 0, choice: 0, ship: 1 },
    };
    for (const type of COMMAND_TYPES) {
      const r = submit(w, { type, ...(samples[type] as object) });
      if (!r.ok) expect(r.reason).not.toBe('NOT_IMPLEMENTED_YET');
    }
    expect(submit(w, { type: 'SetColonyStance', colony: 99, stance: 0 })).toEqual({
      ok: false,
      reason: 'NO_SUCH_COLONY',
    });
    expect(submit(w, { type: 'ChooseTech', tech: 99 })).toEqual({
      ok: false,
      reason: 'INVALID_TECH',
    });
  });

  it('SetGameSpeed is queued, applied at the start of the next tick, and logged', () => {
    const w = createWorld(1);
    expect(submit(w, { type: 'SetGameSpeed', speed: 4 })).toEqual({ ok: true });
    expect(w.stores.run.speed[0]).toBe(1); // not yet applied
    tickDay(w);
    expect(w.stores.run.speed[0]).toBe(4);
    expect(w.stores.counts[G_LOG]).toBe(1);
    expect(w.stores.log.day[0]).toBe(0);
    expect(getLoggedCommand(w.stores, 0)).toEqual({ type: 'SetGameSpeed', speed: 4 });
  });

  it('applies queued commands in submission order', () => {
    const w = createWorld(1);
    submit(w, { type: 'SetGameSpeed', speed: 2 });
    submit(w, { type: 'SetGameSpeed', speed: 0 });
    tickDay(w);
    expect(w.stores.run.speed[0]).toBe(0);
    // Two speed changes on the same day collapse into one log entry holding the last speed (D-108).
    expect(w.stores.counts[G_LOG]).toBe(1);
    expect(getLoggedCommand(w.stores, 0)).toEqual({ type: 'SetGameSpeed', speed: 0 });
  });

  it('a speed command on another day is a new log entry', () => {
    const w = createWorld(1);
    submit(w, { type: 'SetGameSpeed', speed: 2 });
    tickDay(w);
    submit(w, { type: 'SetGameSpeed', speed: 4 });
    tickDay(w);
    expect(w.stores.counts[G_LOG]).toBe(2);
  });

  it('a command that changes nothing is accepted but neither queued nor logged', () => {
    const w = createWorld(1);
    expect(w.stores.run.speed[0]).toBe(1);
    expect(submit(w, { type: 'SetGameSpeed', speed: 1 })).toEqual({ ok: true });
    expect(w.queue.count).toBe(0);
    expect(submit(w, { type: 'ChooseTech', tech: 0 })).toEqual({ ok: true });
    expect(w.queue.count).toBe(1);
    tickDay(w);
    expect(w.stores.counts[G_LOG]).toBe(1);
    // The same tech again: nothing to do.
    expect(submit(w, { type: 'ChooseTech', tech: 0 })).toEqual({ ok: true });
    expect(w.queue.count).toBe(0);
    tickDay(w);
    expect(w.stores.counts[G_LOG]).toBe(1);
  });

  it('the queue is a bounded ring buffer', () => {
    const w = createWorld(1);
    let rejected = 0;
    for (let i = 0; i < 300; i++) {
      const r = submit(w, { type: 'SetGameSpeed', speed: 2 });
      if (!r.ok && r.reason === 'QUEUE_FULL') rejected++;
    }
    expect(rejected).toBe(44);
    tickDay(w);
    expect(submit(w, { type: 'SetGameSpeed', speed: 1 }).ok).toBe(true);
  });

  it('validateCommand is pure (does not enqueue)', () => {
    const w = createWorld(1);
    expect(validateCommand({ type: 'SetGameSpeed', speed: 2 })).toEqual({ ok: true });
    expect(w.queue.count).toBe(0);
  });

  it('every command type has a code and a field list', () => {
    const codes = new Set<number>();
    for (const type of COMMAND_TYPES) {
      expect(typeof TYPE_CODE[type]).toBe('number');
      expect(COMMAND_FIELDS[type] === undefined).toBe(false);
      codes.add(TYPE_CODE[type] as number);
    }
    expect(codes.size).toBe(COMMAND_TYPES.length);
  });

  it('the log stores commands in a serializable form and round-trips them', () => {
    const w = createWorld(1);
    submit(w, { type: 'SetGameSpeed', speed: 2 });
    tickDay(w);
    const entry = getLoggedCommand(w.stores, 0);
    expect(JSON.parse(JSON.stringify(entry))).toEqual({ type: 'SetGameSpeed', speed: 2 });
  });

  it('a full log rejects with LOG_FULL instead of dropping silently', () => {
    const w = createWorld(1);
    let accepted = 0;
    let reason = '';
    // Alternate two root techs so every choice changes something and is logged.
    for (let tick = 0; tick < 100 && reason === ''; tick++) {
      for (let i = 0; i < 256; i++) {
        const r = submit(w, { type: 'ChooseTech', tech: (accepted + 1) % 2 === 0 ? 3 : 0 });
        if (r.ok) accepted++;
        else {
          reason = r.reason;
          break;
        }
      }
      tickDay(w);
    }
    expect(reason).toBe('LOG_FULL');
    // The last SPEED_LOG_RESERVE slots are kept for speed commands (D-108).
    expect(accepted).toBe(COMMAND_LOG_CAPACITY - SPEED_LOG_RESERVE);
    expect(w.stores.counts[G_LOG]).toBe(COMMAND_LOG_CAPACITY - SPEED_LOG_RESERVE);
  });

  it('speed commands are never refused with LOG_FULL, even with the log full of other entries', () => {
    const w = createWorld(1);
    for (let tick = 0; tick < 100; tick++) {
      for (let i = 0; i < 256; i++) {
        if (!submit(w, { type: 'ChooseTech', tech: i % 2 === 0 ? 3 : 0 }).ok) break;
      }
      tickDay(w);
    }
    expect(w.stores.counts[G_LOG]).toBe(COMMAND_LOG_CAPACITY - SPEED_LOG_RESERVE);
    // Alternate speeds on separate days: each is logged, none is refused, and the log never overruns.
    for (let d = 0; d < 200; d++) {
      expect(submit(w, { type: 'SetGameSpeed', speed: d % 2 === 0 ? 2 : 4 }).ok).toBe(true);
      tickDay(w);
    }
    expect(w.stores.counts[G_LOG]).toBe(COMMAND_LOG_CAPACITY);
    expect(w.stores.run.speed[0]).toBe(4);
  });

  it('a null item in the ring buffer throws an invariant error', () => {
    const w = createWorld(1);
    w.queue.count = 1; // corrupt: count says 1 but the slot is null
    expect(() => tickDay(w)).toThrow(/invariant/);
  });
});
