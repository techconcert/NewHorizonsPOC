// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  fillNebula,
  fillStarField,
  hash32,
  hashUnit,
  NEBULA_BASE_RGB,
  NEBULA_MAX_ADD,
  NEBULA_SEED,
  periodicNoise,
  STAR_FIELD_MAX,
  STAR_FIELD_MIN,
  STAR_FIELD_SEED,
  tiledFbm,
} from '../src/render/background';
import {
  colonyRangeWorld,
  fillColonyRanges,
  fillGlowTexture,
  fillSystemSurvey,
  glowAlpha,
  launchOriginSystem,
  pipOffsetX,
  shipMarginWarning,
  starCoreRadius,
  starGlowGain,
  starGlowRadius,
  surveyBrightness,
  systemSurveyLevel,
  writeDashes,
} from '../src/render/galaxyModel';
import { STAR_COLORS } from '../src/render/palette';
import { DISTANCE_FP, rangeFp } from '../src/shared/loadout';
import {
  C_FUEL,
  C_SPACEPORT,
  C_SYSTEM,
  COLONY_STRIDE,
  META_COLONY_COUNT,
  META_SYSTEM_COUNT,
  createSnapshot,
} from '../src/shared/snapshot';

describe('backdrop generation is deterministic', () => {
  it('hash32 gives the same value for the same input and differs for others', () => {
    expect(hash32(3, 4, 5)).toBe(hash32(3, 4, 5));
    expect(hash32(3, 4, 5)).not.toBe(hash32(4, 3, 5));
    expect(hash32(3, 4, 5)).not.toBe(hash32(3, 4, 6));
    const u = hashUnit(10, 20, 30);
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(1);
  });

  it('periodic noise repeats after its period and stays in [0, 1)', () => {
    for (let i = 0; i < 40; i++) {
      const x = i * 0.37;
      const y = i * 0.61;
      const v = periodicNoise(x, y, 4, 9);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(periodicNoise(x + 4, y, 4, 9)).toBeCloseTo(v, 6);
      expect(periodicNoise(x, y + 4, 4, 9)).toBeCloseTo(v, 6);
    }
  });

  it('fbm tiles: the left and right edge of the unit square match', () => {
    for (let k = 0; k < 10; k++) {
      const v = k / 10;
      expect(tiledFbm(0, v, 3, 4, 1)).toBeCloseTo(tiledFbm(1, v, 3, 4, 1), 6);
      expect(tiledFbm(v, 0, 3, 4, 1)).toBeCloseTo(tiledFbm(v, 1, 3, 4, 1), 6);
    }
  });

  it('the nebula is the same for a seed, differs for another, and stays dark', () => {
    const size = 32;
    const a = new Uint8Array(size * size * 4);
    const b = new Uint8Array(size * size * 4);
    const c = new Uint8Array(size * size * 4);
    fillNebula(a, size, NEBULA_SEED);
    fillNebula(b, size, NEBULA_SEED);
    fillNebula(c, size, NEBULA_SEED + 1);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    let brightest = 0;
    for (let i = 0; i < size * size; i++) {
      expect(a[i * 4]).toBeGreaterThanOrEqual(NEBULA_BASE_RGB[0]);
      expect(a[i * 4 + 1]).toBeGreaterThanOrEqual(NEBULA_BASE_RGB[1]);
      expect(a[i * 4 + 2]).toBeGreaterThanOrEqual(NEBULA_BASE_RGB[2]);
      expect(a[i * 4 + 3]).toBe(255);
      brightest = Math.max(brightest, a[i * 4], a[i * 4 + 1], a[i * 4 + 2]);
    }
    expect(brightest).toBeLessThanOrEqual(NEBULA_BASE_RGB[2] + NEBULA_MAX_ADD);
  });

  it('the star field stays inside its extent and repeats for a seed', () => {
    const n = 200;
    const p1 = new Float32Array(n * 3);
    const c1 = new Float32Array(n * 3);
    const p2 = new Float32Array(n * 3);
    const c2 = new Float32Array(n * 3);
    fillStarField(p1, c1, n, STAR_FIELD_SEED);
    fillStarField(p2, c2, n, STAR_FIELD_SEED);
    expect(Array.from(p1)).toEqual(Array.from(p2));
    expect(Array.from(c1)).toEqual(Array.from(c2));
    for (let i = 0; i < n; i++) {
      expect(p1[i * 3]).toBeGreaterThanOrEqual(STAR_FIELD_MIN);
      expect(p1[i * 3]).toBeLessThanOrEqual(STAR_FIELD_MAX);
      expect(p1[i * 3 + 1]).toBeGreaterThanOrEqual(STAR_FIELD_MIN);
      expect(p1[i * 3 + 1]).toBeLessThanOrEqual(STAR_FIELD_MAX);
      expect(c1[i * 3]).toBeGreaterThan(0);
      expect(c1[i * 3]).toBeLessThan(1);
    }
  });
});

describe('star glow and survey styling', () => {
  it('the glow falls off from 1 at the centre to 0 at the rim', () => {
    expect(glowAlpha(0)).toBe(1);
    expect(glowAlpha(1)).toBe(0);
    expect(glowAlpha(1.5)).toBe(0);
    let prev = 1;
    for (let i = 1; i <= 20; i++) {
      const a = glowAlpha(i / 20);
      expect(a).toBeLessThanOrEqual(prev);
      prev = a;
    }
  });

  it('the glow texture is symmetric, opaque in the middle and clear at the corners', () => {
    const size = 17;
    const t = new Uint8Array(size * size * 4);
    fillGlowTexture(t, size);
    const at = (x: number, y: number): number => t[(y * size + x) * 4 + 3];
    expect(at(8, 8)).toBe(255);
    expect(at(0, 0)).toBe(0);
    expect(at(size - 1, size - 1)).toBe(0);
    expect(at(3, 8)).toBe(at(13, 8));
    expect(at(8, 3)).toBe(at(8, 13));
    expect(t[3 * 4]).toBe(t[3 * 4]);
    expect(t[0]).toBe(255);
  });

  it('bigger and hotter stars get a bigger, stronger glow', () => {
    for (let i = 1; i < STAR_COLORS.length; i++) {
      expect(starGlowRadius(i)).toBeGreaterThan(starGlowRadius(i - 1));
      expect(starCoreRadius(i)).toBeGreaterThan(starCoreRadius(i - 1));
      expect(starGlowGain(i)).toBeGreaterThan(starGlowGain(i - 1));
    }
    expect(starGlowRadius(99)).toBe(starGlowRadius(STAR_COLORS.length - 1));
    expect(starGlowRadius(-1)).toBe(starGlowRadius(0));
  });

  it('brighter survey levels are brighter, and unknown is dim but not black', () => {
    expect(surveyBrightness(0)).toBe(0.32);
    expect(surveyBrightness(1)).toBe(0.6);
    expect(surveyBrightness(2)).toBe(0.82);
    expect(surveyBrightness(3)).toBe(1);
    expect(surveyBrightness(9)).toBe(1);
    expect(surveyBrightness(-1)).toBe(0.32);
  });

  it('a system takes the highest survey level among its planets', () => {
    const snap = createSnapshot();
    snap.meta[META_SYSTEM_COUNT] = 3;
    snap.planetCount.set([2, 3, 0]);
    snap.systemPlanetStart.set([0, 2, 5]);
    snap.planetSurvey.set([0, 1, 0, 3, 2]);
    expect(systemSurveyLevel(snap, 0)).toBe(1);
    expect(systemSurveyLevel(snap, 1)).toBe(3);
    expect(systemSurveyLevel(snap, 2)).toBe(0);
    const out = new Uint8Array(64);
    expect(fillSystemSurvey(snap, out)).toBe(3);
    expect(Array.from(out.subarray(0, 3))).toEqual([1, 3, 0]);
  });

  it('pips are centred on the star', () => {
    expect(pipOffsetX(0, 1, 6)).toBe(0);
    expect(pipOffsetX(0, 3, 6)).toBe(-6);
    expect(pipOffsetX(1, 3, 6)).toBe(0);
    expect(pipOffsetX(2, 3, 6)).toBe(6);
    expect(pipOffsetX(0, 4, 6)).toBe(-9);
    expect(pipOffsetX(3, 4, 6)).toBe(9);
  });
});

describe('dashed lines', () => {
  it('a 100 unit line with 10 dash and 10 gap gives five dashes along the line', () => {
    const out = new Float32Array(60);
    const n = writeDashes(out, 0, 0, 0, 100, 0, 10, 10, 20);
    expect(n).toBe(5);
    expect(out[0]).toBe(0);
    expect(out[3]).toBe(10);
    expect(out[6]).toBe(20);
    expect(out[9]).toBe(30);
    expect(out[24]).toBe(80);
    expect(out[27]).toBe(90);
    for (let i = 0; i < n; i++) {
      expect(out[i * 6 + 1]).toBe(0);
      expect(out[i * 6 + 2]).toBe(0);
    }
  });

  it('the last dash is cut at the end of the line and the direction is kept', () => {
    const out = new Float32Array(60);
    const n = writeDashes(out, 0, 0, 0, 0, 25, 10, 5, 20);
    expect(n).toBe(2);
    expect(out[3]).toBe(0);
    expect(out[4]).toBe(10);
    expect(out[7]).toBe(15);
    expect(out[10]).toBe(25);
  });

  it('long lines stretch their dashes instead of overflowing the buffer', () => {
    const out = new Float32Array(6 * 8);
    const n = writeDashes(out, 0, 0, 0, 800, 0, 5, 5, 8);
    expect(n).toBe(8);
    expect(out[(n - 1) * 6 + 3]).toBeLessThanOrEqual(800);
    // the stretched dash is longer than the asked one
    expect(out[3] - out[0]).toBeGreaterThan(5);
  });

  it('writes at an offset and rejects empty lines', () => {
    const out = new Float32Array(24);
    expect(writeDashes(out, 6, 1, 1, 1, 1, 4, 4, 4)).toBe(0);
    expect(writeDashes(out, 6, 0, 0, 3, 4, 2, 1, 0)).toBe(0);
    const n = writeDashes(out, 6, 0, 0, 3, 4, 2, 1, 4);
    expect(n).toBeGreaterThan(0);
    expect(out[0]).toBe(0);
    expect(out[6]).toBe(0);
    expect(out[9]).toBeCloseTo(1.2, 5);
    expect(out[10]).toBeCloseTo(1.6, 5);
  });
});

describe('colony range and supply warnings', () => {
  function withColonies(): ReturnType<typeof createSnapshot> {
    const snap = createSnapshot();
    snap.meta[META_COLONY_COUNT] = 3;
    const set = (row: number, system: number, fuel: number, port: number): void => {
      snap.colonies[row * COLONY_STRIDE + C_SYSTEM] = system;
      snap.colonies[row * COLONY_STRIDE + C_FUEL] = fuel;
      snap.colonies[row * COLONY_STRIDE + C_SPACEPORT] = port;
    };
    set(0, 4, 100, 1);
    set(1, 9, 50, 0);
    set(2, 12, 0, 1);
    return snap;
  }

  it('the launch range is the Cruise range of the fuel stock, only with a spaceport', () => {
    const snap = withColonies();
    expect(colonyRangeWorld(snap, 4)).toBe(rangeFp(100, 1) / DISTANCE_FP);
    expect(colonyRangeWorld(snap, 4)).toBeGreaterThan(0);
    expect(colonyRangeWorld(snap, 9)).toBe(0);
    expect(colonyRangeWorld(snap, 12)).toBe(0);
    expect(colonyRangeWorld(snap, 3)).toBe(0);
    const out = new Float32Array(64);
    fillColonyRanges(snap, out);
    expect(out[4]).toBe(colonyRangeWorld(snap, 4));
    expect(out[9]).toBe(0);
    expect(out[12]).toBe(0);
  });

  it('Mission Command launches from the first colony with a spaceport', () => {
    const snap = withColonies();
    expect(launchOriginSystem(snap)).toBe(4);
    snap.colonies[C_SPACEPORT] = 0;
    expect(launchOriginSystem(snap)).toBe(12);
    snap.meta[META_COLONY_COUNT] = 0;
    expect(launchOriginSystem(snap)).toBe(-1);
  });

  it('warns under 130 percent, red under 100, only for ships in flight with colonists', () => {
    expect(shipMarginWarning(99, 10, true)).toBe(2);
    expect(shipMarginWarning(100, 10, true)).toBe(1);
    expect(shipMarginWarning(129, 10, true)).toBe(1);
    expect(shipMarginWarning(130, 10, true)).toBe(0);
    expect(shipMarginWarning(50, 0, true)).toBe(0);
    expect(shipMarginWarning(50, 10, false)).toBe(0);
  });
});
