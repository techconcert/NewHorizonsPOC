// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DISTRICT_COST, DISTRICT_DAYS, District } from '../src/shared/colony';
import { getLoggedCommand, replayLogged } from '../src/sim/commands';
import { G_LOG, MAX_REGIONS_PER_PLANET, ShipStateId } from '../src/sim/components';
import { countShips } from '../src/sim/launch';
import { tickDay } from '../src/sim/tick';
import { submit, type World } from '../src/sim/world';
import { addColony, addNatives, setDistrict } from './helpers/colony';
import {
  BuildDistrictFor as build,
  BuildSpaceportFor as port,
  StanceFor as stance,
} from './helpers/colonyCommands';
import { lineWorld, planetOf, send, ticks } from './helpers/transit';

const reason = (r: ReturnType<typeof submit>): string => (r.ok ? 'ACCEPTED' : r.reason);

describe('BuildDistrict', () => {
  it('costs and build days come from the data: 40/40/60/80/80 Production, 10 days; Spaceport 200 and 30', () => {
    expect(DISTRICT_COST).toEqual([0, 40, 40, 60, 80, 80, 200]);
    expect(DISTRICT_DAYS).toEqual([0, 10, 10, 10, 10, 10, 30]);
  });

  it('is refused with a specific reason, checked in order', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, { explored: 3, production: 100 });
    addNatives(w, c, { disposition: 3, homes: [2] });
    setDistrict(w, c, 1, District.Farm);
    expect(reason(submit(w, build(99, 0, 1)))).toBe('NO_SUCH_COLONY');
    expect(reason(submit(w, build(c, 99, 0)))).toBe('INVALID_DISTRICT'); // kind is checked before the region
    expect(reason(submit(w, build(c, 0, 0)))).toBe('INVALID_DISTRICT');
    expect(reason(submit(w, build(c, 0, 6)))).toBe('INVALID_DISTRICT'); // the Spaceport has its own command
    expect(reason(submit(w, build(c, 0, 7)))).toBe('INVALID_DISTRICT');
    expect(reason(submit(w, build(c, 99, 1)))).toBe('INVALID_REGION');
    expect(reason(submit(w, build(c, -1, 1)))).toBe('INVALID_REGION');
    expect(reason(submit(w, build(c, 3, 1)))).toBe('REGION_NOT_EXPLORED'); // visible, not explored
    expect(reason(submit(w, build(c, 4, 1)))).toBe('REGION_NOT_EXPLORED'); // hidden
    expect(reason(submit(w, build(c, 1, 2)))).toBe('DISTRICT_EXISTS');
    expect(reason(submit(w, build(c, 2, 1)))).toBe('NATIVE_REGION');
    s.stockpile.production[c] = 39;
    expect(reason(submit(w, build(c, 0, 1)))).toBe('INSUFFICIENT_PRODUCTION');
    s.stockpile.production[c] = 40;
    expect(reason(submit(w, build(c, 0, 1)))).toBe('ACCEPTED');
    expect(w.queue.count).toBe(1);
  });

  it('pays the Production at once, starts the countdown and logs the command', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, { production: 100 });
    const log0 = s.counts[G_LOG];
    expect(send(w, build(c, 4, District.Refinery))).toEqual({ ok: true });
    expect(s.stockpile.production[c]).toBe(100 - 60);
    expect(s.district.kind[c * MAX_REGIONS_PER_PLANET + 4]).toBe(District.Refinery);
    expect(s.district.left[c * MAX_REGIONS_PER_PLANET + 4]).toBe(10);
    expect(s.counts[G_LOG]).toBe(log0 + 1);
    expect(getLoggedCommand(s, log0)).toEqual(build(c, 4, 3));
  });

  it('two commands for the same region in one batch: the second is dropped at apply time, paid once', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, { production: 100 });
    expect(reason(submit(w, build(c, 0, 1)))).toBe('ACCEPTED');
    expect(reason(submit(w, build(c, 0, 2)))).toBe('ACCEPTED'); // both pass the submit check
    tickDay(w);
    expect(s.district.kind[c * MAX_REGIONS_PER_PLANET]).toBe(District.Farm);
    expect(s.stockpile.production[c]).toBe(100 - 40 + 8);
  });
});

describe('BuildSpaceport and launching from a second colony', () => {
  it('refused when the colony has one (also while one is being built), or cannot pay 200', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, { production: 199 });
    expect(reason(submit(w, port(w.homeColony, 0)))).toBe('SPACEPORT_EXISTS'); // the homeworld has one
    expect(reason(submit(w, port(99, 0)))).toBe('NO_SUCH_COLONY');
    expect(reason(submit(w, port(c, 99)))).toBe('INVALID_REGION');
    expect(reason(submit(w, port(c, 0)))).toBe('INSUFFICIENT_PRODUCTION');
    s.stockpile.production[c] = 200;
    expect(send(w, port(c, 0))).toEqual({ ok: true });
    expect(s.stockpile.production[c]).toBe(0);
    expect(reason(submit(w, port(c, 1)))).toBe('SPACEPORT_EXISTS');
  });

  it('the Spaceport works after 30 days and not a day sooner; then the colony can launch', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, {
      production: 300,
      population: 500,
      supplies: 100000,
      fuel: 1000,
    });
    const launch = {
      type: 'LaunchShip' as const,
      colony: c,
      target: planetOf(w, 3),
      hull: 0,
      passengers: 1,
      supplies: 1,
      fuel: 6,
      speed: 0,
      kit: 0,
      security: 0,
    };
    expect(reason(submit(w, launch))).toBe('NO_SPACEPORT');
    expect(send(w, port(c, 0))).toEqual({ ok: true });
    ticks(w, 29);
    expect(s.colony.spaceport[c]).toBe(0);
    expect(reason(submit(w, launch))).toBe('NO_SPACEPORT');
    tickDay(w);
    expect(s.colony.spaceport[c]).toBe(1);
    const pop = s.colony.population[c] as number;
    expect(send(w, launch)).toEqual({ ok: true });
    expect(countShips(s)).toBe(1);
    expect(s.colony.population[c]).toBe(pop - 20);
    expect(s.stockpile.fuel[c]).toBe(1000 - 600);
    const ship = s.shipState.state.findIndex((v) => v === ShipStateId.InTransit);
    expect(s.shipRoute.originSystem[ship]).toBe(2);
    expect(s.shipManifest.colonists[ship]).toBe(20);
  });
});

describe('SetColonyStance', () => {
  it('sets the stance; refuses unknown colonies and stances', () => {
    const w = lineWorld();
    const c = addColony(w);
    expect(reason(submit(w, stance(99, 1)))).toBe('NO_SUCH_COLONY');
    expect(reason(submit(w, stance(c, 3)))).toBe('INVALID_STANCE');
    expect(reason(submit(w, stance(c, -1)))).toBe('INVALID_STANCE');
    expect(send(w, stance(c, 2))).toEqual({ ok: true });
    expect(w.stores.colony.nativeStance[c]).toBe(2);
    expect(send(w, stance(c, 0))).toEqual({ ok: true });
    expect(w.stores.colony.nativeStance[c]).toBe(0);
  });
});

describe('colony commands replay from the log', () => {
  function script(w: World, c: number, day: number): void {
    if (day === 0) send(w, build(c, 0, District.Farm));
    if (day === 3) send(w, build(c, 1, District.Research));
    if (day === 5) send(w, stance(c, 1));
    if (day === 12) send(w, port(c, 2));
    if (day === 20) send(w, { type: 'ChooseTech', tech: 6 });
  }
  const make = (): { w: World; c: number } => {
    const w = lineWorld(11);
    const c = addColony(w, { production: 400, population: 500, supplies: 100000 });
    return { w, c };
  };

  it('seed + log reproduces the same hash on every day', () => {
    const live = make();
    const liveHashes: number[] = [];
    for (let day = 0; day < 80; day++) {
      script(live.w, live.c, day);
      tickDay(live.w);
      liveHashes.push(live.w.stores.run.stateHash[0] as number);
    }
    const n = live.w.stores.counts[G_LOG] as number;
    expect(n).toBe(5);
    const replay = make();
    const replayHashes: number[] = [];
    let next = 0;
    for (let day = 0; day < 80; day++) {
      while (next < n && live.w.stores.log.day[next] === day)
        replayLogged(replay.w, live.w.stores, next++);
      tickDay(replay.w);
      replayHashes.push(replay.w.stores.run.stateHash[0] as number);
    }
    expect(replayHashes).toEqual(liveHashes);
    expect(new Set(liveHashes).size).toBeGreaterThan(70);
  });
});
