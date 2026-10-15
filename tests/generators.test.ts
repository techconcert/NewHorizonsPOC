// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  Disposition,
  G_PLANET,
  G_REGION,
  G_SYSTEM,
  PlanetFlag,
  RegionFlag,
  Survey,
  Terrain,
} from '../src/sim/components';
import { hashGalaxy } from '../src/sim/hash';
import { createWorld } from '../src/sim/world';

const SEEDS = [1, 2, 3, 42, 777, 123456, 0xdeadbeef, 99999];

describe('galaxy generator', () => {
  it('system count 30..60, planets per system 1..5, habitability 0..100', () => {
    for (const seed of SEEDS) {
      const { stores: s } = createWorld(seed);
      const nSys = s.counts[G_SYSTEM] as number;
      expect(nSys).toBeGreaterThanOrEqual(30);
      expect(nSys).toBeLessThanOrEqual(60);
      let total = 0;
      for (let i = 0; i < nSys; i++) {
        const n = s.system.planetCount[i] as number;
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(5);
        total += n;
      }
      expect(s.counts[G_PLANET]).toBe(total);
      for (let p = 0; p < total; p++) {
        const h = s.planet.habitability[p] as number;
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(100);
      }
    }
  });

  it('exactly one homeworld, habitable, explored and owned by colony 0', () => {
    for (const seed of SEEDS) {
      const w = createWorld(seed);
      const s = w.stores;
      let homes = 0;
      for (let p = 0; p < (s.counts[G_PLANET] as number); p++) {
        if (((s.planet.flags[p] as number) & PlanetFlag.Homeworld) !== 0) homes++;
      }
      expect(homes).toBe(1);
      expect(s.planet.habitability[w.homePlanet]).toBeGreaterThanOrEqual(90);
      expect(s.planet.survey[w.homePlanet]).toBe(Survey.Explored);
      expect(s.planet.owner[w.homePlanet]).toBe(w.homeColony);
      expect(s.native.disposition[w.homePlanet]).toBe(Disposition.None);
    }
  });

  it('homeworld colony is populated with stockpiles and an 8000 day clock', () => {
    const w = createWorld(11);
    const s = w.stores;
    const c = w.homeColony;
    expect(s.colony.population[c]).toBeGreaterThan(0);
    expect(s.stockpile.supplies[c]).toBeGreaterThan(0);
    expect(s.stockpile.fuel[c]).toBeGreaterThan(0);
    expect(s.stockpile.production[c]).toBeGreaterThan(0);
    expect(s.run.homeDays[0]).toBe(8000);
  });

  it('same seed gives the same galaxy; different seeds differ', () => {
    expect(hashGalaxy(createWorld(5).stores)).toBe(hashGalaxy(createWorld(5).stores));
    expect(hashGalaxy(createWorld(5).stores)).not.toBe(hashGalaxy(createWorld(6).stores));
  });

  it('natives are hidden until contact and have valid dispositions', () => {
    const { stores: s } = createWorld(2024);
    let natives = 0;
    for (let p = 0; p < (s.counts[G_PLANET] as number); p++) {
      if (s.planet.nativePresence[p] === 1) {
        natives++;
        expect(s.native.disposition[p]).toBeGreaterThanOrEqual(Disposition.Peaceful);
        expect(s.native.disposition[p]).toBeLessThanOrEqual(Disposition.Hostile);
        expect(s.native.revealed[p]).toBe(0);
      } else {
        expect(s.native.disposition[p]).toBe(Disposition.None);
      }
    }
    expect(natives).toBeGreaterThan(0);
  });

  it('systems keep a fixed-point integer grid position', () => {
    const { stores: s } = createWorld(8);
    for (let i = 0; i < (s.counts[G_SYSTEM] as number); i++) {
      expect(Number.isInteger(s.system.x[i])).toBe(true);
      expect(s.system.x[i]).toBeGreaterThan(0);
    }
  });
});

describe('region generator', () => {
  it('7..19 regions per planet, unique axial coords, one landing zone, connected', () => {
    for (const seed of SEEDS) {
      const { stores: s } = createWorld(seed);
      let next = 0;
      for (let p = 0; p < (s.counts[G_PLANET] as number); p++) {
        const n = s.planet.regionCount[p] as number;
        const start = s.planet.regionStart[p] as number;
        expect(start).toBe(next);
        next += n;
        expect(n).toBeGreaterThanOrEqual(7);
        expect(n).toBeLessThanOrEqual(19);
        const seen = new Set<string>();
        let lz = 0;
        for (let i = 0; i < n; i++) {
          const key = `${s.region.q[start + i]},${s.region.r[start + i]}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
          expect(s.region.terrain[start + i]).toBeLessThanOrEqual(Terrain.Ruins);
          if (((s.region.flags[start + i] as number) & RegionFlag.LandingZone) !== 0) {
            lz++;
            expect(s.region.terrain[start + i]).toBe(Terrain.Plains);
          }
          if (i > 0) {
            let adjacent = false;
            for (let j = 0; j < i; j++) {
              const dq = (s.region.q[start + i] as number) - (s.region.q[start + j] as number);
              const dr = (s.region.r[start + i] as number) - (s.region.r[start + j] as number);
              if (Math.abs(dq) <= 1 && Math.abs(dr) <= 1 && dq + dr !== 2 && dq + dr !== -2) {
                adjacent = true;
              }
            }
            expect(adjacent).toBe(true);
          }
        }
        expect(lz).toBe(1);
      }
      expect(s.counts[G_REGION]).toBe(next);
    }
  });
});
