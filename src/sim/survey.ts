import { TRANSIT } from '../data';
import { TE, techBonus } from '../shared/research';
import { G_ENTITY, ShipStateId, Survey } from './components';
import { mix32 } from './rng';
import type { World } from './world';

/**
 * Raise a planet's survey level (never lowers it) and narrow the known habitability range. The
 * range is a window of 2 x halfWidth around the true value, placed by a hash of the run seed and
 * the planet so the middle does not give the answer away; it is intersected with the old range,
 * so it only narrows and always contains the truth. No RNG state is consumed. Returns true when
 * the level rose. D-054.
 */
export function raiseSurvey(w: World, planet: number, level: number): boolean {
  const s = w.stores;
  if (level <= s.planet.survey[planet]) return false;
  s.planet.survey[planet] = level;
  const half =
    level >= Survey.Surveyed ? TRANSIT.survey.surveyedHalfWidth : TRANSIT.survey.scannedHalfWidth;
  const hab = s.planet.habitability[planet];
  const width = half * 2 + 1;
  const shift = mix32((s.run.seed[0] ^ Math.imul(planet + 1, 0x9e3779b1)) + level) % width;
  let lo = hab - shift;
  let hi = lo + half * 2;
  if (lo < 0) lo = 0;
  if (hi > 100) hi = 100;
  if (lo > s.planetSurvey.habLo[planet]) s.planetSurvey.habLo[planet] = lo;
  if (hi < s.planetSurvey.habHi[planet]) s.planetSurvey.habHi[planet] = hi;
  return true;
}

/**
 * SurveySystem (step 6): as a ship closes on its destination the planet becomes Scanned, then
 * Surveyed, when the share of the leg still to fly falls under the thresholds in transit.json.
 * Each survey kit step adds percentage points to both thresholds (earlier data). Only improves.
 */
export function surveySystem(w: World): void {
  const s = w.stores;
  const n = s.counts[G_ENTITY];
  const state = s.shipState.state;
  const route = s.shipRoute;
  const cfg = TRANSIT.survey;
  for (let e = 0; e < n; e++) {
    const st = state[e];
    if (st !== ShipStateId.InTransit && st !== ShipStateId.Event && st !== ShipStateId.Arrived)
      continue;
    const planet = route.destPlanet[e];
    if (s.planet.survey[planet] >= Survey.Surveyed) continue;
    let bonus = s.shipManifest.kit[e] * cfg.kitBonusPctPerStep;
    if (bonus > cfg.kitBonusMaxPct) bonus = cfg.kitBonusMaxPct;
    // Orbital Scanning adds points, but the thresholds stay under 100 so nothing is surveyed at launch.
    bonus += techBonus(s.research.mask[0], TE.Survey);
    if (bonus > 99 - cfg.scannedRemainingPct) bonus = 99 - cfg.scannedRemainingPct;
    const remaining100 = (route.distance[e] - route.progress[e]) * 100;
    const distance = route.distance[e];
    if (remaining100 <= distance * (cfg.surveyedRemainingPct + bonus)) {
      raiseSurvey(w, planet, Survey.Surveyed);
    } else if (remaining100 <= distance * (cfg.scannedRemainingPct + bonus)) {
      raiseSurvey(w, planet, Survey.Scanned);
    }
  }
}
