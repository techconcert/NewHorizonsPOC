import { WIN_COLONIES, WIN_HOLD_DAYS, WIN_POPULATION } from '../shared/colony';
import { FOG_EXPLORED } from '../shared/fog';
import { isParkedState } from '../shared/planetSnapshot';
import {
  META_COLONY_COUNT,
  META_PENDING_COUNT,
  META_SHIP_COUNT,
  META_SPEED,
  type Snapshot,
} from '../shared/snapshot';

/**
 * Guided first launch (M7c): a pure step machine. It reads facts that already exist in the snapshot
 * and in the view state (a star is selected, the planet view is open) and moves forward by itself
 * when the player does what a step asks. It never blocks play, never sends a command and keeps its
 * "seen" flag in memory only. The DOM lives in tutorialPanel.ts.
 */

export type TutorialStepId =
  | 'pick-star'
  | 'dials'
  | 'launch'
  | 'speed'
  | 'card'
  | 'arrival'
  | 'explore'
  | 'odds'
  | 'found'
  | 'colony'
  | 'goal';

export interface TutorialStep {
  id: TutorialStepId;
  title: string;
  text: string;
  /** CSS selectors of the element to point at; the first visible one is highlighted. */
  anchors: readonly string[];
}

/** The goal sentence for the current win rule (read from the shared constants). */
export function goalSentence(): string {
  return `Win by holding ${WIN_COLONIES} colonies of ${WIN_POPULATION}+ people for ${WIN_HOLD_DAYS} days in a row, before the homeworld clock runs out.`;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'pick-star',
    title: 'Pick a destination star',
    text: 'Click a star on the map. Brighter, surveyed stars are better known; Mission Command on the left then shows the trip.',
    anchors: ['#galaxy'],
  },
  {
    id: 'dials',
    title: 'Set the Mission Command dials',
    text: 'Split the ship cargo across the dials. Watch the Supply margin: red LOW means colonists starve on the way, green SAFE leaves room for delays. Press Next when you are ready.',
    anchors: ['.mc-panel'],
  },
  {
    id: 'launch',
    title: 'Launch',
    text: 'Press Launch. The ship leaves the homeworld and appears on the map and in the Ships list.',
    anchors: ['.mc-panel .mc-launch', '.mc-panel'],
  },
  {
    id: 'speed',
    title: 'Speed and event cards',
    text: 'Use Pause, 1x, 2x and 4x to run time; try 2x while the ship flies. The game pauses by itself when an event card arrives and resumes at your speed after you answer.',
    anchors: ['.hud-speeds'],
  },
  {
    id: 'card',
    title: 'Answer an event card',
    text: 'Each card offers two or three choices with their costs. Read them, pick one; there is no hidden free option. If no card comes, press Next.',
    anchors: ['.ec-card', '.hud-event'],
  },
  {
    id: 'arrival',
    title: 'Arrival: open the planet',
    text: 'When the ship is in orbit press Open planet (in the Planets list, or Open planet on the ship row) to enter the hex world.',
    anchors: ['.pv-panel', '.sl-panel'],
  },
  {
    id: 'explore',
    title: 'Explore regions and confirm',
    text: 'Form an expedition, pick a region and press Explore this region, then Confirm: explore. Explored land shows what a colony could use.',
    anchors: ['.pv-region', '.pv-col'],
  },
  {
    id: 'odds',
    title: 'Read the founding odds',
    text: 'The table shows each factor behind the chance to found a colony: habitability, site, supplies and kit. A bad roll is never hidden.',
    anchors: ['.pv-chance', '.pv-col'],
  },
  {
    id: 'found',
    title: 'Found the colony',
    text: 'Press Found colony here and confirm. A failed founding keeps the ship in orbit so you can try another site.',
    anchors: ['.pv-col .mc-launch', '.pv-col'],
  },
  {
    id: 'colony',
    title: 'Run the colony',
    text: 'In the Colonies panel set the stance toward natives, build districts on explored sites, and pick a technology in Research.',
    anchors: ['.col-panel', '.hud-col-right'],
  },
  {
    id: 'goal',
    title: 'The goal',
    text: goalSentence(),
    anchors: ['.hud-goal'],
  },
];

export const TUTORIAL_LENGTH = TUTORIAL_STEPS.length;

/** What the machine can see. Fill with {@link readTutorialFacts}; reuse one object. */
export interface TutorialFacts {
  /** A star is selected on the map. */
  starSelected: boolean;
  /** The planet view is open. */
  planetOpen: boolean;
  /** Ships in the snapshot. */
  shipCount: number;
  /** A ship is parked in orbit (arrived). */
  shipParked: boolean;
  /** Current game speed (0 paused). */
  speed: number;
  /** Event cards waiting. */
  pendingCards: number;
  /** Explored regions of the open planet (0 when none is open). */
  exploredRegions: number;
  /** Colonies founded off the homeworld. */
  colonies: number;
}

export function createTutorialFacts(): TutorialFacts {
  return {
    starSelected: false,
    planetOpen: false,
    shipCount: 0,
    shipParked: false,
    speed: 0,
    pendingCards: 0,
    exploredRegions: 0,
    colonies: 0,
  };
}

/** Sticky progress flags (bits in {@link TutorialState.seen}). */
const SEEN_STAR = 1;
const SEEN_LAUNCH = 2;
const SEEN_RUN = 4;
const SEEN_CARD = 8;
const SEEN_CARD_DONE = 16;
const SEEN_ARRIVAL = 32;
const SEEN_PLANET = 64;
const SEEN_EXPLORED = 128;
const SEEN_COLONY = 256;

export interface TutorialState {
  /** The coach-mark is on screen. */
  open: boolean;
  /** Index into {@link TUTORIAL_STEPS}. */
  step: number;
  /** The player skipped or finished it once in this page session (memory only). */
  seen: boolean;
  /** Reached the end. */
  finished: boolean;
  /** Back was pressed: stay on the chosen step until Next. */
  holding: boolean;
  /** Sticky progress flags seen in the current game. */
  progress: number;
  /** Explored regions on the open planet when it was first seen (baseline for step 7). */
  exploredBase: number;
}

export function createTutorial(): TutorialState {
  return {
    open: true,
    step: 0,
    seen: false,
    finished: false,
    holding: false,
    progress: 0,
    exploredBase: -1,
  };
}

/** Record what the facts show into the sticky flags. */
function record(s: TutorialState, f: TutorialFacts): void {
  if (f.starSelected) s.progress |= SEEN_STAR;
  if (f.shipCount > 0) s.progress |= SEEN_LAUNCH;
  if (f.shipCount > 0 && (f.speed >= 2 || f.pendingCards > 0)) s.progress |= SEEN_RUN;
  if (f.pendingCards > 0) s.progress |= SEEN_CARD;
  else if (s.progress & SEEN_CARD) s.progress |= SEEN_CARD_DONE;
  if (f.shipParked) s.progress |= SEEN_ARRIVAL;
  if (f.planetOpen) {
    s.progress |= SEEN_PLANET;
    if (s.exploredBase < 0) s.exploredBase = f.exploredRegions;
    else if (f.exploredRegions > s.exploredBase) s.progress |= SEEN_EXPLORED;
  }
  if (f.colonies > 0) s.progress |= SEEN_COLONY;
}

/** True when the player has done what step `i` asks (Next also moves on, see {@link next}). */
export function stepDone(s: TutorialState, i: number): boolean {
  const p = s.progress;
  const colony = (p & SEEN_COLONY) !== 0;
  switch (i) {
    case 0:
      return (p & (SEEN_STAR | SEEN_LAUNCH)) !== 0;
    case 1: // the dials step has no signal of its own: Next, or the launch itself
    case 2:
      return (p & SEEN_LAUNCH) !== 0;
    case 3:
      return (p & (SEEN_RUN | SEEN_ARRIVAL)) !== 0 || colony;
    case 4:
      return (p & (SEEN_CARD_DONE | SEEN_ARRIVAL)) !== 0 || colony;
    case 5:
      return (p & SEEN_PLANET) !== 0 || colony;
    case 6:
      return (p & SEEN_EXPLORED) !== 0 || colony;
    case 7: // the odds table: Next, or the founding itself
    case 8:
      return colony;
    default:
      return false; // 9 (colony panel) and 10 (goal) end with Next
  }
}

/**
 * Read new facts. Moves forward over every step the player has already done, unless Back is
 * holding the view on an earlier step. Returns true when the visible step changed.
 */
export function observe(s: TutorialState, f: TutorialFacts): boolean {
  record(s, f);
  if (!s.open || s.holding) return false;
  const before = s.step;
  // Step 1 (dials) is done by launching; every other step is done by its own flag, so a loaded
  // game with a colony skips straight to the colony panel.
  while (s.step < TUTORIAL_LENGTH - 1 && stepDone(s, s.step)) s.step++;
  return s.step !== before;
}

/** Next button: move one step on (the last step closes the guide). */
export function next(s: TutorialState): void {
  s.holding = false;
  if (s.step >= TUTORIAL_LENGTH - 1) {
    finish(s);
    return;
  }
  s.step++;
}

/** Back button: one step earlier, held there until Next. */
export function back(s: TutorialState): void {
  if (s.step <= 0) return;
  s.step--;
  s.holding = true;
}

function finish(s: TutorialState): void {
  s.open = false;
  s.finished = true;
  s.seen = true;
  s.holding = false;
}

/** Skip / Close button. The guide can be reopened from Help. */
export function skip(s: TutorialState): void {
  s.open = false;
  s.seen = true;
  s.holding = false;
}

/** Help button: show the guide again at the first step the player has not done yet. */
export function reopen(s: TutorialState, f: TutorialFacts): void {
  s.open = true;
  s.finished = false;
  s.holding = false;
  s.step = 0;
  observe(s, f);
}

/**
 * A new game or a loaded game: the progress belongs to the old world and is dropped. The guide
 * starts again only if it has not been seen in this page session (memory only, no storage).
 */
export function resetForNewWorld(s: TutorialState): void {
  s.progress = 0;
  s.exploredBase = -1;
  s.step = 0;
  s.holding = false;
  s.finished = false;
  s.open = !s.seen;
}

/** The step to show, or null when the guide is closed. */
export function currentStep(s: TutorialState): TutorialStep | null {
  return s.open ? TUTORIAL_STEPS[s.step] : null;
}

/** "Step 3 of 11". */
export function progressText(s: TutorialState): string {
  return `Step ${s.step + 1} of ${TUTORIAL_LENGTH}`;
}

/**
 * Read the facts from a snapshot and the view state into `out`. `planet` is the open planet or -1.
 * Loops over ships and (only with a planet open) its regions: cheap enough for each snapshot.
 */
export function readTutorialFacts(
  snap: Snapshot,
  view: { starSelected: boolean; planet: number },
  out: TutorialFacts,
): TutorialFacts {
  out.starSelected = view.starSelected;
  out.planetOpen = view.planet >= 0;
  const ships = snap.meta[META_SHIP_COUNT];
  out.shipCount = ships;
  out.shipParked = false;
  for (let i = 0; i < ships; i++) {
    if (isParkedState(snap.shipState[i])) {
      out.shipParked = true;
      break;
    }
  }
  out.speed = snap.meta[META_SPEED];
  out.pendingCards = snap.meta[META_PENDING_COUNT];
  out.exploredRegions = 0;
  if (view.planet >= 0) {
    const start = snap.planetRegionStart[view.planet];
    const n = snap.planetRegionCount[view.planet];
    for (let i = 0; i < n; i++)
      if (snap.regionFog[start + i] === FOG_EXPLORED) out.exploredRegions++;
  }
  out.colonies = Math.max(0, snap.meta[META_COLONY_COUNT] - 1);
  return out;
}
