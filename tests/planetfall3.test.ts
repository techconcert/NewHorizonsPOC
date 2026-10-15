// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LOADOUT, PLANETFALL } from '../src/data';
import {
  clampExploration,
  clampKind,
  colonistsFactorPct,
  explorationRawPct,
  ExpeditionStatus,
  foundingChanceOf,
  foundingGradeMarginPct,
  foundingKitPct,
  foundingOddsBand,
  FR_COLONISTS,
  FR_HABITABILITY,
  FR_KIT,
  FR_NATIVES,
  FR_RESEARCH,
  FR_SITE,
  FR_SUPPLIES,
  LR_BASE,
  LR_CHANCE,
  LR_CLAMPED,
  LR_KIND,
  LR_KITPCT,
  LR_NATIVESPCT,
  LR_RAW_CHANCE,
  LR_STANCEPCT,
  LR_TEAM,
  nativesFoundingPct,
  siteQualityPct,
  supplyFactorPct,
} from '../src/shared/planetfall';
import { arrivedShip, exploreRounds, form, found, rollRecord } from './helpers/planetfall';

describe('the launch odds band contains the real founding chance', () => {
  const dm = LOADOUT.founding.delayAllowancePct;
  const f = PLANETFALL.founding;

  it('for every loadout: margins 60 to 200, colonists 100 to 500, kit 0 to 10, survey levels, natives known or unmet', () => {
    let cases = 0;
    let wide = 0;
    for (const margin of [60, 100, 130, 167, 200]) {
      for (const colonists of [100, 200, 300, 400, 500]) {
        for (const kit of [0, 3, 6, 10]) {
          for (const eta of [30, 90]) {
            for (const security of [0, 8]) {
              for (let survey = 0; survey <= 3; survey++) {
                const supplies = Math.floor((margin * colonists * eta) / 100);
                const habLo = 40;
                const habHi = 70;
                for (const known of [-1, 0, 1, 2, 3]) {
                  const band = foundingOddsBand(
                    habLo,
                    habHi,
                    survey,
                    supplies,
                    colonists,
                    security,
                    eta,
                    kit,
                    known,
                  );
                  expect(band.lo).toBeLessThanOrEqual(band.hi);
                  // A real landing: events delay 0 to the allowance, 0 to the planned ground days
                  // pass before founding, 0 to 10% of colonists and of supplies are lost, the
                  // natives are any that the player cannot rule out, the escort lands in whole or
                  // in part, the site is anywhere on the survey level's band.
                  for (const delay of [0, Math.floor((eta * dm) / 100)]) {
                    for (const ground of [0, f.planGroundDays]) {
                      for (const lossPct of [0, f.bandColonistLossPct]) {
                        let rem = supplies - colonists * (eta + delay + ground);
                        if (rem < 0) rem = 0;
                        rem -= Math.floor((rem * lossPct) / 100);
                        const c = colonists - Math.floor((colonists * lossPct) / 100);
                        for (const hab of [habLo, 55, habHi]) {
                          for (const score of [0, 50, 100]) {
                            const site = siteQualityPct(score, survey);
                            for (let d = known < 0 ? 0 : known; d <= (known < 0 ? 3 : known); d++) {
                              for (const home of [false, true]) {
                                for (const guards of [0, security]) {
                                  const chance = foundingChanceOf(
                                    hab,
                                    site,
                                    supplyFactorPct(rem, c),
                                    colonistsFactorPct(c),
                                    nativesFoundingPct(d, home, guards),
                                    foundingKitPct(kit),
                                    0,
                                  );
                                  if (chance < band.lo || chance > band.hi) {
                                    throw new Error(
                                      `chance ${chance} outside ${band.lo}..${band.hi}: margin ${margin} colonists ${colonists} kit ${kit} eta ${eta} sec ${security} survey ${survey} known ${known} delay ${delay} ground ${ground} loss ${lossPct} hab ${hab} score ${score} d ${d} home ${home} guards ${guards}`,
                                    );
                                  }
                                  cases++;
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                  if (band.hi - band.lo > 40) wide++;
                }
              }
            }
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(1_000_000);
    expect(wide).toBeGreaterThan(0);
  }, 120_000);

  it('unmet natives widen the band at the bottom: Hostile home ground and a Peaceful escort penalty', () => {
    const un = foundingOddsBand(70, 80, 3, 60000, 400, 8, 60, 6, -1);
    const none = foundingOddsBand(70, 80, 3, 60000, 400, 8, 60, 6, 0);
    expect(un.hi).toBe(none.hi);
    expect(un.lo).toBeLessThan(none.lo);
  });

  it('real flow A: margin 130 launched, 4 rounds explored, then founded: the band holds the actual chance', () => {
    // Scout, 400 colonists, ETA 17: 8840 supplies is a 130% margin. 17 days of food are 13 short
    // of the reserve, and 40 days of exploring eat the rest: the colony cannot be fed.
    const L = arrivedShip(3, { colonists: 400, supplies: 8840, kit: 4 });
    const e = form(L, { explorers: 200, supplies: 1500, kit: 4 });
    expect(L.atLaunch.eta).toBe(17);
    const band = foundingOddsBand(
      L.atLaunch.habLo,
      L.atLaunch.habHi,
      L.atLaunch.survey,
      L.atLaunch.supplies,
      L.atLaunch.passengers,
      L.atLaunch.security,
      L.atLaunch.eta,
      L.atLaunch.kit,
      -1,
    );
    expect(exploreRounds(L, e, 4)).toBe(4);
    expect(found(L.w, e, L.lz)).toEqual({ ok: true });
    const r = rollRecord(L.w, e);
    expect(r[LR_KIND]).toBe(2);
    expect(r[FR_SUPPLIES]).toBe(0); // out of food
    expect(r[LR_CHANCE]).toBe(0);
    expect(band.lo).toBeLessThanOrEqual(r[LR_CHANCE]);
    expect(band.hi).toBeGreaterThanOrEqual(r[LR_CHANCE]);
    expect(L.w.stores.expedition.status[e]).toBe(ExpeditionStatus.Stranded);
  });

  it('real flow B: the founding-grade margin, 2 rounds explored, then founded: chance and band', () => {
    const grade = foundingGradeMarginPct(17);
    expect(grade).toBe(395);
    const supplies = Math.ceil((grade * 400 * 17) / 100);
    const L = arrivedShip(3, { colonists: 400, supplies, kit: 4 });
    const e = form(L, { explorers: 200, supplies: 8000, kit: 4 });
    const band = foundingOddsBand(
      L.atLaunch.habLo,
      L.atLaunch.habHi,
      L.atLaunch.survey,
      L.atLaunch.supplies,
      L.atLaunch.passengers,
      L.atLaunch.security,
      L.atLaunch.eta,
      L.atLaunch.kit,
      -1,
    );
    expect(exploreRounds(L, e, 2)).toBe(2);
    expect(found(L.w, e, L.lz)).toEqual({ ok: true });
    const r = rollRecord(L.w, e);
    // Food is full again: 400 colonists eat 400 a day for 37 days; 26800 - 14800 = 12000 = 30 days.
    expect([r[FR_SUPPLIES], r[FR_COLONISTS]]).toEqual([100, 100]);
    expect(r[LR_CHANCE]).toBeGreaterThan(30);
    expect(band.lo).toBeLessThanOrEqual(r[LR_CHANCE]);
    expect(band.hi).toBeGreaterThanOrEqual(r[LR_CHANCE]);
    expect(r[FR_HABITABILITY]).toBe(80);
  });
});

describe('recorded factors reproduce the chance (Pillar 3: no hidden math)', () => {
  it('exploration: chance = clamp(floor(base x team x kit x stance x natives / 1e8)) for every recorded roll', () => {
    const L = arrivedShip(3, { colonists: 400, supplies: 20000, kit: 8 });
    const e = form(L, { explorers: 60, supplies: 8000, kit: 8, stance: 0 });
    exploreRounds(L, e, 5);
    let seen = 0;
    for (const slot of [0, 1]) {
      const r = rollRecord(L.w, e, slot);
      if (r[LR_KIND] !== 1) continue;
      const raw = explorationRawPct(
        r[LR_BASE],
        r[LR_TEAM],
        r[LR_KITPCT],
        r[LR_STANCEPCT],
        r[LR_NATIVESPCT],
      );
      expect(r[LR_RAW_CHANCE]).toBe(raw);
      expect(r[LR_CHANCE]).toBe(clampExploration(raw));
      expect(r[LR_CLAMPED]).toBe(clampKind(raw));
      seen++;
    }
    expect(seen).toBe(1);
  });

  it('the clamp: 85 x 120 x 130 x 110 x 115 is 167 raw, shown as 95 with the cap flag; tiny chances rise to 5', () => {
    const raw = explorationRawPct(85, 120, 130, 110, 115);
    expect(raw).toBe(167);
    expect([clampExploration(raw), clampKind(raw)]).toEqual([95, 2]);
    expect([clampKind(4), clampExploration(4)]).toEqual([1, 5]);
    expect([clampKind(5), clampKind(95)]).toEqual([0, 0]);
    expect([clampKind(96), clampExploration(96)]).toEqual([2, 95]);
  });

  it('a capped roll in the sim carries the flag: Cautious Plains team of 60 with full kit', () => {
    const L = arrivedShip(3, { colonists: 400, supplies: 20000, kit: 8 });
    const e = form(L, { explorers: 60, supplies: 8000, kit: 8, stance: 0 });
    exploreRounds(L, e, 1);
    const r = rollRecord(L.w, e);
    // 85 x 120 x 130 x 110 = 145.9 raw (no natives): capped.
    expect([r[LR_RAW_CHANCE], r[LR_CHANCE], r[LR_CLAMPED]]).toEqual([145, 95, 2]);
  });

  it('founding: chance = habitability x site x supplies x colonists x natives x kit from the record', () => {
    const L = arrivedShip(3, { colonists: 400, supplies: 20000, kit: 8 });
    const e = form(L, { explorers: 100, supplies: 8000, kit: 8 });
    exploreRounds(L, e, 2);
    found(L.w, e, L.lz);
    const r = rollRecord(L.w, e);
    const chance = foundingChanceOf(
      r[FR_HABITABILITY],
      r[FR_SITE],
      r[FR_SUPPLIES],
      r[FR_COLONISTS],
      r[FR_NATIVES],
      r[FR_KIT],
      r[FR_RESEARCH],
    );
    expect(r[LR_CHANCE]).toBe(chance);
    expect(chance).toBeGreaterThan(0);
  });
});
