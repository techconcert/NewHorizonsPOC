// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ExpeditionStatus,
  FR_SURVIVORS,
  LR_AMBUSH_CHANCE,
  LR_AMBUSH_ROLL,
  LR_REGION,
  LR_SPLIT,
  LR_TEAM_SIZE,
} from '../src/shared/planetfall';
import {
  EXPEDITION_STRIDE,
  X_ENTITY,
  X_FOUND_HI,
  X_FOUND_LO,
  X_NATIVES_MET,
  X_NATIVES_PCT,
  createSnapshot,
  META_EXPEDITION_COUNT,
} from '../src/shared/snapshot';
import { getLoggedCommand, replayLogged } from '../src/sim/commands';
import { G_ENTITY, G_LOG, LostReason, ShipStateId } from '../src/sim/components';
import { pendingCount, queueExpeditionCard } from '../src/sim/events';
import { fillSnapshot } from '../src/worker/fill';
import {
  answerCards,
  arrivedShip,
  explore,
  finishRound,
  form,
  found,
  rollRecord,
  send,
  tickDay,
  type Landing,
} from './helpers/planetfall';
import { addShip, stage } from './helpers/transit';

const natives = (L: Landing, disp: number, strength: number, mask: number): void => {
  const s = L.w.stores;
  s.native.disposition[L.planet] = disp;
  s.native.strength[L.planet] = strength;
  s.native.homeRegionMask[L.planet] = mask;
};

describe('split rounds survive a shrinking team', () => {
  it('a team that fell to one explorer mid-round rolls the first region alone, not split', () => {
    const L = arrivedShip(5, { kit: 8 });
    const s = L.w.stores;
    const e = form(L, { explorers: 4, supplies: 3000, kit: 8 });
    expect(explore(L.w, e, 0, 1)).toEqual({ ok: true });
    for (let i = 0; i < 3; i++) tickDay(L.w);
    s.expeditionTeam.explorers[e] = 1; // illness, starvation, anything
    finishRound(L.w, e);
    const a = rollRecord(L.w, e, 0);
    const b = rollRecord(L.w, e, 1);
    expect([a[LR_REGION], a[LR_TEAM_SIZE], a[LR_SPLIT]]).toEqual([0, 1, 0]);
    expect(b[0]).toBe(0); // no second roll
    expect(s.region.fog[L.base + 1]).toBe(1); // the second region stays unexplored
  });

  it('a team of 2 splits into 1 and 1; no roll is made for a team of 0', () => {
    const L = arrivedShip(5, { kit: 8 });
    const e = form(L, { explorers: 4, supplies: 3000, kit: 8 });
    expect(explore(L.w, e, 0, 1)).toEqual({ ok: true });
    for (let i = 0; i < 3; i++) tickDay(L.w);
    L.w.stores.expeditionTeam.explorers[e] = 2;
    finishRound(L.w, e);
    expect(rollRecord(L.w, e, 0)[LR_TEAM_SIZE]).toBe(1);
    expect(rollRecord(L.w, e, 1)[LR_TEAM_SIZE]).toBe(1);
  });
});

describe('Bold names its second region, or gets an auto-pick that avoids native homes', () => {
  it('auto-pick: the lowest visible region that is not a native home (home regions 1 and 2 are skipped)', () => {
    const L = arrivedShip(5, { kit: 8 });
    natives(L, 3, 50, 0b110); // regions 1 and 2 are home; 0, 8, 9 are the other visible ones
    const e = form(L, { stance: 2, explorers: 100, supplies: 3000, kit: 8 });
    expect(explore(L.w, e, 1)).toEqual({ ok: true });
    finishRound(L.w, e);
    expect(rollRecord(L.w, e, 1)[LR_REGION]).toBe(0);
  });

  it('auto-pick falls back to a native home when every other visible region is one', () => {
    const L = arrivedShip(5, { kit: 8 });
    natives(L, 3, 50, (1 << 14) - 1); // every region is a home
    const e = form(L, { stance: 2, explorers: 100, supplies: 3000, kit: 8 });
    expect(explore(L.w, e, 9)).toEqual({ ok: true });
    finishRound(L.w, e);
    expect(rollRecord(L.w, e, 1)[LR_REGION]).toBe(0);
  });

  it('region2 is part of the command log and replays to the same hashes', () => {
    const run = (): { L: Landing; hashes: number[] } => {
      const L = arrivedShip(5, { kit: 8 });
      const hashes: number[] = [];
      const e = form(L, { stance: 2, explorers: 100, supplies: 3000, kit: 8 });
      expect(explore(L.w, e, 0, 8)).toEqual({ ok: true });
      for (let i = 0; i < 12; i++) {
        tickDay(L.w);
        hashes.push(L.w.stores.run.stateHash[0]);
      }
      return { L, hashes };
    };
    const a = run();
    const src = a.L.w.stores;
    // Log: FormExpedition (code 3), ExploreRegion (code 4) with region 0 and region2 8.
    expect(src.counts[G_LOG]).toBe(2);
    expect(getLoggedCommand(src, 1)).toEqual({
      type: 'ExploreRegion',
      expedition: a.L.w.stores.counts[G_ENTITY] - 1,
      region: 0,
      region2: 8,
    });
    // Replay from the same landing: apply the logged entries on their day, then tick.
    const B = arrivedShip(5, { kit: 8 });
    const hashes: number[] = [];
    let next = 0;
    for (let i = 0; i < 12; i++) {
      while (next < 2 && src.log.day[next] === B.w.stores.run.day[0])
        replayLogged(B.w, src, next++);
      tickDay(B.w);
      hashes.push(B.w.stores.run.stateHash[0]);
    }
    expect(next).toBe(2);
    expect(hashes).toEqual(a.hashes);
    const second = a.L.w.stores.expeditionRoll.rec;
    expect(second.length).toBeGreaterThan(0);
  });
});

describe('natives: Wary only watch, contact is never an ambush, no orphan cards', () => {
  it('Wary natives met in an earlier round never roll an ambush', () => {
    const L = arrivedShip(5, { kit: 8 });
    const s = L.w.stores;
    natives(L, 2, 90, 0b11); // regions 0 and 1, strongest natives
    const e = form(L, { explorers: 100, supplies: 3000, kit: 8 });
    explore(L.w, e, 0);
    finishRound(L.w, e);
    expect(s.pendingEventCard.card[0]).toBe(13); // Watchers on the ridge
    answerCards(L.w, 0);
    explore(L.w, e, 1);
    finishRound(L.w, e);
    const r = rollRecord(L.w, e);
    expect([r[LR_AMBUSH_CHANCE], r[LR_AMBUSH_ROLL]]).toEqual([0, -1]);
    expect(s.expeditionTeam.explorers[e]).toBeGreaterThan(80);
  });

  it('a roll that kills the last explorer in a native home region reveals the natives but queues no card', () => {
    // Seed 26: the lone explorer meets a hazard of the death kind on the contact roll.
    const L = arrivedShip(26, { kit: 8 });
    const s = L.w.stores;
    natives(L, 1, 50, 0b1);
    const e = form(L, { explorers: 1, supplies: 100, kit: 8 });
    explore(L.w, e, 0);
    finishRound(L.w, e);
    expect(s.expedition.status[e]).toBe(ExpeditionStatus.Dead);
    expect(s.native.revealed[L.planet]).toBe(1);
    expect(pendingCount(L.w)).toBe(0);
  });

  it('a card that reveals a native home region makes contact there (and queues the contact card)', () => {
    const L = arrivedShip(5, { kit: 8 });
    const s = L.w.stores;
    natives(L, 1, 50, 0b1); // region 0 is home and the lowest visible region
    const e = form(L, { explorers: 100, supplies: 3000, kit: 8 });
    queueExpeditionCard(L.w, e, 12); // "Guides offered": accept reveals the lowest visible region
    expect(s.native.revealed[L.planet]).toBe(0);
    expect(send(L.w, { type: 'ResolveEventChoice', card: 0, choice: 0, ship: e })).toEqual({
      ok: true,
    });
    expect(s.region.fog[L.base]).toBe(3); // region 0 explored by the card
    expect(s.native.revealed[L.planet]).toBe(1);
    expect(pendingCount(L.w)).toBe(1);
    expect(s.pendingEventCard.card[0]).toBe(12); // the Peaceful contact card
    expect(s.expedition.status[e]).toBe(ExpeditionStatus.Event);
  });

  it('two cards in one roll queue in order; with 7 already waiting only the first fits (no crash)', () => {
    // Seed 4, Ruins home region of Peaceful natives: contact card 12, then the mystery card 26 (lost_trail, since M7a).
    const make = (): Landing => {
      const L = arrivedShip(4, { kit: 8 });
      natives(L, 1, 50, 0b1);
      L.w.stores.region.terrain[L.base] = 5;
      return L;
    };
    const L1 = make();
    const e1 = form(L1, { explorers: 100, supplies: 3000, kit: 8, stance: 0 });
    explore(L1.w, e1, 0);
    finishRound(L1.w, e1);
    expect(pendingCount(L1.w)).toBe(2);
    expect([L1.w.stores.pendingEventCard.card[0], L1.w.stores.pendingEventCard.card[1]]).toEqual([
      12, 26,
    ]);

    const L2 = make();
    const e2 = form(L2, { explorers: 100, supplies: 3000, kit: 8, stance: 0 });
    for (let i = 0; i < 7; i++) {
      const ship = addShip(L2.w, { dest: 2 });
      stage(L2.w, ship, i % 3);
    }
    expect(pendingCount(L2.w)).toBe(7);
    explore(L2.w, e2, 0);
    finishRound(L2.w, e2);
    expect(pendingCount(L2.w)).toBe(8);
    expect(L2.w.stores.pendingEventCard.card[7]).toBe(12);
    expect(L2.w.stores.pendingEventCard.subject[7]).toBe(e2);
  });
});

describe('snapshot natives factor: unmet natives show a range, met natives the exact factor', () => {
  const row = (L: Landing, e: number) => {
    const snap = createSnapshot();
    fillSnapshot(L.w, snap, 0);
    const n = snap.meta[META_EXPEDITION_COUNT];
    for (let i = 0; i < n; i++) {
      const o = i * EXPEDITION_STRIDE;
      if (snap.expeditions[o + X_ENTITY] === e) {
        return {
          lo: snap.expeditions[o + X_FOUND_LO],
          hi: snap.expeditions[o + X_FOUND_HI],
          met: snap.expeditions[o + X_NATIVES_MET],
          nat: snap.expeditions[o + X_NATIVES_PCT],
        };
      }
    }
    throw new Error('no expedition row');
  };

  it('unmet: the worst natives case lowers the low end and the high end stays; met: one exact value', () => {
    const L = arrivedShip(5, { kit: 8 });
    natives(L, 3, 50, 0b10);
    const e = form(L, { explorers: 100, supplies: 8000, kit: 8, guards: 0 });
    const unmet = row(L, e);
    expect(unmet.met).toBe(0);
    expect(unmet.nat).toBe(65); // Hostile 80 less 15 at their home
    expect(unmet.lo).toBeLessThan(unmet.hi);
    // The preview now reveals no more than the launch band: the high end is the no-natives chance.
    natives(L, 0, 0, 0);
    const none = row(L, e);
    expect([none.lo, none.hi]).toEqual([unmet.lo, unmet.hi]);
    // Met Hostile natives: exact for each explored site (here the landing zone is not their home).
    natives(L, 3, 50, 0b10);
    L.w.stores.native.revealed[L.planet] = 1;
    const met = row(L, e);
    expect(met.met).toBe(1);
    expect(met.nat).toBe(80);
    expect(met.hi).toBeLessThan(unmet.hi);
    expect(met.lo).toBeLessThanOrEqual(met.hi);
  });
});

describe('food: ships in orbit and guards', () => {
  it('a parked ship with no supplies starves by 10% of its colonists a day and is Lost at zero', () => {
    const L = arrivedShip(5, { colonists: 400 });
    const s = L.w.stores;
    s.shipManifest.supplies[L.ship] = 0;
    const seen: number[] = [];
    let days = 0;
    while (s.shipState.state[L.ship] !== ShipStateId.Lost && days < 200) {
      tickDay(L.w);
      days++;
      if (days <= 6) seen.push(s.shipManifest.colonists[L.ship]);
    }
    expect(seen).toEqual([360, 324, 291, 261, 234, 210]);
    expect(s.shipState.state[L.ship]).toBe(ShipStateId.Lost);
    expect(s.shipLog.lostReason[L.ship]).toBe(LostReason.AllDead);
    expect(days).toBe(PARKED_DAYS_TO_LOSS);
  });

  it('depot starvation: the ship is Lost, the expedition goes on; Found still works, ReEmbark says SHIP_LOST', () => {
    const L = arrivedShip(5, { colonists: 400, kit: 8 });
    const s = L.w.stores;
    const e = form(L, { explorers: 100, supplies: 8000, kit: 8 });
    s.shipManifest.supplies[L.ship] = 0;
    for (let i = 0; i < PARKED_DAYS_TO_LOSS + 5; i++) tickDay(L.w);
    expect(s.shipState.state[L.ship]).toBe(ShipStateId.Lost);
    expect(s.expedition.status[e]).toBe(ExpeditionStatus.Active);
    expect(send(L.w, { type: 'ReEmbark', expedition: e })).toEqual({
      ok: false,
      reason: 'SHIP_LOST',
    });
    const fed = s.expeditionTeam.explorers[e];
    expect(found(L.w, e, L.lz)).toEqual({ ok: true });
    const r = rollRecord(L.w, e);
    // Only the team on the ground can settle; nothing from the dead depot.
    expect(r[FR_SURVIVORS]).toBeLessThanOrEqual(fed);
    expect(r[FR_SURVIVORS]).toBeGreaterThan(0);
  });

  it('guards neither eat nor count as colonists, but settle with the colony', () => {
    const L = arrivedShip(3, { colonists: 400, supplies: 20000, kit: 8, security: 10 });
    const s = L.w.stores;
    const e = form(L, { explorers: 20, guards: 10, supplies: 1000, kit: 0 });
    for (let i = 0; i < 3; i++) tickDay(L.w);
    expect(s.expeditionTeam.supplies[e]).toBe(1000 - 3 * 20);
    expect(s.expeditionTeam.guards[e]).toBe(10);
    const depot = s.shipManifest.colonists[L.ship];
    expect(found(L.w, e, L.lz)).toEqual({ ok: true });
    const colony = s.planet.owner[L.planet];
    if (colony >= 0) expect(s.colony.population[colony]).toBe(20 + depot + 10);
    else expect(rollRecord(L.w, e)[FR_SURVIVORS]).toBeLessThanOrEqual(20);
  });
});

const PARKED_DAYS_TO_LOSS = 41; // 400 colonists, 10% of the unfed (rounded up) a day
