// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FOG_EXPLORED, FOG_HIDDEN, FOG_VISIBLE } from '../src/shared/fog';
import { ExpeditionStatus } from '../src/shared/planetfall';
import { nthParkedShipRowAt, parkedShipCountAt } from '../src/shared/planetSnapshot';
import {
  EXPEDITION_STRIDE,
  META_EXPEDITION_COUNT,
  META_SHIP_COUNT,
  X_EXPLORERS,
  X_STATUS,
  createSnapshot,
  type Snapshot,
} from '../src/shared/snapshot';
import {
  FOG_EXPLORED as SIM_EXPLORED,
  FOG_HIDDEN as SIM_HIDDEN,
  FOG_VISIBLE as SIM_VISIBLE,
} from '../src/sim/planet';
import { NATIVE_HOME_NOTE, buildExplorePlan, splitAvailable } from '../src/ui/expeditionModel';
import { isFrontier, regionInfo } from '../src/ui/planetRegions';
import {
  closePlanet,
  createPlanetContext,
  createPlanetSession,
  fillPlanetContext,
  openPlanet,
  pickShip,
  reconcile,
  setSplit,
} from '../src/ui/planetSession';
import { fillSnapshot } from '../src/worker/fill';
import { arrivedShip, form, type Landing } from './helpers/planetfall';

function snapOf(L: Landing): Snapshot {
  const s = createSnapshot();
  fillSnapshot(L.w, s, 0);
  return s;
}

function frontierOf(snap: Snapshot, planet: number): number {
  const start = snap.planetRegionStart[planet];
  for (let i = 0; i < snap.planetRegionCount[planet]; i++) {
    if (isFrontier(snap.regionFog[start + i])) return i;
  }
  return -1;
}

/** Make ship row 0 a second, different parked ship at the same planet (row 1). */
function addSecondShip(snap: Snapshot): number {
  const extra = snap.shipEntity[0] + 1000;
  snap.shipEntity[1] = extra;
  snap.shipState[1] = snap.shipState[0];
  snap.shipDest[1] = snap.shipDest[0];
  snap.meta[META_SHIP_COUNT] = 2;
  return extra;
}

describe('fog constants', () => {
  it('shared fog values equal the sim values', () => {
    expect(FOG_HIDDEN).toBe(SIM_HIDDEN);
    expect(FOG_VISIBLE).toBe(SIM_VISIBLE);
    expect(FOG_EXPLORED).toBe(SIM_EXPLORED);
    expect([FOG_HIDDEN, FOG_VISIBLE, FOG_EXPLORED]).toEqual([0, 1, 3]);
  });
});

describe('split flag follows what is possible', () => {
  it('reconcile clears a ticked split when the team can no longer split', () => {
    const L = arrivedShip();
    form(L);
    const snap = snapOf(L);
    const s = createPlanetSession();
    openPlanet(s, snap, L.planet);
    reconcile(s, snap);
    const row = fillPlanetContext(snap, L.planet, -1, createPlanetContext()).expRow;
    expect(row).toBeGreaterThanOrEqual(0);
    setSplit(s, true);
    s.region2 = 2;
    const can = splitAvailable(snap, L.planet, row);
    if (can) {
      expect(reconcile(s, snap)).toBe('kept');
      expect(s.split).toBe(true);
    }
    snap.expeditions[row * EXPEDITION_STRIDE + X_EXPLORERS] = 1;
    expect(splitAvailable(snap, L.planet, row)).toBe(false);
    setSplit(s, true);
    expect(reconcile(s, snap)).toBe('kept');
    expect(s.split).toBe(false);
    expect(s.region2).toBe(-1);
  });

  it('splitAvailable is false without an expedition', () => {
    const L = arrivedShip();
    expect(splitAvailable(snapOf(L), L.planet, -1)).toBe(false);
  });
});

describe('several parked ships', () => {
  it('counts them and keeps the picked ship sticky', () => {
    const L = arrivedShip();
    const snap = snapOf(L);
    const first = snap.shipEntity[0];
    const second = addSecondShip(snap);
    expect(parkedShipCountAt(snap, L.planet)).toBe(2);
    expect(nthParkedShipRowAt(snap, L.planet, 0)).toBe(0);
    expect(nthParkedShipRowAt(snap, L.planet, 1)).toBe(1);
    expect(nthParkedShipRowAt(snap, L.planet, 2)).toBe(-1);

    const s = createPlanetSession();
    openPlanet(s, snap, L.planet);
    expect(s.ship).toBe(first);
    pickShip(s, snap, second);
    expect(s.ship).toBe(second);
    expect(reconcile(s, snap)).toBe('kept');
    expect(s.ship).toBe(second);
    const ctx = fillPlanetContext(snap, L.planet, s.ship, createPlanetContext());
    expect(ctx.shipRow).toBe(1);
    expect(ctx.shipEntity).toBe(second);
  });

  it('ignores a pick that is not parked here and falls back when the picked ship leaves', () => {
    const L = arrivedShip();
    const snap = snapOf(L);
    const first = snap.shipEntity[0];
    const second = addSecondShip(snap);
    const s = createPlanetSession();
    openPlanet(s, snap, L.planet);
    pickShip(s, snap, 987654);
    expect(s.ship).toBe(first);
    pickShip(s, snap, second);
    snap.shipEntity[1] = -5;
    expect(reconcile(s, snap)).toBe('kept');
    expect(s.ship).toBe(first);
  });
});

describe('the last expedition dying', () => {
  it('keeps the view open once, then closes on leave', () => {
    const L = arrivedShip();
    form(L);
    const snap = snapOf(L);
    const s = createPlanetSession();
    openPlanet(s, snap, L.planet);
    expect(reconcile(s, snap)).toBe('kept');
    expect(s.hadLive).toBe(true);
    // Everyone died and the ship is gone.
    const row = fillPlanetContext(snap, L.planet, -1, createPlanetContext()).expRow;
    snap.expeditions[row * EXPEDITION_STRIDE + X_STATUS] = ExpeditionStatus.Dead;
    snap.meta[META_SHIP_COUNT] = 0;
    expect(reconcile(s, snap)).toBe('kept');
    expect(s.ended).toBe(true);
    expect(s.mode).toBe('planet');
    expect(reconcile(s, snap)).toBe('kept');
    closePlanet(s);
    expect(s.ended).toBe(false);
    expect(reconcile(s, snap)).toBe('galaxy');
  });

  it('still closes at once when nothing was live (ship simply left)', () => {
    const L = arrivedShip();
    const snap = snapOf(L);
    const s = createPlanetSession();
    openPlanet(s, snap, L.planet);
    reconcile(s, snap);
    snap.meta[META_SHIP_COUNT] = 0;
    snap.meta[META_EXPEDITION_COUNT] = 0;
    expect(reconcile(s, snap)).toBe('closed');
  });
});

describe('region and odds texts', () => {
  it('says the landing zone will be explored on landing until it is', () => {
    const L = arrivedShip();
    const snap = snapOf(L);
    const g = snap.planetRegionStart[L.planet] + L.lz;
    snap.regionFog[g] = FOG_HIDDEN;
    expect(regionInfo(snap, L.planet, L.lz).lines).toContain(
      'Landing zone: will be explored on landing',
    );
    snap.regionFog[g] = FOG_EXPLORED;
    const lines = regionInfo(snap, L.planet, L.lz).lines;
    expect(lines).toContain('Landing zone');
    expect(lines).not.toContain('Landing zone: will be explored on landing');
  });

  it('notes that odds may change while natives are unmet, and not after contact', () => {
    const L = arrivedShip();
    form(L);
    const snap = snapOf(L);
    const row = fillPlanetContext(snap, L.planet, -1, createPlanetContext()).expRow;
    const region = frontierOf(snap, L.planet);
    expect(region).toBeGreaterThanOrEqual(0);
    snap.planetNative[L.planet] = 0;
    const unmet = buildExplorePlan(snap, L.planet, row, region, -1, false);
    expect(unmet.previews[0].nativeNote).toBe(NATIVE_HOME_NOTE);
    expect(NATIVE_HOME_NOTE).toBe('Odds may change if this region is a native home.');
    snap.planetNative[L.planet] = 1;
    const met = buildExplorePlan(snap, L.planet, row, region, -1, false);
    expect(met.previews[0].nativeNote).toBe('');
  });

  it('describes the automatic second region with its native-home fallback', () => {
    const L = arrivedShip();
    form(L, { stance: 2 });
    const snap = snapOf(L);
    const row = fillPlanetContext(snap, L.planet, -1, createPlanetContext()).expRow;
    const region = frontierOf(snap, L.planet);
    const plan = buildExplorePlan(snap, L.planet, row, region, -1, false);
    if (plan.bold) {
      expect(plan.autoNote).toContain('not a native home');
      expect(plan.autoNote).toContain('every such region is a native home');
    }
  });
});
