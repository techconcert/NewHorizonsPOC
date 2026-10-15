import type { GameSpeed } from '../shared/commands';
import {
  META_DAY,
  META_HOME_DAYS,
  META_HOME_SYSTEM,
  META_PENDING_COUNT,
  META_RESUME_SPEED,
  META_SPEED,
  META_SYSTEM_COUNT,
  type Snapshot,
} from '../shared/snapshot';
import { colonySummary } from './colonyModel';
import { goalText } from './endScreenModel';
import { clockShort, colonyShort, goalShort, researchShort } from './hudText';
import { researchSummary } from './techModel';
import { DOUBLE_CLICK_HINT } from './openPlanetModel';
import { describe } from './dom';
import { HUD_HELP } from './helpText';

export const STAR_NAMES: readonly string[] = [
  'Red dwarf',
  'Orange star',
  'Yellow star',
  'White star',
  'Blue star',
];

export interface Hud {
  /** The top bar, for the menu buttons. */
  readonly bar: HTMLElement;
  /** Read from a snapshot (or its mirror). Touches the DOM only for values that changed. */
  update(snap: Snapshot): void;
  setSelected(index: number): void;
  /** The map camera is in (true) or out of (false) the selected system: swaps the zoom button text. */
  setZoomState(inSystem: boolean): void;
  setStatus(text: string): void;
  /** Remove the HUD from the DOM. */
  dispose(): void;
}

export interface HudOptions {
  onSpeed(speed: GameSpeed): void;
  /** Where the system panel goes (a column container); defaults to the root. */
  panelRoot?: HTMLElement;
  /** 'Zoom to system': fly the map camera into the selected star. */
  onZoomSystem?(): void;
  /** 'Zoom out': fly back out to the galaxy. */
  onZoomOut?(): void;
}

const SPEEDS: readonly { speed: GameSpeed; label: string }[] = [
  { speed: 0, label: 'Pause' },
  { speed: 1, label: '1x' },
  { speed: 2, label: '2x' },
  { speed: 4, label: '4x' },
];

function el(tag: string, className: string, parent: HTMLElement, text = ''): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** HUD text for pending cards, '' when none. The game is held paused until they are answered. */
export function eventText(pending: number, resumeSpeed: number): string {
  if (pending <= 0) return '';
  const cards = pending === 1 ? 'Event card pending' : `${pending} event cards pending`;
  return resumeSpeed > 0 ? `${cards}: paused, resumes at ${resumeSpeed}x` : `${cards}: paused`;
}

function hazardLabel(h: number): string {
  return h < 25 ? 'Low' : h < 50 ? 'Moderate' : h < 75 ? 'High' : 'Severe';
}

/** Minimal DOM HUD: top bar (day, homeworld clock, speed) and a selected-system side panel. */
export function createHud(root: HTMLElement, opts: HudOptions): Hud {
  const bar = el('div', 'hud-bar', root);
  bar.setAttribute('role', 'banner');
  bar.setAttribute('aria-label', 'Game status and menu');
  // One row of stats; long ones are cut with an ellipsis (the full text is the tooltip).
  const stats = el('div', 'hud-stats', bar);
  /** A stat with a full text (wide screens) and a short one (under 1500 px, CSS picks); the tooltip is always the full text. */
  const stat = (cls: string, full: string, short: string): HTMLElement => {
    const node = el('span', `hud-stat ${cls}`, stats);
    el('span', 'hs-full', node, full);
    el('span', 'hs-short', node, short);
    node.title = full;
    return node;
  };
  /** Sentence of help for each stat; the tooltip is `<current text>. <help>`. */
  const helpFor = new Map<HTMLElement, string>();
  const tip = (node: HTMLElement, text: string): string => {
    const h = helpFor.get(node);
    return h ? `${text}. ${h}` : text;
  };
  /** Register the help sentence of a stat: an aria-describedby note now, a title with every update. */
  const withHelp = (node: HTMLElement, help: string): void => {
    helpFor.set(node, help);
    describe(node, help, stats);
  };
  const dayEl = el('span', 'hud-stat hud-day', stats, 'Day 0');
  const clockEl = stat('hud-clock', 'Homeworld: -', 'Home: -');
  const colonyEl = stat('hud-colonies', 'Colonies: none yet', 'Colonies 0/3');
  colonyEl.setAttribute('aria-label', 'Colonies');
  const researchEl = stat('hud-research', '', '');
  researchEl.setAttribute('aria-label', 'Research');
  const goalEl = stat('hud-goal', '', '');
  goalEl.setAttribute('aria-label', 'Goal');
  withHelp(dayEl, HUD_HELP.day);
  withHelp(clockEl, HUD_HELP.clock);
  withHelp(colonyEl, HUD_HELP.colonies);
  withHelp(researchEl, HUD_HELP.research);
  withHelp(goalEl, HUD_HELP.goal);
  /** Set the text and the matching tooltip (the full text), only called when it changed. */
  const show = (node: HTMLElement, text: string, short: string = text): void => {
    (node.firstElementChild as HTMLElement).textContent = text;
    (node.lastElementChild as HTMLElement).textContent = short;
    node.title = tip(node, text);
  };
  const speedBox = el('span', 'hud-speeds', bar);
  const buttons: HTMLElement[] = [];
  for (const s of SPEEDS) {
    const b = el('button', 'hud-btn', speedBox, s.label);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => opts.onSpeed(s.speed));
    buttons.push(b);
  }
  const eventEl = el('span', 'hud-event', bar);
  eventEl.hidden = true;
  eventEl.setAttribute('role', 'status');
  eventEl.setAttribute('aria-live', 'polite');
  const statusEl = el('span', 'hud-status', bar);

  const panel = el('aside', 'hud-panel', opts.panelRoot ?? root);
  panel.setAttribute('aria-label', 'Selected system');
  el('h2', 'hud-title', panel, 'System');
  const bodyEl = el('div', 'hud-body', panel, 'Click a star to inspect it.');
  const rows = [
    el('div', 'hud-row', panel),
    el('div', 'hud-row', panel),
    el('div', 'hud-row', panel),
    el('div', 'hud-row', panel),
  ];
  for (const r of rows) r.hidden = true;
  // Buttons are matched by text in the smoke script: 'Zoom to system' and 'Zoom out' (never 'Back to galaxy').
  const zoomBtn = el('button', 'hud-btn', panel, 'Zoom to system') as HTMLButtonElement;
  zoomBtn.type = 'button';
  zoomBtn.hidden = true;
  const dblHint = el('div', 'mc-dim hud-hint', panel, DOUBLE_CLICK_HINT);
  dblHint.hidden = true;
  let inSystem = false;
  zoomBtn.addEventListener('click', () => {
    if (inSystem) opts.onZoomOut?.();
    else opts.onZoomSystem?.();
  });

  let lastDay = -1;
  let lastClock = -1;
  let lastSpeed = -1;
  let lastResume = -1;
  let lastColonyText = '';
  let lastResearch = '';
  let lastGoal = '';
  let selected = -1;
  // Cache of what the panel currently shows, to skip identical writes.
  let shownSel = -2; // -2 nothing rendered yet, -1 empty-state text shown
  let shownStar = -1;
  let shownPlanets = -1;
  let shownHazard = -1;
  let shownHome = false;

  function renderPanel(snap: Snapshot): void {
    const n = snap.meta[META_SYSTEM_COUNT];
    if (selected < 0 || selected >= n) {
      if (shownSel !== -1) {
        shownSel = -1;
        bodyEl.hidden = false;
        for (const r of rows) r.hidden = true;
        zoomBtn.hidden = true;
        dblHint.hidden = true;
      }
      return;
    }
    const star = snap.starType[selected];
    const planets = snap.planetCount[selected];
    const hazard = snap.hazard[selected];
    const home = snap.meta[META_HOME_SYSTEM] === selected;
    if (
      selected === shownSel &&
      star === shownStar &&
      planets === shownPlanets &&
      hazard === shownHazard &&
      home === shownHome
    ) {
      return;
    }
    shownSel = selected;
    shownStar = star;
    shownPlanets = planets;
    shownHazard = hazard;
    shownHome = home;
    bodyEl.hidden = true;
    for (const r of rows) r.hidden = false;
    zoomBtn.hidden = planets === 0;
    dblHint.hidden = !(inSystem && planets > 0);
    rows[0].textContent = home ? `System ${selected} (homeworld)` : `System ${selected}`;
    rows[1].textContent = `Star: ${STAR_NAMES[star] ?? 'Unknown'}`;
    rows[2].textContent = `Planets: ${planets}`;
    rows[3].textContent = `Hazard: ${hazardLabel(hazard)} (${hazard})`;
  }

  return {
    bar,
    update(snap) {
      const day = snap.meta[META_DAY];
      if (day !== lastDay) {
        lastDay = day;
        dayEl.textContent = `Day ${day}`;
        dayEl.title = tip(dayEl, `Day ${day}`);
      }
      const clock = snap.meta[META_HOME_DAYS];
      if (clock !== lastClock) {
        lastClock = clock;
        show(clockEl, `Homeworld: ${clock} days left`, clockShort(snap));
      }
      const speed = snap.meta[META_SPEED];
      const pending = snap.meta[META_PENDING_COUNT];
      const resume = pending > 0 ? snap.meta[META_RESUME_SPEED] : -1;
      if (speed !== lastSpeed || resume !== lastResume) {
        lastSpeed = speed;
        lastResume = resume;
        // While a card waits the game is held at 0; the speed the player picked is only
        // remembered and resumes after the card (D-055), so mark it as queued, not active.
        for (let i = 0; i < SPEEDS.length; i++) {
          buttons[i].classList.toggle('active', SPEEDS[i].speed === speed);
          buttons[i].setAttribute('aria-pressed', SPEEDS[i].speed === speed ? 'true' : 'false');
          buttons[i].classList.toggle('queued', resume > 0 && SPEEDS[i].speed === resume);
        }
      }
      const text = eventText(pending, snap.meta[META_RESUME_SPEED]);
      if (eventEl.textContent !== text) {
        eventEl.textContent = text;
        eventEl.title = text;
        eventEl.hidden = text === '';
      }
      const colonyText = colonySummary(snap).text;
      if (colonyText !== lastColonyText) {
        lastColonyText = colonyText;
        show(colonyEl, colonyText, colonyShort(snap));
      }
      const research = researchSummary(snap);
      if (research !== lastResearch) {
        lastResearch = research;
        show(researchEl, research, researchShort(snap));
      }
      const goal = goalText(snap);
      if (goal !== lastGoal) {
        lastGoal = goal;
        show(goalEl, goal, goalShort(snap));
      }
      renderPanel(snap);
    },
    setSelected(index) {
      selected = index;
      shownSel = -2; // force a refresh on the next update
    },
    setZoomState(value) {
      inSystem = value;
      dblHint.hidden = !(value && shownPlanets > 0);
      zoomBtn.textContent = value ? 'Zoom out' : 'Zoom to system';
    },
    setStatus(text) {
      if (statusEl.textContent !== text) statusEl.textContent = text;
    },
    dispose() {
      bar.remove();
      panel.remove();
    },
  };
}
