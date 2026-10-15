// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CARGO_DIALS, HULLS, MAX_LOADOUT_DIALS, RAW_CONTENT, SPEEDS } from '../src/data';
import { validateHulls, validateLoadoutConfig, validateLoadoutDials } from '../src/data/validate';
import {
  cargoUsed,
  computePreview,
  dialMax,
  DISTANCE_FP,
  distanceFpFromDelta,
  etaDays,
  firstLaunchProblem,
  foundingOddsBand,
  fuelNeeded,
  hullCapacity,
  LOADOUT_DIALS,
  productionCost,
  rangeFp,
  supplyMarginPct,
  validateLoadout,
  type Loadout,
} from '../src/shared/loadout';
import { arrivalFoodDays, foundingGradeMarginPct, supplyFactorPct } from '../src/shared/planetfall';
import { FP_SCALE, MAX_PLANETS, MAX_SYSTEMS } from '../src/sim/components';
import { SNAPSHOT_MAX_PLANETS, SNAPSHOT_MAX_SYSTEMS } from '../src/shared/snapshot';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const U = (units: number) => units * DISTANCE_FP; // world units to grid units

/** Scout, Economy, steps: passengers, supplies, fuel, kit, security. */
const mk = (
  hull: number,
  p: number,
  s: number,
  f: number,
  k: number,
  sec: number,
  speed = 0,
): Loadout => ({
  hull,
  speed,
  passengers: p,
  supplies: s,
  fuel: f,
  kit: k,
  security: sec,
});

describe('placeholder tables the worked examples rely on', () => {
  it('hulls: Scout 60/6/30/40, Ark 200/4/50/120, Heavy Ark 400/3/80/260', () => {
    expect(
      HULLS.map((h) => [h.name, h.cargoCapacity, h.baseSpeed, h.hullRating, h.productionCost]),
    ).toEqual([
      ['Scout', 60, 6, 30, 40],
      ['Ark', 200, 4, 50, 120],
      ['Heavy Ark', 400, 3, 80, 260],
    ]);
    expect([hullCapacity(0), hullCapacity(1), hullCapacity(2)]).toEqual([60, 200, 400]);
    expect([hullCapacity(-1), hullCapacity(3), hullCapacity(0.5)]).toEqual([0, 0, 0]);
  });

  it('dials: cargo per step, amount per step, Production per step', () => {
    expect(
      CARGO_DIALS.map((d) => [d.id, d.cargoPerStep, d.amountPerStep, d.productionPerStep]),
    ).toEqual([
      ['passengers', 1, 20, 0],
      ['supplies', 1, 500, 0],
      ['fuel', 1, 100, 0],
      ['kit', 2, 1, 5],
      ['security', 1, 1, 3],
    ]);
    expect(SPEEDS.map((s) => [s.fuelMult, s.etaMult])).toEqual([
      [1, 1],
      [1.5, 1.5],
      [2.5, 2.5],
    ]);
  });
});

describe('ETA = distance / speed setting (worked examples)', () => {
  it('Ark over 300 units: Economy 75 days, Cruise 50, Hard Burn 30', () => {
    expect(etaDays(U(300), 1, 0)).toBe(75);
    expect(etaDays(U(300), 1, 1)).toBe(50);
    expect(etaDays(U(300), 1, 2)).toBe(30);
  });
  it('rounds up: Scout over 301 units at Economy is 50.17 days, so 51', () => {
    expect(etaDays(U(301), 0, 0)).toBe(51);
  });
  it('Heavy Ark over 600 units at Economy: 200 days; minimum is 1 day', () => {
    expect(etaDays(U(600), 2, 0)).toBe(200);
    expect(etaDays(0, 2, 0)).toBe(1);
    expect(etaDays(1, 2, 0)).toBe(1);
  });
  it('distance from a 300/400 delta is 500 units', () => {
    expect(distanceFpFromDelta(U(300), U(400))).toBe(U(500));
    expect(distanceFpFromDelta(-3, 4)).toBe(5);
  });
});

describe('range = fuel / burn rate', () => {
  it('1500 fuel at Economy reaches 300 units (burn 5 per unit)', () => {
    expect(rangeFp(1500, 0)).toBe(U(300));
    expect(rangeFp(1500, 1)).toBe(U(200)); // burn x1.5
    expect(rangeFp(1500, 2)).toBe(U(120)); // burn x2.5
    expect(rangeFp(1, 0)).toBe(51); // 0.2 units = 51.2 grid units, rounded down
  });
  it('fuel needed for 300 units: 1500 / 2250 / 3750; 301 units needs 1505', () => {
    expect(fuelNeeded(U(300), 0)).toBe(1500);
    expect(fuelNeeded(U(300), 1)).toBe(2250);
    expect(fuelNeeded(U(300), 2)).toBe(3750);
    expect(fuelNeeded(U(301), 0)).toBe(1505);
    expect(fuelNeeded(0, 0)).toBe(0);
    expect(fuelNeeded(1, 0)).toBe(1);
  });
});

describe('supply margin = supplies / (passengers x ETA)', () => {
  it('400 colonists for 75 days need 30000: 30000 is 100%, 39000 is 130%, 29999 is 99%', () => {
    expect(supplyMarginPct(30000, 400, 75)).toBe(100);
    expect(supplyMarginPct(39000, 400, 75)).toBe(130);
    expect(supplyMarginPct(29999, 400, 75)).toBe(99);
    expect(supplyMarginPct(15000, 400, 75)).toBe(50);
  });
  it('is capped at 999 percent, which also stands in for nobody aboard', () => {
    expect(supplyMarginPct(1_000_000, 1, 1)).toBe(999);
    expect(supplyMarginPct(500, 0, 75)).toBe(999);
  });
});

describe('founding odds band (min and max of the founding chance over what the player knows)', () => {
  // foundingOddsBand(habLo, habHi, survey, supplies, passengers, security, eta, kit, natives)
  // natives: -1 while unmet, else the disposition 0 None .. 3 Hostile.
  it('Ark at a 130% margin (39000 for 400 colonists, 75 days) cannot be sure of founding: 0 to 66', () => {
    // Food on arrival is 9000 (22 days each), so after delays and 20 ground days nothing is left
    // for the 30 day reserve at the low end.
    expect(foundingOddsBand(60, 80, 2, 39000, 400, 0, 75, 10, -1)).toEqual({ lo: 0, hi: 66 });
  });
  it('at the founding-grade supplies (50000) the band is 5 to 76 with natives unmet, 8 to 76 with none', () => {
    expect(foundingOddsBand(60, 80, 2, 50000, 400, 0, 75, 10, -1)).toEqual({ lo: 5, hi: 76 });
    expect(foundingOddsBand(60, 80, 2, 50000, 400, 0, 75, 10, 0)).toEqual({ lo: 8, hi: 76 });
  });
  it('known natives narrow the band; escorts help against Hostile natives and cost against Peaceful ones', () => {
    expect(foundingOddsBand(60, 80, 2, 50000, 400, 0, 75, 10, 3)).toEqual({ lo: 5, hi: 61 });
    expect(foundingOddsBand(60, 80, 2, 50000, 400, 10, 75, 10, 3)).toEqual({ lo: 5, hi: 69 });
    expect(foundingOddsBand(60, 80, 2, 50000, 400, 10, 75, 10, 1)).toEqual({ lo: 6, hi: 76 });
  });
  it('the same planet narrows 5-63, 6-61, 6-60, 7-59 as survey goes Unknown to Explored', () => {
    const bands = [0, 1, 2, 3].map((lvl) => foundingOddsBand(50, 70, lvl, 50000, 400, 0, 75, 0, 0));
    expect(bands).toEqual([
      { lo: 5, hi: 63 },
      { lo: 6, hi: 61 },
      { lo: 6, hi: 60 },
      { lo: 7, hi: 59 },
    ]);
    for (let i = 1; i < 4; i++) {
      expect(bands[i].lo).toBeGreaterThanOrEqual(bands[i - 1].lo);
      expect(bands[i].hi).toBeLessThanOrEqual(bands[i - 1].hi);
    }
  });
  it('Unknown, habitability 0 to 100 and Explored 90 to 100', () => {
    expect(foundingOddsBand(0, 100, 0, 50000, 400, 0, 75, 0, -1)).toEqual({ lo: 0, hi: 90 });
    expect(foundingOddsBand(90, 100, 3, 50000, 400, 0, 75, 5, 0)).toEqual({ lo: 14, hi: 90 });
  });
  it('kit beyond saturation adds nothing; nobody aboard still gives a band', () => {
    expect(foundingOddsBand(60, 80, 2, 50000, 400, 0, 75, 10, 0)).toEqual(
      foundingOddsBand(60, 80, 2, 50000, 400, 0, 75, 50, 0),
    );
    expect(foundingOddsBand(50, 50, 1, 1000, 0, 0, 10, 0, 0)).toEqual({ lo: 17, hi: 26 });
  });
  it('a known natives band is inside the unmet band', () => {
    for (let known = 0; known <= 3; known++) {
      const un = foundingOddsBand(40, 90, 1, 30000, 300, 6, 60, 4, -1);
      const k = foundingOddsBand(40, 90, 1, 30000, 300, 6, 60, 4, known);
      expect(k.lo).toBeGreaterThanOrEqual(un.lo);
      expect(k.hi).toBeLessThanOrEqual(un.hi);
    }
  });
});

describe('food planning numbers', () => {
  it('food days per head on arrival: supplies / colonists minus the trip', () => {
    expect(arrivalFoodDays(39000, 400, 75)).toBe(22);
    expect(arrivalFoodDays(30000, 400, 75)).toBe(0);
    expect(arrivalFoodDays(15000, 400, 75)).toBe(-38);
    expect(arrivalFoodDays(500, 0, 75)).toBe(0);
  });
  it('founding-grade margin = (ETA + 20 ground days + 30 reserve days) / ETA', () => {
    expect(foundingGradeMarginPct(75)).toBe(167);
    expect(foundingGradeMarginPct(50)).toBe(200);
    expect(foundingGradeMarginPct(10)).toBe(600);
    expect(foundingGradeMarginPct(0)).toBe(999); // capped like the margin
    // At that margin the founding supplies factor reaches 100 after the planned ground days.
    const supplies = (400 * 75 * foundingGradeMarginPct(75)) / 100;
    const left = supplies - 400 * (75 + 20);
    expect(supplyFactorPct(left, 400)).toBe(100);
    expect(supplyFactorPct(left - 400, 400)).toBe(97);
  });
});

describe('cargo accounting and the hull cap', () => {
  it('sums steps x cargo per step: Ark 20/60/20/2/0 uses 104', () => {
    expect(cargoUsed(mk(1, 20, 60, 20, 2, 0))).toBe(104);
    expect(cargoUsed(mk(1, 0, 0, 0, 0, 0))).toBe(0);
    expect(cargoUsed(mk(1, 0, 0, 0, 1, 0))).toBe(2); // a kit step costs 2 cargo
  });
  it('speed setting costs no cargo', () => {
    expect(cargoUsed(mk(0, 10, 30, 10, 5, 0, 0))).toBe(cargoUsed(mk(0, 10, 30, 10, 5, 0, 2)));
  });
  it('exactly at the cap passes; one over fails (Scout, cap 60)', () => {
    expect(cargoUsed(mk(0, 10, 30, 10, 5, 0))).toBe(60);
    expect(validateLoadout(mk(0, 10, 30, 10, 5, 0))).toBeNull();
    expect(validateLoadout(mk(0, 10, 30, 10, 5, 1))).toBe('OVER_CAPACITY'); // 61
    expect(validateLoadout(mk(0, 11, 30, 10, 5, 0))).toBe('OVER_CAPACITY'); // 61
    expect(validateLoadout(mk(0, 10, 30, 10, 6, 0))).toBe('OVER_CAPACITY'); // 62 (kit is 2 each)
  });
  it('the cap holds for every hull: Ark 200, Heavy Ark 400', () => {
    expect(validateLoadout(mk(1, 100, 60, 20, 10, 0))).toBeNull(); // 100+60+20+20 = 200
    expect(validateLoadout(mk(1, 100, 60, 20, 10, 1))).toBe('OVER_CAPACITY');
    expect(validateLoadout(mk(2, 200, 100, 50, 25, 0))).toBeNull(); // 200+100+50+50 = 400
    expect(validateLoadout(mk(2, 200, 100, 50, 25, 1))).toBe('OVER_CAPACITY');
  });
  it('negative, fractional, non-finite and absurd dial values are rejected', () => {
    expect(validateLoadout(mk(0, -1, 10, 10, 0, 0))).toBe('INVALID_LOADOUT');
    expect(validateLoadout(mk(0, 5, 10, 10, 0, -3))).toBe('INVALID_LOADOUT');
    expect(validateLoadout(mk(0, 1.5, 10, 10, 0, 0))).toBe('INVALID_LOADOUT');
    expect(validateLoadout(mk(0, 5, 10.0001, 10, 0, 0))).toBe('INVALID_LOADOUT');
    expect(validateLoadout(mk(0, NaN, 10, 10, 0, 0))).toBe('INVALID_LOADOUT');
    expect(validateLoadout(mk(0, Infinity, 10, 10, 0, 0))).toBe('INVALID_LOADOUT');
    expect(validateLoadout(mk(0, 5, 10, 10, 0, 1_000_001))).toBe('INVALID_LOADOUT');
    expect(validateLoadout(mk(0, 5, 10, 10, 0, 1_000_000))).toBe('OVER_CAPACITY');
  });
  it('negative dials cannot cancel out an overload', () => {
    expect(validateLoadout(mk(0, 100, -50, 10, 0, 0))).toBe('INVALID_LOADOUT');
  });
  it('bad hull or speed index; zero passengers', () => {
    expect(validateLoadout(mk(-1, 5, 5, 5, 0, 0))).toBe('INVALID_HULL');
    expect(validateLoadout(mk(3, 5, 5, 5, 0, 0))).toBe('INVALID_HULL');
    expect(validateLoadout(mk(0.5, 5, 5, 5, 0, 0))).toBe('INVALID_HULL');
    expect(validateLoadout(mk(0, 5, 5, 5, 0, 0, 3))).toBe('INVALID_SPEED_SETTING');
    expect(validateLoadout(mk(0, 5, 5, 5, 0, 0, -1))).toBe('INVALID_SPEED_SETTING');
    expect(validateLoadout(mk(0, 0, 5, 5, 0, 0))).toBe('NO_PASSENGERS');
  });
  it('dialMax is what is left of the cap, divided by the dial cost', () => {
    const l = mk(0, 10, 30, 10, 0, 0); // 50 used of 60
    expect(dialMax(l, 'passengers')).toBe(20);
    expect(dialMax(l, 'kit')).toBe(5);
    expect(dialMax(l, 'security')).toBe(10);
    expect(dialMax(mk(0, 10, 30, 10, 0, 0), 'fuel')).toBe(20);
  });
  it('production cost: hull plus kit and security (Ark with 2 kit, 4 security is 142)', () => {
    expect(productionCost(mk(1, 1, 0, 0, 2, 4))).toBe(142);
    expect(productionCost(mk(0, 1, 0, 0, 0, 0))).toBe(40);
  });
});

describe('launch problems and preview', () => {
  const rich = { population: 100000, supplies: 500000, fuel: 20000, production: 5000 };
  const ark = mk(1, 20, 60, 20, 2, 0);

  it('preview for the Ark loadout over 300 units to an Unknown planet', () => {
    const p = computePreview(ark, U(300), { survey: 0, habLo: 0, habHi: 100 }, rich);
    expect(p).toEqual({
      cargoUsed: 104,
      cargoCapacity: 200,
      cargoFree: 96,
      distanceFp: U(300),
      etaDays: 75,
      rangeFp: U(400),
      fuelNeeded: 1500,
      colonists: 400,
      supplyNeed: 30000,
      supplyMarginPct: 100,
      oddsLo: 0,
      oddsHi: 6,
      arrivalFoodDays: 0,
      foundingGradeMarginPct: 167,
      productionCost: 130,
      problem: null,
    });
  });

  it('reports the first problem in order', () => {
    const d = U(300);
    const p = (l: Loadout, pop: number, sup: number, fuel: number, prod: number) =>
      firstLaunchProblem(l, d, pop, sup, fuel, prod);
    expect(p(ark, 100000, 500000, 20000, 5000)).toBeNull();
    expect(p(mk(1, 20, 60, 14, 2, 0), 1e5, 5e5, 2e4, 5000)).toBe('OUT_OF_RANGE'); // 1400 < 1500
    expect(p(mk(1, 20, 60, 15, 2, 0), 1e5, 5e5, 2e4, 5000)).toBeNull(); // 1500 = 1500
    expect(p(ark, 399, 5e5, 2e4, 5000)).toBe('INSUFFICIENT_PASSENGERS');
    expect(p(ark, 400, 5e5, 2e4, 5000)).toBeNull();
    expect(p(ark, 1e5, 29999, 2e4, 5000)).toBe('INSUFFICIENT_SUPPLIES');
    expect(p(ark, 1e5, 30000, 2e4, 5000)).toBeNull();
    expect(p(ark, 1e5, 5e5, 1999, 5000)).toBe('INSUFFICIENT_FUEL');
    expect(p(ark, 1e5, 5e5, 2000, 5000)).toBeNull();
    expect(p(ark, 1e5, 5e5, 2e4, 129)).toBe('INSUFFICIENT_PRODUCTION');
    expect(p(ark, 1e5, 5e5, 2e4, 130)).toBeNull();
    expect(p(mk(1, 0, 60, 20, 2, 0), 1e5, 5e5, 2e4, 5000)).toBe('NO_PASSENGERS');
  });

  it('Hard Burn shortens the trip and the range: 2000 fuel covers 160 units, so 300 is out of range', () => {
    const l = mk(1, 20, 60, 20, 2, 0, 2);
    const pr = computePreview(l, U(300), { survey: 0, habLo: 0, habHi: 100 }, rich);
    expect(pr.etaDays).toBe(30);
    expect(pr.rangeFp).toBe(U(160));
    expect(pr.problem).toBe('OUT_OF_RANGE');
  });

  it('a thin-supply loadout previews a margin under 100 but is still launchable', () => {
    const l = mk(1, 20, 30, 20, 2, 0); // 15000 supplies for 30000 needed
    const pr = computePreview(l, U(300), { survey: 0, habLo: 0, habHi: 100 }, rich);
    expect(pr.supplyMarginPct).toBe(50);
    expect(pr.problem).toBeNull();
  });
});

describe('content validation', () => {
  it('shipped hull and loadout tables are valid', () => {
    expect(validateHulls(RAW_CONTENT.hulls)).toEqual([]);
    expect(validateLoadoutConfig(RAW_CONTENT.loadout)).toEqual([]);
  });

  it('hull table: non-integer stats, falling capacity, missing hull are rejected', () => {
    const h = clone(RAW_CONTENT.hulls);
    (h.hulls[1] as { cargoCapacity: number }).cargoCapacity = 200.5;
    expect(validateHulls(h).join()).toContain('integer');
    const h2 = clone(RAW_CONTENT.hulls);
    (h2.hulls[1] as { cargoCapacity: number }).cargoCapacity = 59; // below Scout
    expect(validateHulls(h2).join()).toContain('increase');
    const h3 = clone(RAW_CONTENT.hulls);
    h3.hulls.push({ ...h3.hulls[0], id: 'extra' });
    expect(validateHulls(h3).join()).toContain('expected 3');
  });

  it('loadout table: a sixth cargo dial (seven dials), wrong ids, widening bands are rejected', () => {
    const l = clone(RAW_CONTENT.loadout);
    l.cargoDials.push({ ...l.cargoDials[0], id: 'specialists' });
    expect(validateLoadoutConfig(l).join()).toContain('too many dials');
    const l2 = clone(RAW_CONTENT.loadout);
    (l2.cargoDials[4] as { id: string }).id = 'escort';
    expect(validateLoadoutConfig(l2).join()).toContain('ids must be');
    const l3 = clone(RAW_CONTENT.loadout);
    l3.founding.siteQualityBands[3] = [30, 95]; // wider than the band before it
    expect(validateLoadoutConfig(l3).join()).toContain('narrow');
    const l4 = clone(RAW_CONTENT.loadout);
    (l4.cargoDials[0] as { cargoPerStep: number }).cargoPerStep = 0;
    expect(validateLoadoutConfig(l4).join()).toContain('cargoPerStep');
    expect(validateLoadoutConfig(null).length).toBeGreaterThan(0);
  });
});

describe('six dials and shared constants', () => {
  it('the dial list is the six design dials, in order, and within the limit', () => {
    expect(LOADOUT_DIALS.map((d) => d.id)).toEqual([
      'passengers',
      'supplies',
      'fuel',
      'speed',
      'kit',
      'security',
    ]);
    expect(LOADOUT_DIALS.map((d) => d.name)).toEqual([
      'Passengers',
      'Supplies',
      'Fuel',
      'Speed',
      'Survey kit',
      'Security',
    ]);
    expect(LOADOUT_DIALS.length).toBe(6);
    expect(LOADOUT_DIALS.length).toBeLessThanOrEqual(MAX_LOADOUT_DIALS);
    expect(validateLoadoutDials(LOADOUT_DIALS)).toEqual([]);
    expect(LOADOUT_DIALS.filter((d) => d.kind === 'speed')).toHaveLength(1);
  });

  it('shared constants match the sim', () => {
    expect(DISTANCE_FP).toBe(FP_SCALE);
    expect(SNAPSHOT_MAX_PLANETS).toBe(MAX_PLANETS);
    expect(SNAPSHOT_MAX_SYSTEMS).toBe(MAX_SYSTEMS);
  });
});
