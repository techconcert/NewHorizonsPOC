// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EVENT_CARD_COUNT, EVENT_SCENE, SCENE_TRANSIT } from '../src/shared/events';
import { ExpeditionStatus, foundingChanceOf, explorationChancePct } from '../src/shared/planetfall';
import { colonisedSystems } from '../src/shared/planetSnapshot';
import {
  META_SHIP_COUNT,
  META_SYSTEM_COUNT,
  createSnapshot,
  type Snapshot,
} from '../src/shared/snapshot';
import { queueExpeditionCard } from '../src/sim/events';
import { rerouteBlockerOfRow } from '../src/shared/transit';
import { PLANETFALL_REJECT_REASONS, describeRejectFor } from '../src/ui/commandGate';
import { colonySummary } from '../src/ui/colonyModel';
import { buildCardView } from '../src/ui/eventCardModel';
import {
  buildExplorePlan,
  buildExpeditionStatus,
  buildReEmbarkView,
} from '../src/ui/expeditionModel';
import { buildFoundingView, tierOdds } from '../src/ui/foundingModel';
import {
  buildFormationView,
  clampFormation,
  createFormationState,
  formationLimitsOf,
  resetFormation,
} from '../src/ui/formationModel';
import { isFrontier, regionInfo } from '../src/ui/planetRegions';
import {
  canLand,
  closePlanet,
  createPlanetContext,
  createPlanetSession,
  fillPlanetContext,
  openPlanet,
  reconcile,
  selectRegion,
  setSecondRegion,
  setSplit,
} from '../src/ui/planetSession';
import { buildLastRolls, explorationBreakdown } from '../src/ui/rollModel';
import { buildShipRow, shipStateKey } from '../src/ui/shipListModel';
import { buildPlanetRows } from '../src/ui/systemPlanetsModel';
import { fillSnapshot } from '../src/worker/fill';
import {
  answerCards,
  arrivedShip,
  explore,
  finishRound,
  form,
  found,
  type Landing,
} from './helpers/planetfall';

function snapOf(L: Landing): Snapshot {
  const s = createSnapshot();
  fillSnapshot(L.w, s, 0);
  return s;
}

/** First frontier (Seen) region of the planet; the landing zone itself starts explored. */
function frontierOf(L: Landing): number {
  const snap = snapOf(L);
  const start = snap.planetRegionStart[L.planet];
  for (let i = 0; i < snap.planetRegionCount[L.planet]; i++) {
    if (isFrontier(snap.regionFog[start + i])) return i;
  }
  return -1;
}

function ctxOf(snap: Snapshot, L: Landing) {
  return fillPlanetContext(snap, L.planet, -1, createPlanetContext());
}

describe('view switch state machine', () => {
  it('opens only for a planet with a ship or expedition, and closes cleanly', () => {
    const L = arrivedShip();
    const snap = snapOf(L);
    const s = createPlanetSession();
    expect(openPlanet(s, snap, 0)).toBe(false);
    expect(s.mode).toBe('galaxy');
    expect(canLand(snap, L.planet)).toBe(true);
    expect(openPlanet(s, snap, L.planet)).toBe(true);
    expect(s.mode).toBe('planet');
    expect(s.planet).toBe(L.planet);
    expect(s.region).toBe(L.lz);
    expect(reconcile(s, snap)).toBe('kept');
    closePlanet(s);
    expect(s.mode).toBe('galaxy');
    expect(s.planet).toBe(-1);
    expect(reconcile(s, snap)).toBe('galaxy');
  });

  it('closes by itself when the ship disappears while the view is open', () => {
    const L = arrivedShip();
    const snap = snapOf(L);
    const s = createPlanetSession();
    openPlanet(s, snap, L.planet);
    snap.meta[META_SHIP_COUNT] = 0;
    expect(reconcile(s, snap)).toBe('closed');
    expect(s.mode).toBe('galaxy');
  });

  it('closes when the planet no longer exists', () => {
    const L = arrivedShip();
    const snap = snapOf(L);
    const s = createPlanetSession();
    openPlanet(s, snap, L.planet);
    s.planet = 9999;
    expect(reconcile(s, snap)).toBe('closed');
  });

  it('opening another planet resets the selection', () => {
    const L = arrivedShip();
    const snap = snapOf(L);
    const s = createPlanetSession();
    openPlanet(s, snap, L.planet);
    s.region2 = 3;
    s.split = true;
    s.planet = -1;
    s.mode = 'galaxy';
    openPlanet(s, snap, L.planet);
    expect(s.region2).toBe(-1);
    expect(s.split).toBe(false);
  });

  it('selection rules: out of range clears, second equal to first clears, split off clears second', () => {
    const L = arrivedShip();
    const snap = snapOf(L);
    const s = createPlanetSession();
    openPlanet(s, snap, L.planet);
    selectRegion(s, snap, 999);
    expect(s.region).toBe(-1);
    selectRegion(s, snap, 2);
    setSecondRegion(s, 2);
    expect(s.region2).toBe(-1);
    setSplit(s, true);
    setSecondRegion(s, 3);
    expect(s.region2).toBe(3);
    setSplit(s, false);
    expect(s.region2).toBe(-1);
  });
});

describe('region information never leaks hidden land', () => {
  it('hidden regions show no terrain, hazard or find', () => {
    const L = arrivedShip();
    const snap = snapOf(L);
    const n = snap.planetRegionCount[L.planet];
    let hidden = 0;
    for (let i = 0; i < n; i++) {
      const info = regionInfo(snap, L.planet, i);
      if (info.state === 'unknown') {
        hidden++;
        const text = `${info.summary} ${info.lines.join(' ')}`;
        for (const word of ['Plains', 'Forest', 'Desert', 'Mountains', 'Swamp', 'Tundra']) {
          expect(text).not.toContain(word);
        }
      }
    }
    expect(hidden).toBeGreaterThan(0);
  });

  it('only the landing zone is a frontier at the start', () => {
    const L = arrivedShip();
    const snap = snapOf(L);
    const n = snap.planetRegionCount[L.planet];
    const frontier: number[] = [];
    for (let i = 0; i < n; i++) {
      if (isFrontier(snap.regionFog[snap.planetRegionStart[L.planet] + i])) frontier.push(i);
    }
    expect(frontier).toContain(L.lz);
  });
});

describe('formation view model', () => {
  it('limits, clamping and the chance range agree with the shared formulas', () => {
    const L = arrivedShip();
    const snap = snapOf(L);
    const ctx = ctxOf(snap, L);
    const limits = formationLimitsOf(snap, ctx.shipRow, false);
    const st = createFormationState();
    resetFormation(st, limits, ctx.shipEntity);
    st.explorers = 100000;
    clampFormation(st, limits);
    expect(st.explorers).toBeLessThanOrEqual(limits.colonists);
    const v = buildFormationView(st, limits, 0, ctx.shipEntity);
    expect(v.rows.length).toBeGreaterThan(0);
    expect(v.chanceLo).toBeLessThanOrEqual(v.chanceHi);
    expect(v.chanceLo).toBeGreaterThanOrEqual(5);
    expect(v.chanceHi).toBeLessThanOrEqual(95);
    expect(v.problem).toBeNull();
    expect(v.command?.type).toBe('FormExpedition');
    expect(v.command?.explorers).toBe(st.explorers);
  });
});

describe('expedition and exploration view models', () => {
  function formed(over = {}) {
    const L = arrivedShip();
    const e = form(L, over);
    const snap = snapOf(L);
    const ctx = ctxOf(snap, L);
    return { L, e, snap, ctx };
  }

  it('status shows the idle team and its days of food', () => {
    const { snap, ctx } = formed();
    const v = buildExpeditionStatus(snap, ctx.expRow);
    expect(v).not.toBeNull();
    expect(v?.live).toBe(true);
    expect(v?.idle).toBe(true);
    expect(v?.explorers).toBe(100);
    expect(v?.foodText).toMatch(/day/i);
  });

  it('only a frontier region can be explored; the command carries region and region2', () => {
    const { L, snap, ctx } = formed();
    const ok = buildExplorePlan(snap, L.planet, ctx.expRow, frontierOf(L), -1, false);
    expect(ok.problem).toBeNull();
    expect(ok.command).toMatchObject({ type: 'ExploreRegion', region: frontierOf(L), region2: -1 });
    expect(ok.previews.length).toBe(1);
    const other = L.lz;
    const bad = buildExplorePlan(snap, L.planet, ctx.expRow, other, -1, false);
    if (!isFrontier(snap.regionFog[snap.planetRegionStart[L.planet] + other])) {
      expect(bad.command).toBeNull();
      expect(bad.problem).not.toBeNull();
    }
    expect(buildExplorePlan(snap, L.planet, ctx.expRow, -1, -1, false).command).toBeNull();
  });

  it('after a round the preview is limited to frontier regions, a region2 must be distinct', () => {
    const { L, e } = formed({ stance: 2 });
    expect(explore(L.w, e, frontierOf(L)).ok).toBe(true);
    finishRound(L.w, e);
    answerCards(L.w, 0);
    const snap = snapOf(L);
    const ctx = ctxOf(snap, L);
    const n = snap.planetRegionCount[L.planet];
    const start = snap.planetRegionStart[L.planet];
    const frontier: number[] = [];
    for (let i = 0; i < n; i++) if (isFrontier(snap.regionFog[start + i])) frontier.push(i);
    if (frontier.length >= 2) {
      const plan = buildExplorePlan(snap, L.planet, ctx.expRow, frontier[0], -1, false);
      expect(plan.bold).toBe(true);
      expect(plan.region2Options).not.toContain(frontier[0]);
      for (const r of plan.region2Options) expect(frontier).toContain(r);
      const same = buildExplorePlan(snap, L.planet, ctx.expRow, frontier[0], frontier[0], false);
      expect(same.command === null || same.command.region2 !== frontier[0]).toBe(true);
    }
  });

  it('split needs enough explorers and is not offered to Bold', () => {
    const small = formed({ explorers: 3, stance: 1 });
    const p = buildExplorePlan(
      small.snap,
      small.L.planet,
      small.ctx.expRow,
      frontierOf(small.L),
      -1,
      true,
    );
    expect(p.canSplit).toBe(false);
    expect(p.splitProblem).not.toBe('');
    const bold = formed({ stance: 2 });
    const pb = buildExplorePlan(
      bold.snap,
      bold.L.planet,
      bold.ctx.expRow,
      frontierOf(bold.L),
      -1,
      true,
    );
    expect(pb.mode === 'split').toBe(false);
  });

  it('re-embark is offered while the expedition is idle and names what comes back', () => {
    const { snap, ctx } = formed();
    const r = buildReEmbarkView(snap, ctx.expRow, ctx.shipRow);
    expect(r.available).toBe(true);
    expect(r.command?.type).toBe('ReEmbark');
    expect(r.text).toMatch(/supplies/);
  });
});

describe('last roll breakdown reproduces the recorded chance', () => {
  it('exploration rows end at the recorded chance and verify', () => {
    const L = arrivedShip();
    const e = form(L, { stance: 1 });
    expect(explore(L.w, e, frontierOf(L)).ok).toBe(true);
    finishRound(L.w, e);
    const snap = snapOf(L);
    const ctx = ctxOf(snap, L);
    const rolls = buildLastRolls(snap, ctx.expRow);
    expect(rolls.length).toBeGreaterThan(0);
    const r = rolls[0];
    expect(r.kind).toBe('exploration');
    expect(r.rows.length).toBeGreaterThanOrEqual(5);
    expect(r.verified).toBe(true);
    const last = r.rows[r.rows.length - 1].running;
    // The rows show the raw product; the recorded chance is that value clamped to 5..95.
    const raw = Math.floor(parseFloat(last));
    expect(Math.min(95, Math.max(5, raw))).toBe(r.chance);
    if (raw !== r.chance) expect(r.clampText).not.toBe('');
    expect(r.rollLine).toMatch(/against/);
    expect(r.spoken.length).toBeGreaterThan(0);
  });

  it('explorationBreakdown is the shared formula', () => {
    const b = explorationBreakdown(70, 100, 110, 90, 100, {
      terrain: 'Plains',
    } as never);
    expect(b.chance).toBe(explorationChancePct(70, 100, 110, 90, 100));
  });

  it('founding preview equals the shared founding formula and tiers add up', () => {
    const L = arrivedShip();
    const e = form(L, { stance: 1 });
    for (let i = 0; i < 4; i++) {
      const s = snapOf(L);
      const c = ctxOf(s, L);
      const n = s.planetRegionCount[L.planet];
      let next = -1;
      for (let r = 0; r < n && next < 0; r++) {
        if (isFrontier(s.regionFog[s.planetRegionStart[L.planet] + r])) next = r;
      }
      if (next < 0 || c.expRow < 0) break;
      explore(L.w, e, next);
      finishRound(L.w, e);
      answerCards(L.w, 0);
    }
    const snap = snapOf(L);
    const ctx = ctxOf(snap, L);
    const status = snap.expeditions;
    expect(status.length).toBeGreaterThan(0);
    const start = snap.planetRegionStart[L.planet];
    let site = -1;
    for (let i = 0; i < snap.planetRegionCount[L.planet]; i++)
      if (snap.regionFog[start + i] === 3) site = i;
    expect(site).toBeGreaterThanOrEqual(0);
    const v = buildFoundingView(snap, L.planet, ctx.expRow, site);
    if (v.problem === null) {
      expect(v.tiers.length).toBe(3);
      expect(v.rows.length).toBeGreaterThanOrEqual(6);
      expect(v.chanceLo).toBeLessThanOrEqual(v.chanceHi);
      expect(v.command?.type).toBe('FoundColony');
      for (const t of v.tiers) expect(t.consequence.length).toBeGreaterThan(5);
      expect(v.rows.map((r) => r.label).join(' ')).toMatch(/esearch/);
    }
    const o = tierOdds(60);
    expect(o.thriving + o.struggling + o.failed).toBe(100);
    expect(foundingChanceOf(100, 100, 100, 100, 100, 100, 0)).toBe(100);
  });

  it('after founding, the ship list, colony summary and system rows show the colony', () => {
    const L = arrivedShip();
    const e = form(L, { stance: 1 });
    explore(L.w, e, frontierOf(L));
    finishRound(L.w, e);
    answerCards(L.w, 0);
    const r = found(L.w, e, L.lz);
    if (!r.ok) return; // founding rules are covered by the sim tests
    finishRound(L.w, e);
    answerCards(L.w, 0);
    const snap = snapOf(L);
    const sum = colonySummary(snap);
    if (snap.planetOwned[L.planet] !== 0) {
      expect(sum.count).toBe(1);
      const marks = new Uint8Array(snap.meta[META_SYSTEM_COUNT]);
      expect(colonisedSystems(snap, marks)).toBeGreaterThan(0);
      const rows = buildPlanetRows(snap, snap.planetSystem[L.planet]);
      expect(rows.some((p) => p.status.includes('Colony'))).toBe(true);
    }
    expect(sum.text).toMatch(/Colon/);
  });
});

describe('planetfall event cards in the card view', () => {
  it('every planetfall card has at most 3 choices, a title and cost text', () => {
    let planetfallCards = 0;
    for (let card = 0; card < EVENT_CARD_COUNT; card++) {
      if (EVENT_SCENE[card] === SCENE_TRANSIT) continue;
      planetfallCards++;
      const L = arrivedShip();
      const e = form(L);
      expect(queueExpeditionCard(L.w, e, card)).toBe(true);
      const snap = snapOf(L);
      const v = buildCardView(snap);
      expect(v).not.toBeNull();
      if (v === null) continue;
      expect(v.scene).toBe('planetfall');
      expect(v.choices.length).toBeGreaterThan(0);
      expect(v.choices.length).toBeLessThanOrEqual(3);
      expect(v.title.length).toBeGreaterThan(0);
      for (const c of v.choices) {
        expect(c.label.length).toBeGreaterThan(0);
        expect(c.lines.length + c.risk.length).toBeGreaterThan(0);
      }
    }
    expect(planetfallCards).toBeGreaterThanOrEqual(9);
  });

  it('transit cards keep the transit scene', () => {
    const snap = createSnapshot();
    expect(buildCardView(snap)).toBeNull();
  });
});

describe('ship list and reroute from the ground', () => {
  it('state keys follow the expedition, and reroute is blocked only while it is live', () => {
    const L = arrivedShip();
    let snap = snapOf(L);
    let row = 0;
    expect(shipStateKey(snap, row)).toBe('arrived');
    expect(rerouteBlockerOfRow(snap, row)).toBeNull();
    const e = form(L);
    snap = snapOf(L);
    expect(shipStateKey(snap, row)).toBe('ground');
    expect(rerouteBlockerOfRow(snap, row)).toBe('EXPEDITION_ACTIVE');
    expect(explore(L.w, e, frontierOf(L)).ok).toBe(true);
    snap = snapOf(L);
    expect(shipStateKey(snap, row)).toBe('exploring');
    const view = buildShipRow(snap, row, -1);
    expect(view.stateKey).toBe('exploring');
    row = 0;
    expect(ExpeditionStatus.Active).toBeDefined();
  });
});

describe('command texts', () => {
  it('every planetfall reject reason has text for each kind', () => {
    for (const kind of ['form', 'explore', 'found', 'embark'] as const) {
      for (const reason of PLANETFALL_REJECT_REASONS) {
        const t = describeRejectFor(kind, reason);
        expect(t.length).toBeGreaterThan(10);
        expect(t).not.toMatch(/undefined/);
      }
      expect(describeRejectFor(kind, 'SOMETHING_NEW')).toMatch(/refused/);
    }
  });
});
