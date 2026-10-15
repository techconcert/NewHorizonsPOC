// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isDoubleClick, DOUBLE_CLICK_MS } from '../src/render/galaxyModel';
import { WIN_COLONIES, WIN_HOLD_DAYS, WIN_POPULATION } from '../src/shared/colony';
import {
  META_COLONY_COUNT,
  META_PENDING_COUNT,
  META_SPEED,
  createSnapshot,
  type Snapshot,
} from '../src/shared/snapshot';
import { FOG_EXPLORED } from '../src/shared/fog';
import { fillSnapshot } from '../src/worker/fill';
import {
  DOUBLE_CLICK_HINT,
  GROUND_BADGE_TEXT,
  NOTHING_TO_OPEN_TEXT,
  colonyPlanetOfRow,
  groundBlockedPlanet,
  openableColonyPlanet,
  planetClickAction,
} from '../src/ui/openPlanetModel';
import { buildShipRow } from '../src/ui/shipListModel';
import {
  buildReroutePanelModel,
  blockerText,
  createRerouteScratch,
  createRerouteSession,
  selectShip,
} from '../src/ui/rerouteModel';
import {
  DIAL_HELP,
  DIAL_IDS,
  HUD_HELP,
  HULL_HELP,
  MARGIN_HELP,
  isOneSentence,
} from '../src/ui/helpText';
import {
  TUTORIAL_LENGTH,
  TUTORIAL_STEPS,
  back,
  createTutorial,
  createTutorialFacts,
  currentStep,
  goalSentence,
  next,
  observe,
  progressText,
  readTutorialFacts,
  reopen,
  resetForNewWorld,
  skip,
  type TutorialFacts,
  type TutorialState,
} from '../src/ui/tutorialModel';
import { arrivedShip, form, found, finishRound, explore, type Landing } from './helpers/planetfall';
import { isFrontier } from '../src/ui/planetRegions';

function snapOf(L: Landing): Snapshot {
  const s = createSnapshot();
  fillSnapshot(L.w, s, 0);
  return s;
}

describe('double-click detection (render, pure)', () => {
  it('the same target within the window is a double-click', () => {
    expect(isDoubleClick(1000, 5, 1200, 5)).toBe(true);
    expect(isDoubleClick(1000, 5, 1000 + DOUBLE_CLICK_MS, 5)).toBe(true);
  });
  it('another target, a late click or no previous click is not', () => {
    expect(isDoubleClick(1000, 5, 1200, 6)).toBe(false);
    expect(isDoubleClick(1000, 5, 1000 + DOUBLE_CLICK_MS + 1, 5)).toBe(false);
    expect(isDoubleClick(1000, -1, 1100, 5)).toBe(false);
    expect(isDoubleClick(1000, 5, 900, 5)).toBe(false);
    expect(isDoubleClick(1000, 5, 1100, -1)).toBe(false);
  });
});

describe('open the planet from the ship list, reroute panel and system view', () => {
  it('a ship held by a ground expedition points at its planet; a free ship does not', () => {
    const L = arrivedShip();
    let snap = snapOf(L);
    expect(groundBlockedPlanet(snap, 0)).toBe(-1);
    expect(buildShipRow(snap, 0, -1).openPlanet).toBe(-1);
    form(L);
    snap = snapOf(L);
    expect(groundBlockedPlanet(snap, 0)).toBe(L.planet);
    expect(buildShipRow(snap, 0, -1).openPlanet).toBe(L.planet);
    expect(groundBlockedPlanet(snap, -1)).toBe(-1);
  });

  it('the reroute panel names the way out and carries the planet to open', () => {
    const L = arrivedShip();
    form(L);
    const snap = snapOf(L);
    const session = createRerouteSession();
    selectShip(session, snap.shipEntity[0]);
    const m = buildReroutePanelModel(snap, session, createRerouteScratch());
    expect(m.mode).toBe('blocked');
    expect(m.openPlanet).toBe(L.planet);
    expect(m.hint).toBe(blockerText('EXPEDITION_ACTIVE'));
    expect(m.hint).toContain('Re-embark the expedition');
    expect(GROUND_BADGE_TEXT).toBe('Expedition on the ground');
  });

  it('a free ship in orbit can be rerouted and offers no Open planet button', () => {
    const L = arrivedShip();
    const snap = snapOf(L);
    const session = createRerouteSession();
    selectShip(session, snap.shipEntity[0]);
    const m = buildReroutePanelModel(snap, session, createRerouteScratch());
    expect(m.mode).not.toBe('blocked');
    expect(m.openPlanet).toBe(-1);
  });

  it('click rules in the system view: a planet with a ship opens, an empty one only selects', () => {
    const L = arrivedShip();
    const snap = snapOf(L);
    expect(planetClickAction(snap, L.planet, false)).toBe('open');
    expect(planetClickAction(snap, L.planet, true)).toBe('open');
    const empty = L.planet === 0 ? 1 : 0;
    expect(planetClickAction(snap, empty, false)).toBe('select');
    expect(planetClickAction(snap, empty, true)).toBe('none');
    expect(planetClickAction(snap, -1, false)).toBe('select');
    expect(DOUBLE_CLICK_HINT).toBe('Double-click a planet to open it');
    expect(NOTHING_TO_OPEN_TEXT).toContain('Nothing to open');
  });

  it('Open colony: a founded colony resolves to its planet, the homeworld and bad rows do not open', () => {
    const L = arrivedShip();
    const e = form(L);
    // Explore once, then found at the landing zone (the helper plays the rounds).
    const snap0 = snapOf(L);
    const start = snap0.planetRegionStart[L.planet];
    let frontier = -1;
    for (let i = 0; i < snap0.planetRegionCount[L.planet]; i++) {
      if (isFrontier(snap0.regionFog[start + i])) {
        frontier = i;
        break;
      }
    }
    expect(explore(L.w, e, frontier).ok).toBe(true);
    finishRound(L.w, e);
    expect(found(L.w, e, L.lz).ok).toBe(true);
    const snap = snapOf(L);
    const rows = snap.meta[META_COLONY_COUNT];
    expect(rows).toBeGreaterThanOrEqual(2);
    expect(colonyPlanetOfRow(snap, 1)).toBe(L.planet);
    expect(openableColonyPlanet(snap, 1)).toBe(L.planet);
    expect(colonyPlanetOfRow(snap, -1)).toBe(-1);
    expect(colonyPlanetOfRow(snap, rows)).toBe(-1);
    expect(openableColonyPlanet(snap, rows)).toBe(-1);
  });
});

describe('one-sentence help texts', () => {
  it('every loadout dial, the hull, the margin and every HUD stat has one sentence', () => {
    for (const id of DIAL_IDS) expect(isOneSentence(DIAL_HELP[id] ?? ''), id).toBe(true);
    expect(isOneSentence(HULL_HELP)).toBe(true);
    expect(isOneSentence(MARGIN_HELP)).toBe(true);
    for (const id of ['day', 'clock', 'colonies', 'research', 'goal'])
      expect(isOneSentence(HUD_HELP[id] ?? ''), id).toBe(true);
  });
  it('the sentence check rejects two sentences, empty text and a missing full stop', () => {
    expect(isOneSentence('One. Two.')).toBe(false);
    expect(isOneSentence('')).toBe(false);
    expect(isOneSentence('No full stop')).toBe(false);
  });
});

function facts(over: Partial<TutorialFacts> = {}): TutorialFacts {
  return { ...createTutorialFacts(), ...over };
}

describe('tutorial step machine', () => {
  it('has the eleven steps in the planned order, each with text and an anchor', () => {
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual([
      'pick-star',
      'dials',
      'launch',
      'speed',
      'card',
      'arrival',
      'explore',
      'odds',
      'found',
      'colony',
      'goal',
    ]);
    expect(TUTORIAL_LENGTH).toBe(11);
    for (const s of TUTORIAL_STEPS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.text.length).toBeGreaterThan(20);
      expect(s.anchors.length).toBeGreaterThan(0);
    }
  });

  it('starts open at step 1 and the goal step quotes the current win rule', () => {
    const t = createTutorial();
    expect(t.open).toBe(true);
    expect(currentStep(t)?.id).toBe('pick-star');
    expect(progressText(t)).toBe('Step 1 of 11');
    expect(goalSentence()).toBe(
      `Win by holding ${WIN_COLONIES} colonies of ${WIN_POPULATION}+ people for ${WIN_HOLD_DAYS} days in a row, before the homeworld clock runs out.`,
    );
    expect(TUTORIAL_STEPS[10].text).toBe(goalSentence());
  });

  it('walks a whole game: select, launch, run, card, arrive, open, explore, found', () => {
    const t = createTutorial();
    expect(observe(t, facts())).toBe(false);
    expect(t.step).toBe(0);
    // 1: a star is picked -> the dials step (no signal of its own)
    expect(observe(t, facts({ starSelected: true }))).toBe(true);
    expect(currentStep(t)?.id).toBe('dials');
    observe(t, facts({ starSelected: true }));
    expect(currentStep(t)?.id).toBe('dials');
    // launch: a ship exists -> speed step (speed 1x does not finish it)
    observe(t, facts({ starSelected: true, shipCount: 1, speed: 1 }));
    expect(currentStep(t)?.id).toBe('speed');
    // 2x counts as using the speed controls
    observe(t, facts({ shipCount: 1, speed: 2 }));
    expect(currentStep(t)?.id).toBe('card');
    // a card waits, then is answered
    observe(t, facts({ shipCount: 1, speed: 0, pendingCards: 1 }));
    expect(currentStep(t)?.id).toBe('card');
    observe(t, facts({ shipCount: 1, speed: 2, pendingCards: 0 }));
    expect(currentStep(t)?.id).toBe('arrival');
    // the planet view opens
    observe(t, facts({ shipCount: 1, shipParked: true, planetOpen: true, exploredRegions: 1 }));
    expect(currentStep(t)?.id).toBe('explore');
    // one more region explored than when the planet opened
    observe(t, facts({ shipCount: 1, shipParked: true, planetOpen: true, exploredRegions: 2 }));
    expect(currentStep(t)?.id).toBe('odds');
    // the odds step waits for Next or the founding itself
    observe(t, facts({ shipCount: 1, planetOpen: true, exploredRegions: 2 }));
    expect(currentStep(t)?.id).toBe('odds');
    observe(t, facts({ shipCount: 1, colonies: 1 }));
    expect(currentStep(t)?.id).toBe('colony');
    // the last two steps only move with Next
    observe(t, facts({ shipCount: 1, colonies: 3 }));
    expect(currentStep(t)?.id).toBe('colony');
    next(t);
    expect(currentStep(t)?.id).toBe('goal');
    next(t);
    expect(t.open).toBe(false);
    expect(t.finished).toBe(true);
    expect(t.seen).toBe(true);
    expect(currentStep(t)).toBeNull();
  });

  it('a card never seen is skipped by arriving; Next moves one step without a signal', () => {
    const t = createTutorial();
    observe(t, facts({ starSelected: true, shipCount: 1, speed: 4 }));
    expect(currentStep(t)?.id).toBe('card');
    observe(t, facts({ shipCount: 1, shipParked: true }));
    expect(currentStep(t)?.id).toBe('arrival');
    const u = createTutorial();
    next(u);
    expect(currentStep(u)?.id).toBe('dials');
    next(u);
    expect(currentStep(u)?.id).toBe('launch');
  });

  it('a loaded game with a colony goes straight to the colony panel step', () => {
    const t = createTutorial();
    observe(t, facts({ shipCount: 2, colonies: 2, speed: 1 }));
    expect(currentStep(t)?.id).toBe('colony');
  });

  it('Back holds the earlier step until Next; Skip closes; Help reopens at the first undone step', () => {
    const t = createTutorial();
    observe(t, facts({ starSelected: true, shipCount: 1, speed: 2 }));
    expect(currentStep(t)?.id).toBe('card');
    back(t);
    expect(currentStep(t)?.id).toBe('speed');
    expect(observe(t, facts({ shipCount: 1, speed: 2 }))).toBe(false);
    expect(currentStep(t)?.id).toBe('speed');
    next(t);
    observe(t, facts({ shipCount: 1, speed: 2 }));
    expect(currentStep(t)?.id).toBe('card');
    back(createTutorial()); // Back on the first step does nothing
    skip(t);
    expect(t.open).toBe(false);
    expect(t.seen).toBe(true);
    expect(t.finished).toBe(false);
    // progress keeps being recorded while closed, so reopening lands on the right step
    observe(t, facts({ shipCount: 1, shipParked: true, planetOpen: true, exploredRegions: 1 }));
    expect(t.open).toBe(false);
    reopen(t, facts({ shipCount: 1, shipParked: true, planetOpen: true, exploredRegions: 1 }));
    expect(t.open).toBe(true);
    expect(currentStep(t)?.id).toBe('explore');
  });

  it('a new game drops the progress; the guide restarts only if it was never seen', () => {
    const fresh: TutorialState = createTutorial();
    observe(fresh, facts({ starSelected: true, shipCount: 1 }));
    resetForNewWorld(fresh);
    expect(fresh.open).toBe(true);
    expect(fresh.step).toBe(0);
    expect(fresh.progress).toBe(0);
    skip(fresh);
    resetForNewWorld(fresh);
    expect(fresh.open).toBe(false);
    expect(fresh.step).toBe(0);
  });

  it('reads the facts from a real snapshot', () => {
    const L = arrivedShip();
    const snap = snapOf(L);
    const f = createTutorialFacts();
    readTutorialFacts(snap, { starSelected: true, planet: -1 }, f);
    expect(f.starSelected).toBe(true);
    expect(f.planetOpen).toBe(false);
    expect(f.shipCount).toBe(1);
    expect(f.shipParked).toBe(true);
    expect(f.colonies).toBe(0);
    expect(f.exploredRegions).toBe(0);
    snap.meta[META_SPEED] = 2;
    snap.meta[META_PENDING_COUNT] = 1;
    readTutorialFacts(snap, { starSelected: false, planet: L.planet }, f);
    expect(f.speed).toBe(2);
    expect(f.pendingCards).toBe(1);
    expect(f.planetOpen).toBe(true);
    const start = snap.planetRegionStart[L.planet];
    let explored = 0;
    for (let i = 0; i < snap.planetRegionCount[L.planet]; i++)
      if (snap.regionFog[start + i] === FOG_EXPLORED) explored++;
    expect(f.exploredRegions).toBe(explored);
  });
});
