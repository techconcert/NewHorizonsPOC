// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ExpeditionStatus } from '../src/shared/planetfall';
import { G_ENTITY, MAX_ENTITIES, MAX_LIVE_EXPEDITIONS, ShipStateId } from '../src/sim/components';
import {
  arrivedShip,
  explore,
  finishRound,
  form,
  found,
  send,
  tickDay,
  type Landing,
} from './helpers/planetfall';
import { addShip, planetOf } from './helpers/transit';

const formCmd = (L: Landing, over: Record<string, number> = {}) =>
  send(L.w, {
    type: 'FormExpedition',
    ship: L.ship,
    explorers: 100,
    guards: 0,
    supplies: 3000,
    kit: 4,
    stance: 1,
    ...over,
  });

describe('FormExpedition refusals, in the sim order', () => {
  it('ship checks: unknown, not a ship, Lost, flying, drifting, waiting on a card', () => {
    const L = arrivedShip(5);
    const s = L.w.stores;
    expect(formCmd(L, { ship: 999 })).toEqual({ ok: false, reason: 'NO_SUCH_SHIP' });
    expect(formCmd(L, { ship: 0 })).toEqual({ ok: false, reason: 'NO_SUCH_SHIP' }); // the homeworld colony
    const flying = addShip(L.w, { dest: 1 });
    expect(formCmd(L, { ship: flying })).toEqual({ ok: false, reason: 'SHIP_NOT_ARRIVED' });
    for (const state of [ShipStateId.Drifting, ShipStateId.Event]) {
      s.shipState.state[flying] = state;
      expect(formCmd(L, { ship: flying }), String(state)).toEqual({
        ok: false,
        reason: 'SHIP_NOT_ARRIVED',
      });
    }
    s.shipState.state[flying] = ShipStateId.Lost;
    expect(formCmd(L, { ship: flying })).toEqual({ ok: false, reason: 'SHIP_LOST' });
  });

  it('PLANET_OWNED, EXPEDITION_EXISTS, INVALID_STANCE, INVALID_EXPEDITION, NO_EXPLORERS', () => {
    const L = arrivedShip(5);
    const s = L.w.stores;
    expect(formCmd(L, { stance: 3 })).toEqual({ ok: false, reason: 'INVALID_STANCE' });
    expect(formCmd(L, { stance: -1 })).toEqual({ ok: false, reason: 'INVALID_STANCE' });
    expect(formCmd(L, { supplies: -5 })).toEqual({ ok: false, reason: 'INVALID_EXPEDITION' });
    expect(formCmd(L, { guards: -1 })).toEqual({ ok: false, reason: 'INVALID_EXPEDITION' });
    expect(formCmd(L, { explorers: 0 })).toEqual({ ok: false, reason: 'NO_EXPLORERS' });
    s.planet.owner[L.planet] = 1;
    expect(formCmd(L)).toEqual({ ok: false, reason: 'PLANET_OWNED' });
    s.planet.owner[L.planet] = -1;
    expect(formCmd(L)).toEqual({ ok: true });
    expect(formCmd(L)).toEqual({ ok: false, reason: 'EXPEDITION_EXISTS' });
  });

  it('INSUFFICIENT_* against what the ship carries (400 colonists, 6 security, 4 kit, supplies aboard)', () => {
    const L = arrivedShip(5);
    const aboard = L.w.stores.shipManifest.supplies[L.ship];
    expect(formCmd(L, { explorers: 401 })).toEqual({ ok: false, reason: 'INSUFFICIENT_COLONISTS' });
    expect(formCmd(L, { guards: 7 })).toEqual({ ok: false, reason: 'INSUFFICIENT_SECURITY' });
    expect(formCmd(L, { kit: 5 })).toEqual({ ok: false, reason: 'INSUFFICIENT_KIT' });
    expect(formCmd(L, { supplies: aboard + 1 })).toEqual({
      ok: false,
      reason: 'INSUFFICIENT_SUPPLIES',
    });
    expect(formCmd(L, { explorers: 400, guards: 6, kit: 4, supplies: aboard })).toEqual({
      ok: true,
    });
    const man = L.w.stores.shipManifest;
    expect([
      man.colonists[L.ship],
      man.security[L.ship],
      man.kit[L.ship],
      man.supplies[L.ship],
    ]).toEqual([0, 0, 0, 0]);
  });

  it(`EXPEDITION_LIMIT: ${MAX_LIVE_EXPEDITIONS} expeditions on the ground, the next ship is refused`, () => {
    const L = arrivedShip(5);
    const ships = [L.ship];
    for (let i = 1; i <= MAX_LIVE_EXPEDITIONS; i++) ships.push(addShip(L.w, { dest: 1 }));
    for (let d = 0; d < 20; d++) tickDay(L.w);
    for (const sh of ships) expect(L.w.stores.shipState.state[sh]).toBe(ShipStateId.Arrived);
    for (let i = 0; i < MAX_LIVE_EXPEDITIONS; i++) {
      expect(formCmd({ ...L, ship: ships[i] }, { explorers: 10, supplies: 100, kit: 0 })).toEqual({
        ok: true,
      });
    }
    expect(
      formCmd(
        { ...L, ship: ships[MAX_LIVE_EXPEDITIONS] },
        { explorers: 10, supplies: 100, kit: 0 },
      ),
    ).toEqual({ ok: false, reason: 'EXPEDITION_LIMIT' });
    // One expedition ending (re-embark) frees a place.
    const first = L.w.stores.counts[G_ENTITY] - MAX_LIVE_EXPEDITIONS;
    expect(send(L.w, { type: 'ReEmbark', expedition: first })).toEqual({ ok: true });
    expect(
      formCmd(
        { ...L, ship: ships[MAX_LIVE_EXPEDITIONS] },
        { explorers: 10, supplies: 100, kit: 0 },
      ),
    ).toEqual({ ok: true });
  });

  it('ENTITY_LIMIT: no entity id left for the expedition', () => {
    const L = arrivedShip(5);
    const s = L.w.stores;
    const used = s.counts[G_ENTITY];
    s.counts[G_ENTITY] = MAX_ENTITIES;
    expect(formCmd(L)).toEqual({ ok: false, reason: 'ENTITY_LIMIT' });
    s.counts[G_ENTITY] = used;
    expect(formCmd(L)).toEqual({ ok: true });
  });
});

describe('re-embarking, rerouting and landing again', () => {
  it('ReEmbark leaves the ship Arrived: a new expedition can land at once; the ship can also leave', () => {
    const L = arrivedShip(5, { kit: 8 });
    const s = L.w.stores;
    const first = form(L, { explorers: 100, supplies: 3000, kit: 8 });
    // With the expedition out the ship may not leave.
    expect(send(L.w, { type: 'RerouteShip', ship: L.ship, target: planetOf(L.w, 2) })).toEqual({
      ok: false,
      reason: 'EXPEDITION_ACTIVE',
    });
    expect(send(L.w, { type: 'ReEmbark', expedition: first })).toEqual({ ok: true });
    expect(s.shipState.state[L.ship]).toBe(ShipStateId.Arrived);
    expect(s.expedition.status[first]).toBe(ExpeditionStatus.Returned);
    // Land again with a different stance.
    const second = form(L, { explorers: 50, supplies: 1000, kit: 2, stance: 0 });
    expect(second).not.toBe(first);
    expect(s.expedition.status[second]).toBe(ExpeditionStatus.Active);
    expect(send(L.w, { type: 'ReEmbark', expedition: second })).toEqual({ ok: true });
    // Or fly on: no expedition out, the reroute is accepted and the ship is under way.
    expect(send(L.w, { type: 'RerouteShip', ship: L.ship, target: planetOf(L.w, 2) })).toEqual({
      ok: true,
    });
    expect(s.shipState.state[L.ship]).toBe(ShipStateId.InTransit);
    expect(s.shipRoute.destPlanet[L.ship]).toBe(planetOf(L.w, 2));
  });

  it('a ship that never landed anyone may reroute from orbit too (no expedition is forced)', () => {
    const L = arrivedShip(5);
    expect(send(L.w, { type: 'RerouteShip', ship: L.ship, target: planetOf(L.w, 2) })).toEqual({
      ok: true,
    });
    expect(L.w.stores.shipState.state[L.ship]).toBe(ShipStateId.InTransit);
  });
});

describe('two expeditions on one planet', () => {
  it('they share the fog; the second Found is refused once the first colony stands', () => {
    // Seed 19: region 0 is explored and then the first expedition founds a colony on its roll.
    const L = arrivedShip(19, { kit: 8 });
    const s = L.w.stores;
    const other = addShip(L.w, { dest: 1, colonists: 400, supplies: 20000, kit: 8, security: 6 });
    for (let d = 0; d < 20; d++) tickDay(L.w);
    const eA = form(L, { explorers: 100, supplies: 3000, kit: 8 });
    const eB = form({ ...L, ship: other }, { explorers: 100, supplies: 3000, kit: 8 });
    // A explores region 0: B sees it explored.
    expect(explore(L.w, eA, 0)).toEqual({ ok: true });
    finishRound(L.w, eA);
    expect(s.region.fog[L.base]).toBe(3);
    expect(explore(L.w, eB, 0)).toEqual({ ok: false, reason: 'ALREADY_EXPLORED' });
    expect(found(L.w, eA, L.lz)).toEqual({ ok: true });
    expect(s.expedition.status[eA]).toBe(ExpeditionStatus.Founded);
    expect(found(L.w, eB, L.lz)).toEqual({ ok: false, reason: 'PLANET_OWNED' });
    // B's ship cannot land a new party here either.
    expect(send(L.w, { type: 'ReEmbark', expedition: eB })).toEqual({ ok: true });
    expect(formCmd({ ...L, ship: other })).toEqual({ ok: false, reason: 'PLANET_OWNED' });
  });
});
