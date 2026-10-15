// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { RAW_CONTENT } from '../src/data';
import {
  validateAllContent,
  validateEventCard,
  validateHulls,
  validateLoadoutDials,
  validatePlanetTypes,
  validateResourceList,
  validateSpeeds,
  validateTerrain,
} from '../src/data/validate';
import { compileContent } from '../src/sim/content';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('shipped content', () => {
  it('passes every validator', () => {
    expect(validateAllContent(RAW_CONTENT)).toEqual([]);
  });

  it('compiles to indexed tables', () => {
    const c = compileContent();
    expect(c.hullCount).toBe(3);
    expect(Array.from(c.speedFuelX100)).toEqual([100, 150, 250]);
    expect(c.terrainCount).toBe(6);
    for (let t = 0; t < c.terrainCount; t++) {
      let sum = 0;
      for (let k = 0; k < c.findKindCount; k++)
        sum += c.terrainFinds[t * c.findKindCount + k] as number;
      expect(sum).toBe(100);
    }
  });
});

describe('validators reject bad content', () => {
  it('terrain finds that do not sum to 100', () => {
    const t = clone(RAW_CONTENT.terrain);
    (t.terrains[0] as { finds: number[] }).finds[0] = 31;
    expect(validateTerrain(t).length).toBeGreaterThan(0);
  });

  it('wrong terrain count, bad hazard', () => {
    const t = clone(RAW_CONTENT.terrain);
    t.terrains.pop();
    expect(validateTerrain(t).join()).toContain('expected 6 terrains');
    const t2 = clone(RAW_CONTENT.terrain);
    t2.terrains[1] = { ...t2.terrains[1], hazard: 'Extreme' } as (typeof t2.terrains)[number];
    expect(validateTerrain(t2).join()).toContain('hazard');
  });

  it('hull with a non-positive stat, or the wrong hull count', () => {
    const h = clone(RAW_CONTENT.hulls);
    (h.hulls[0] as { cargoCapacity: number }).cargoCapacity = 0;
    expect(validateHulls(h).join()).toContain('cargoCapacity');
    const h2 = clone(RAW_CONTENT.hulls);
    h2.hulls.pop();
    expect(validateHulls(h2).length).toBeGreaterThan(0);
    expect(validateHulls(null).length).toBeGreaterThan(0);
  });

  it('speed multipliers that drift from the design', () => {
    const s = clone(RAW_CONTENT.speeds);
    (s.speeds[2] as { fuelMult: number }).fuelMult = 3;
    expect(validateSpeeds(s).join()).toContain('1, 1.5, 2.5');
  });

  it('planet type weights that do not sum to 100', () => {
    const p = clone(RAW_CONTENT.planetTypes);
    (p.planetTypes[0] as { terrainWeights: number[] }).terrainWeights[0] = 99;
    expect(validatePlanetTypes(p).length).toBeGreaterThan(0);
  });

  it('an event card with 4 choices (limit 3) or 1 choice', () => {
    const mk = (n: number) => ({
      id: 'x',
      choices: Array.from({ length: n }, (_, i) => ({ label: `c${i}` })),
    });
    expect(validateEventCard(mk(4)).join()).toContain('max 3');
    expect(validateEventCard(mk(1)).length).toBeGreaterThan(0);
    expect(validateEventCard(mk(2))).toEqual([]);
    expect(validateEventCard(mk(3))).toEqual([]);
  });

  it('a loadout with 7 dials (limit 6)', () => {
    expect(validateLoadoutDials(new Array(7).fill('d')).length).toBeGreaterThan(0);
    expect(validateLoadoutDials(new Array(6).fill('d'))).toEqual([]);
  });

  it('5 resources (limit 4)', () => {
    expect(validateResourceList(['a', 'b', 'c', 'd', 'e']).length).toBeGreaterThan(0);
    expect(validateResourceList(['a', 'b', 'c', 'd'])).toEqual([]);
  });
});
