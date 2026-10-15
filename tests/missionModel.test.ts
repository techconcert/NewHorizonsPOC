// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAX_LOADOUT_DIALS } from '../src/data';
import { validateLoadoutDials } from '../src/data/validate';
import { cargoUsed, DISTANCE_FP, LOADOUT_DIALS } from '../src/shared/loadout';
import {
  COLONY_STRIDE,
  createSnapshot,
  META_COLONY_COUNT,
  META_PLANET_COUNT,
  META_SYSTEM_COUNT,
  type Snapshot,
} from '../src/shared/snapshot';
import {
  applyDefaults,
  buildView,
  chooseDestination,
  chooseHull,
  createLaunchGate,
  arrivalFoodCue,
  arrivalFoodText,
  defaultDials,
  foundingGradeText,
  describeReject,
  gateSent,
  gateSettled,
  launchEnabled,
  TYPICAL_TRIP_UNITS,
  CARGO_DIAL_IDS,
  createMissionState,
  dialAmountText,
  dialsOnScreen,
  formatOdds,
  formatRange,
  launchCommand,
  launchingColonyRow,
  loadoutOf,
  marginClass,
  setDial,
  setHull,
  setSpeed,
  setSystem,
  sliderMax,
  surveyLabel,
  targetPlanet,
} from '../src/ui/missionModel';

/**
 * Hand-built snapshot: system 0 at (100,100) holds planet 0 (homeworld, owned, Explored 90-100%);
 * system 1 at (400,500) holds planets 1 (Unknown 0-100%) and 2 (Surveyed 55-75%).
 * Distance 0 to 1 is 500 units.
 */
function world(): Snapshot {
  const s = createSnapshot();
  s.meta[META_SYSTEM_COUNT] = 2;
  s.meta[META_PLANET_COUNT] = 3;
  s.meta[META_COLONY_COUNT] = 1;
  s.positions.set([100, 100, 400, 500]);
  s.planetCount.set([1, 2]);
  s.systemPlanetStart.set([0, 1]);
  s.planetSystem.set([0, 1, 1]);
  s.planetSurvey.set([3, 0, 2]);
  s.planetHabLo.set([90, 0, 55]);
  s.planetHabHi.set([100, 100, 75]);
  s.planetOwned.set([1, 0, 0]);
  s.colonies.set([1, 0, 100000, 500000, 20000, 5000, 1]);
  return s;
}

describe('no screen has more than 6 dials', () => {
  it('the dials on screen are exactly the shared dial list, at most MAX_LOADOUT_DIALS', () => {
    expect(dialsOnScreen()).toBe(LOADOUT_DIALS);
    expect(dialsOnScreen().length).toBe(6);
    expect(dialsOnScreen().length).toBeLessThanOrEqual(MAX_LOADOUT_DIALS);
    expect(validateLoadoutDials(dialsOnScreen())).toEqual([]);
  });
  it('five cargo sliders plus the speed selector', () => {
    expect(CARGO_DIAL_IDS).toEqual(['passengers', 'supplies', 'fuel', 'kit', 'security']);
    expect(CARGO_DIAL_IDS.length + dialsOnScreen().filter((d) => d.kind === 'speed').length).toBe(
      6,
    );
  });
});

describe('dial state', () => {
  it('starts with a valid Ark loadout using 104 of 200 cargo', () => {
    const st = createMissionState();
    expect(st.hull).toBe(1);
    expect(cargoUsed(loadoutOf(st))).toBe(104);
  });

  it('slider limits are the cargo left on the hull', () => {
    const st = createMissionState();
    expect(sliderMax(st, 'passengers')).toBe(116); // 200 - (60 + 20 + 4)
    expect(sliderMax(st, 'kit')).toBe(50); // (200 - 100) / 2
    expect(sliderMax(st, 'security')).toBe(96);
  });

  it('setDial clamps to the cap, floors fractions and ignores negatives and NaN', () => {
    const st = createMissionState();
    setDial(st, 'passengers', 1000);
    expect(st.passengers).toBe(116);
    expect(cargoUsed(loadoutOf(st))).toBe(200);
    setDial(st, 'passengers', 3.9);
    expect(st.passengers).toBe(3);
    setDial(st, 'passengers', -4);
    expect(st.passengers).toBe(0);
    setDial(st, 'passengers', NaN);
    expect(st.passengers).toBe(0);
    setDial(st, 'kit', 1000);
    expect(st.kit).toBe(60); // 200 - (60 + 20) = 120 cargo free, 2 per kit
  });

  it('the cap can never be exceeded by any sequence of dial changes', () => {
    const st = createMissionState();
    setHull(st, 0);
    for (const id of CARGO_DIAL_IDS) {
      setDial(st, id, 9999);
      expect(cargoUsed(loadoutOf(st))).toBeLessThanOrEqual(60);
    }
    setHull(st, 2);
    for (const id of CARGO_DIAL_IDS) {
      setDial(st, id, 9999);
      expect(cargoUsed(loadoutOf(st))).toBeLessThanOrEqual(400);
    }
  });

  it('a smaller hull trims kit, security, supplies, fuel, passengers in that order to fit', () => {
    const st = createMissionState(); // 20 / 60 / 20 / 2 / 0
    setHull(st, 0); // Scout, cap 60
    expect([st.passengers, st.supplies, st.fuel, st.kit, st.security]).toEqual([20, 20, 20, 0, 0]);
    expect(cargoUsed(loadoutOf(st))).toBe(60);
  });

  it('a bigger hull keeps the loadout', () => {
    const st = createMissionState();
    setHull(st, 2);
    expect([st.passengers, st.supplies, st.fuel, st.kit, st.security]).toEqual([20, 60, 20, 2, 0]);
  });

  it('speed and system selection', () => {
    const st = createMissionState();
    setSpeed(st, 2);
    expect(st.speed).toBe(2);
    st.planetSlot = 1;
    setSystem(st, 5);
    expect([st.system, st.planetSlot]).toEqual([5, 0]);
  });
});

describe('live preview from a snapshot', () => {
  it('finds the launching colony and the chosen planet', () => {
    const snap = world();
    const st = createMissionState();
    expect(launchingColonyRow(snap)).toBe(0);
    expect(targetPlanet(st, snap)).toBe(-1);
    setSystem(st, 1);
    expect(targetPlanet(st, snap)).toBe(1);
    st.planetSlot = 1;
    expect(targetPlanet(st, snap)).toBe(2);
    st.planetSlot = 2; // system 1 has only two planets
    expect(targetPlanet(st, snap)).toBe(-1);
    snap.colonies[COLONY_STRIDE - 1] = 0; // no spaceport
    expect(launchingColonyRow(snap)).toBe(-1);
  });

  it('no destination or no colony gives no view', () => {
    const snap = world();
    const st = createMissionState();
    expect(buildView(st, snap)).toBeNull();
    setSystem(st, 1);
    snap.meta[META_COLONY_COUNT] = 0;
    expect(buildView(st, snap)).toBeNull();
    expect(launchCommand(st, snap)).toBeNull();
  });

  it('Ark 20/60/20/2/0 at Economy over 500 units: ETA 125, margin 60%, out of range', () => {
    const snap = world();
    const st = createMissionState();
    setSystem(st, 1);
    const v = buildView(st, snap)!;
    expect(v.preview.distanceFp).toBe(500 * DISTANCE_FP);
    expect(v.preview.etaDays).toBe(125); // 500 / 4 per day
    expect(v.preview.supplyNeed).toBe(50000); // 400 colonists x 125 days
    expect(v.preview.supplyMarginPct).toBe(60); // 30000 / 50000
    expect(v.preview.fuelNeeded).toBe(2500);
    expect(v.preview.rangeFp).toBe(400 * DISTANCE_FP);
    expect(v.preview.problem).toBe('OUT_OF_RANGE');
    // 30000 supplies feed 400 colonists for 75 of the 125 days: they starve before landing.
    expect([v.preview.oddsLo, v.preview.oddsHi]).toEqual([0, 0]);
    expect(v.preview.arrivalFoodDays).toBe(-50);
    expect(launchCommand(st, snap)).toBeNull();
  });

  it('the preview follows every dial change at once (same call, no snapshot needed)', () => {
    const snap = world();
    const st = createMissionState();
    setSystem(st, 1);
    setDial(st, 'fuel', 30); // 3000 fuel covers the 2500 needed
    expect(buildView(st, snap)!.preview.problem).toBeNull();
    expect(buildView(st, snap)!.preview.supplyMarginPct).toBe(60);
    setDial(st, 'supplies', 100); // 50000 supplies: exactly the need
    expect(buildView(st, snap)!.preview.supplyMarginPct).toBe(100);
    setSpeed(st, 1); // Cruise: ETA 500 / 6 = 83.3, so 84 days
    const cruise = buildView(st, snap)!.preview;
    expect(cruise.etaDays).toBe(84);
    expect(cruise.fuelNeeded).toBe(3750);
    expect(cruise.problem).toBe('OUT_OF_RANGE'); // 3000 < 3750
    setHull(st, 2);
    expect(buildView(st, snap)!.preview.cargoCapacity).toBe(400);
  });

  it('red warning case: a margin under 100 is flagged but can still launch', () => {
    const snap = world();
    const st = createMissionState();
    setSystem(st, 1);
    setDial(st, 'fuel', 30);
    const p = buildView(st, snap)!.preview;
    expect(p.supplyMarginPct).toBe(60);
    expect(marginClass(p.supplyMarginPct)).toBe('bad');
    expect(p.problem).toBeNull();
  });

  it('builds the exact LaunchShip command when the launch is possible', () => {
    const snap = world();
    const st = createMissionState();
    setSystem(st, 1);
    setDial(st, 'fuel', 30);
    expect(launchCommand(st, snap)).toEqual({
      type: 'LaunchShip',
      colony: 1,
      target: 1,
      hull: 1,
      passengers: 20,
      supplies: 60,
      fuel: 30,
      speed: 0,
      kit: 2,
      security: 0,
    });
  });

  it('the odds band narrows for a surveyed planet: slot 1 is 0 to 51', () => {
    const snap = world();
    const st = createMissionState();
    setSystem(st, 1);
    setDial(st, 'passengers', 10); // 200 colonists: 30000 supplies are a 120% margin
    st.planetSlot = 1;
    const v = buildView(st, snap)!;
    expect([v.survey, v.habLo, v.habHi]).toEqual([2, 55, 75]);
    expect(v.preview.supplyMarginPct).toBe(120);
    expect([v.preview.oddsLo, v.preview.oddsHi]).toEqual([0, 51]);
    st.planetSlot = 0;
    const u = buildView(st, snap)!;
    expect(u.survey).toBe(0);
    expect([u.preview.oddsLo, u.preview.oddsHi]).toEqual([0, 71]); // wider: habitability 0 to 100, survey Unknown
    expect(u.preview.oddsHi - u.preview.oddsLo).toBeGreaterThan(
      v.preview.oddsHi - v.preview.oddsLo,
    );
  });

  it('a colonised planet is not a destination', () => {
    const snap = world();
    const st = createMissionState();
    setSystem(st, 0);
    const v = buildView(st, snap)!;
    expect(v.preview.problem).toBe('INVALID_TARGET');
    expect(launchCommand(st, snap)).toBeNull();
  });

  it('a stockpile that is too small blocks the launch with its reason', () => {
    const snap = world();
    const st = createMissionState();
    setSystem(st, 1);
    setDial(st, 'fuel', 30);
    snap.colonies[2] = 399; // population
    expect(buildView(st, snap)!.preview.problem).toBe('INSUFFICIENT_PASSENGERS');
  });
});

describe('formatting helpers', () => {
  it('odds, range, survey and dial text', () => {
    expect(formatOdds(35, 60)).toBe('35 to 60%');
    expect(formatOdds(50, 50)).toBe('50%');
    expect(formatRange(102400)).toBe(400);
    expect(formatRange(255)).toBe(0);
    expect(surveyLabel(0)).toBe('Unknown');
    expect(surveyLabel(3)).toBe('Explored');
    expect(surveyLabel(9)).toBe('Unknown');
    expect(dialAmountText('passengers', 3)).toBe('60 colonists');
    expect(dialAmountText('supplies', 10)).toBe('5000 supplies');
  });
  it('margin colour: red under 100, amber to 129, green from 130', () => {
    expect(marginClass(99)).toBe('bad');
    expect(marginClass(100)).toBe('ok');
    expect(marginClass(129)).toBe('ok');
    expect(marginClass(130)).toBe('good');
  });
});

describe('hull switch at the model level', () => {
  it('trims to the new cap and the preview reflects it in the same call', () => {
    const snap = world();
    const st = createMissionState();
    setSystem(st, 1);
    expect(buildView(st, snap)!.preview.cargoCapacity).toBe(200);
    setHull(st, 0); // Scout: 20/60/20/2/0 trims to 20/20/20/0/0
    const p = buildView(st, snap)!.preview;
    expect([p.cargoCapacity, p.cargoUsed]).toEqual([60, 60]);
    expect(p.etaDays).toBe(84); // 500 units at 6 per day
    expect(p.supplyMarginPct).toBe(29); // 10000 / (400 x 84)
  });
});

describe('default loadout', () => {
  it('Ark over 500 units: 20 passengers, 140 supplies, 25 fuel, 4 kit lands at the founding-grade margin', () => {
    expect(defaultDials(1, 500 * DISTANCE_FP)).toEqual({
      passengers: 20,
      supplies: 140,
      fuel: 25,
      kit: 4,
      security: 0,
      speed: 0,
    });
  });

  it('Scout over 500 units: 4 / 22 / 25 / 4 (food for the trip, 20 ground days and the 30 day reserve)', () => {
    const d = defaultDials(0, 500 * DISTANCE_FP);
    expect([d.passengers, d.supplies, d.fuel, d.kit]).toEqual([4, 22, 25, 4]);
  });

  it('a typical nearby trip (150 units) starts at a margin of at least 100% for every hull', () => {
    expect(TYPICAL_TRIP_UNITS).toBe(150);
    for (const hull of [0, 1, 2]) {
      const st = createMissionState();
      chooseHull(st, hull, null);
      const snap = world();
      // Put the destination 150 units from the colony.
      snap.positions.set([100, 100, 250, 100]);
      chooseDestination(st, 1, 0, snap);
      const p = buildView(st, snap)!.preview;
      expect(p.distanceFp).toBe(150 * DISTANCE_FP);
      expect(p.supplyMarginPct).toBeGreaterThanOrEqual(100);
      expect(p.problem).toBeNull();
      expect(p.cargoUsed).toBeLessThanOrEqual(p.cargoCapacity);
    }
  });

  it('destination change recomputes the defaults; the Ark 500-unit case is launchable', () => {
    const snap = world();
    const st = createMissionState();
    chooseDestination(st, 1, 0, snap);
    expect([st.passengers, st.supplies, st.fuel, st.kit]).toEqual([20, 140, 25, 4]);
    const p = buildView(st, snap)!.preview;
    // 73500 supplies for 420 colonists over 125 days: 140%, exactly the founding-grade margin.
    expect(p.supplyMarginPct).toBe(140);
    expect(p.foundingGradeMarginPct).toBe(140);
    expect(p.arrivalFoodDays).toBe(50);
    expect(p.problem).toBeNull();
  });

  it('a hull change recomputes unedited dials', () => {
    const snap = world();
    const st = createMissionState();
    chooseDestination(st, 1, 0, snap);
    chooseHull(st, 0, snap);
    expect([st.passengers, st.supplies, st.fuel, st.kit]).toEqual([4, 22, 25, 4]);
  });

  it('dials the player edited are kept when defaults are re-chosen', () => {
    const snap = world();
    const st = createMissionState();
    chooseDestination(st, 1, 0, snap);
    setDial(st, 'passengers', 5);
    chooseHull(st, 2, snap);
    expect(st.passengers).toBe(5);
    expect(st.edited.passengers).toBe(true);
    expect(st.edited.supplies).toBe(false);
    expect(st.fuel).toBe(25);
    applyDefaults(st, snap);
    expect(st.passengers).toBe(5);
  });

  it('does not change the speed setting', () => {
    const snap = world();
    const st = createMissionState();
    setSpeed(st, 2);
    chooseDestination(st, 1, 0, snap);
    expect(st.speed).toBe(2);
  });
});

describe('launch gate', () => {
  it('disables after sending until a snapshot or reply settles it', () => {
    const g = createLaunchGate();
    expect(launchEnabled(g, null)).toBe(true);
    expect(launchEnabled(g, 'OUT_OF_RANGE')).toBe(false);
    gateSent(g);
    expect(launchEnabled(g, null)).toBe(false);
    gateSettled(g);
    expect(launchEnabled(g, null)).toBe(true);
  });
});

describe('reject text', () => {
  it('maps launch reasons to human text, not the raw code', () => {
    expect(describeReject('OVER_CAPACITY')).toBe('Launch refused: Over the hull cargo capacity.');
    expect(describeReject('INSUFFICIENT_FUEL')).toBe(
      'Launch refused: The colony stockpile has too little fuel.',
    );
    expect(describeReject('QUEUE_FULL')).toBe('Too many commands at once. Try again.');
    expect(describeReject('NOT_INITIALIZED')).toBe('The simulation is still starting.');
    expect(describeReject('SOMETHING_NEW')).toBe('Command refused.');
  });
});

describe('food planning text (pure view-model)', () => {
  it('arrival food reads in words: days per head, or how far the ship falls short', () => {
    expect(arrivalFoodText(50)).toBe('50 days per head');
    expect(arrivalFoodText(1)).toBe('1 day per head');
    expect(arrivalFoodText(0)).toBe('0 days per head');
    expect(arrivalFoodText(-50)).toBe('short by 50 days: colonists starve before arrival');
  });
  it('arrival food cue: NONE up to 0, THIN below the 50 day plan (20 ground + 30 reserve), else OK', () => {
    expect([-5, 0, 1, 49, 50, 80].map(arrivalFoodCue)).toEqual([
      'NONE',
      'NONE',
      'THIN',
      'THIN',
      'OK',
      'OK',
    ]);
  });
  it('founding-grade line: met, or how many points short of the grade', () => {
    expect(foundingGradeText(167, 130)).toBe('167% (37 points short)');
    expect(foundingGradeText(167, 167)).toBe('167% (met)');
    expect(foundingGradeText(167, 200)).toBe('167% (met)');
  });
  it('the default loadout never launches below the founding-grade margin when cargo allows', () => {
    for (const hull of [1, 2]) {
      for (const units of [150, 300, 500]) {
        const d = defaultDials(hull, units * DISTANCE_FP);
        const v = buildView(
          Object.assign(createMissionState(), d, { hull, system: 1 }),
          (() => {
            const s = world();
            s.positions.set([100, 100, 100 + units, 100]);
            return s;
          })(),
        )!;
        expect(v.preview.supplyMarginPct, `${hull}/${units}`).toBeGreaterThanOrEqual(
          Math.min(v.preview.foundingGradeMarginPct, 100),
        );
      }
    }
  });
});
