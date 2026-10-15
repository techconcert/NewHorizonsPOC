// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  NARROW_WIDTH_PX,
  PANEL_COLUMN_PX,
  computeViewArea,
  createViewArea,
} from '../src/render/viewArea';
import {
  DISTANCE_FP,
  HULL_NAMES,
  amountPerStep,
  etaDays,
  hullCapacity,
} from '../src/shared/loadout';
import { foundingGradeMarginPct, PF } from '../src/shared/planetfall';
import {
  META_PLANET_COUNT,
  META_SYSTEM_COUNT,
  createSnapshot,
  type Snapshot,
} from '../src/shared/snapshot';
import { defaultDials } from '../src/ui/missionModel';
import { isFrontier, regionInfo } from '../src/ui/planetRegions';
import { buildShipSupplyView } from '../src/ui/shipSupplyModel';
import { buildPlanetRows } from '../src/ui/systemPlanetsModel';
import { fillSnapshot } from '../src/worker/fill';
import { arrivedShip, form } from './helpers/planetfall';

describe('Planets panel rows follow the selected system', () => {
  it('rows equal the planet count for selections 4, 2, 1, 3', () => {
    const snap = createSnapshot();
    const counts = [4, 2, 1, 3];
    let start = 0;
    for (let i = 0; i < counts.length; i++) {
      snap.planetCount[i] = counts[i];
      snap.systemPlanetStart[i] = start;
      start += counts[i];
    }
    snap.meta[META_SYSTEM_COUNT] = counts.length;
    snap.meta[META_PLANET_COUNT] = start;
    for (const sys of [0, 1, 2, 3, 1, 0]) {
      const rows = buildPlanetRows(snap, sys);
      expect(rows.length).toBe(counts[sys]);
      expect(rows.map((r) => r.slot)).toEqual(Array.from({ length: counts[sys] }, (_, i) => i));
    }
    expect(buildPlanetRows(snap, -1)).toEqual([]);
    expect(buildPlanetRows(snap, 99)).toEqual([]);
  });
});

describe('planet map view area', () => {
  it('wide screens centre the map left of the panel column', () => {
    const a = computeViewArea(1600, 900, createViewArea());
    expect(a.width).toBe(1600 - PANEL_COLUMN_PX);
    expect(a.cx).toBe((1600 - PANEL_COLUMN_PX) / 2);
    expect(a.cy).toBe(450);
    expect(a.offsetX).toBe(1600 / 2 - a.cx);
    expect(a.offsetX).toBeGreaterThan(0);
    expect(a.offsetY).toBe(0);
    expect(a.distanceScale).toBe(1);
  });

  it('narrow screens put the map in the top part, above the stacked panels', () => {
    const w = NARROW_WIDTH_PX - 1;
    const a = computeViewArea(w, 900, createViewArea());
    expect(a.cx).toBe(w / 2);
    expect(a.offsetX).toBe(0);
    expect(a.cy).toBeLessThan(450);
    expect(a.cy + a.height / 2).toBeLessThan(900);
    expect(a.offsetY).toBeGreaterThan(0);
    expect(a.distanceScale).toBeGreaterThan(1);
  });

  it('stays valid for tiny canvases', () => {
    for (const [w, h] of [
      [1, 1],
      [300, 40],
      [800, 600],
    ]) {
      const a = computeViewArea(w, h, createViewArea());
      expect(a.width).toBeGreaterThan(0);
      expect(a.height).toBeGreaterThan(0);
      expect(Number.isFinite(a.distanceScale)).toBe(true);
    }
  });
});

describe('accessible names', () => {
  it('every region of a planet has a non-empty summary for its list button', () => {
    const L = arrivedShip();
    const snap = createSnapshot();
    fillSnapshot(L.w, snap, 0);
    const n = snap.planetRegionCount[L.planet];
    for (let i = 0; i < n; i++) {
      const info = regionInfo(snap, L.planet, i);
      expect(info.summary.trim().length).toBeGreaterThan(0);
      expect(info.name.length).toBeGreaterThan(0);
    }
    expect(isFrontier(1)).toBe(true);
  });
});

describe('ship supplies while exploring', () => {
  function snapOf(): { snap: Snapshot; shipRow: number; expRow: number } {
    const L = arrivedShip();
    form(L);
    const snap = createSnapshot();
    fillSnapshot(L.w, snap, 0);
    return { snap, shipRow: 0, expRow: 0 };
  }

  it('says how many days the ship food lasts and the factor it gives', () => {
    const { snap, shipRow, expRow } = snapOf();
    const v = buildShipSupplyView(snap, shipRow, expRow);
    expect(v).not.toBeNull();
    expect(v?.text).toMatch(
      /^Ship supplies: \d+, enough for \d+ more days \(about \d+% of the founding supplies factor\)$/,
    );
  });

  it('warns when the days left are under the reserve, and only then', () => {
    const { snap, shipRow, expRow } = snapOf();
    snap.shipSupplies[shipRow] = snap.shipColonists[shipRow] * (PF.founding.reserveDays - 1);
    expect(buildShipSupplyView(snap, shipRow, expRow)?.warning).toMatch(/^WARNING/);
    snap.shipSupplies[shipRow] = snap.shipColonists[shipRow] * (PF.founding.reserveDays + 5);
    expect(buildShipSupplyView(snap, shipRow, expRow)?.warning).toBe('');
    expect(buildShipSupplyView(snap, -1, expRow)).toBeNull();
    expect(buildShipSupplyView(snap, shipRow, -1)).toBeNull();
  });
});

describe('default loadout reaches the founding-grade margin', () => {
  it('for every hull over trips of 30 to 60 days where cargo allows', () => {
    let checked = 0;
    for (let hull = 0; hull < HULL_NAMES.length; hull++) {
      for (let units = 10; units <= 600; units += 10) {
        const distanceFp = units * DISTANCE_FP;
        const eta = etaDays(distanceFp, hull, 0);
        if (eta < 30 || eta > 60) continue;
        const d = defaultDials(hull, distanceFp);
        const cap = hullCapacity(hull);
        const people = d.passengers * amountPerStep('passengers');
        const food = d.supplies * amountPerStep('supplies');
        const margin = Math.floor((100 * food) / (people * eta));
        const grade = foundingGradeMarginPct(eta);
        // Only trips whose fuel leaves room for a launch at all are meaningful.
        if (d.fuel + d.passengers + d.supplies + 2 * d.kit > cap) continue;
        expect(margin).toBeGreaterThanOrEqual(grade);
        expect(d.passengers).toBeGreaterThanOrEqual(1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('prefers fewer passengers over thin supplies on a large hull', () => {
    const biggest = HULL_NAMES.length - 1;
    const distanceFp = 100 * DISTANCE_FP;
    const d = defaultDials(biggest, distanceFp);
    const cap = hullCapacity(biggest);
    expect(d.passengers).toBeLessThan(cap);
    expect(d.supplies).toBeGreaterThan(d.passengers / 2);
  });
});
