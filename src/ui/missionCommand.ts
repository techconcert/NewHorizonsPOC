import type { LaunchShipCommand } from '../shared/commands';
import { formatExpectedEvents } from '../shared/transit';
import {
  HULL_NAMES,
  PROBLEM_TEXT,
  SPEED_NAMES,
  hullCapacity,
  type CargoDialId,
} from '../shared/loadout';
import {
  C_FUEL,
  C_POPULATION,
  C_PRODUCTION,
  C_SUPPLIES,
  COLONY_STRIDE,
  META_SHIP_COUNT,
  type Snapshot,
} from '../shared/snapshot';
import { describe } from './dom';
import { DIAL_HELP, HULL_HELP, MARGIN_HELP } from './helpText';
import {
  buildView,
  CARGO_DIAL_IDS,
  chooseDestination,
  chooseHull,
  createLaunchGate,
  createMissionState,
  dialAmountText,
  dialsOnScreen,
  arrivalFoodCue,
  arrivalFoodText,
  foundingGradeText,
  formatOdds,
  formatRange,
  gateSent,
  gateSettled,
  launchCommand,
  launchEnabled,
  launchingColonyRow,
  marginClass,
  setDial,
  setSpeed,
  sliderMax,
  surveyLabel,
  type MissionState,
} from './missionModel';

export interface MissionCommand {
  /** New snapshot (the main-thread mirror): refresh stockpile-dependent numbers if they changed. */
  update(snap: Snapshot): void;
  /** The player selected a system on the galaxy map. */
  setSystem(index: number): void;
  /** The player picked a planet of the selected system on the system map (keeps the dropdown in step). */
  setPlanet(slot: number): void;
  /** The worker answered the last command: the Launch button may enable again. */
  commandSettled(): void;
  dispose(): void;
}

export interface MissionCommandOptions {
  onLaunch(cmd: LaunchShipCommand): void;
  /** The destination planet changed through the dropdown (slot in the system). */
  onPlanetChange?(slot: number): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: HTMLElement,
  text = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** Write text only when it differs from the last value written through this helper. */
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** A toggled class or flag that remembers what it last wrote. */
interface Flag {
  on: boolean;
}

const MAX_PLANETS_SHOWN = 5;
/** Snapshot values that, when unchanged, mean the preview cannot have changed. */
const SIG_LENGTH = 8 + MAX_PLANETS_SHOWN * 4;

/**
 * Basic DOM Mission Command (M2): destination card, hull selector, the six dials (five cargo
 * sliders and the speed selector), cargo bar, live derived numbers and Launch. Every input event
 * recomputes the preview synchronously from the latest snapshot with the shared LoadoutMath.
 * Snapshot updates recompute only when the launching colony, the destination's planets or the
 * ship count changed, and every DOM write is guarded against the last written value.
 */
export function createMissionCommand(
  root: HTMLElement,
  opts: MissionCommandOptions,
): MissionCommand {
  const state: MissionState = createMissionState();
  const gate = createLaunchGate();
  let snap: Snapshot | null = null;

  const panel = el('aside', 'hud-panel mc-panel', root);
  panel.setAttribute('aria-label', 'Mission Command');
  const head = el('div', 'mc-head', panel);
  el('h2', 'hud-title', head, 'Mission Command');
  const toggle = el('button', 'hud-btn mc-toggle', head, 'Hide');
  const body = el('div', 'mc-body', panel);
  toggle.addEventListener('click', () => {
    body.hidden = !body.hidden;
    toggle.textContent = body.hidden ? 'Show' : 'Hide';
  });

  // Destination card
  const dest = el('div', 'mc-card', body);
  const destTitle = el('div', 'mc-card-title', dest, 'Destination: click a star');
  const planetSelect = el('select', 'mc-select', dest);
  planetSelect.setAttribute('aria-label', 'Destination planet');
  const destInfo = el('div', 'mc-dim', dest);
  const fromInfo = el('div', 'mc-dim', dest);

  // Hull selector
  const hullRow = el('div', 'mc-row', body);
  const hullLabel = el('span', 'mc-label', hullRow, 'Hull');
  const hullBox = el('span', 'mc-seg', hullRow);
  const hullButtons: HTMLButtonElement[] = [];
  const hullActive: Flag[] = [];
  for (let i = 0; i < HULL_NAMES.length; i++) {
    const b = el('button', 'hud-btn', hullBox, HULL_NAMES[i]);
    b.addEventListener('click', () => {
      chooseHull(state, i, snap);
      inputChanged();
    });
    hullButtons.push(b);
    hullActive.push({ on: false });
  }

  describe(hullLabel, HULL_HELP, hullRow, hullButtons);

  // Cargo bar
  const bar = el('div', 'mc-bar', body);
  const barFill = el('div', 'mc-bar-fill', bar);
  const barText = el('div', 'mc-bar-text', body);
  let shownBarWidth = '';
  const barFull: Flag = { on: false };

  // The six dials, exactly the shared dial list. Arrays are indexed like CARGO_DIAL_IDS.
  const sliderInputs: HTMLInputElement[] = [];
  const sliderValues: HTMLElement[] = [];
  const shownMax: number[] = [];
  const speedButtons: HTMLButtonElement[] = [];
  const speedActive: Flag[] = [];
  for (const dial of dialsOnScreen()) {
    const row = el('div', 'mc-row', body);
    const dialLabel = el('span', 'mc-label', row, dial.name);
    const help = DIAL_HELP[dial.id] ?? '';
    if (dial.kind === 'speed') {
      const box = el('span', 'mc-seg', row);
      for (let i = 0; i < SPEED_NAMES.length; i++) {
        const b = el('button', 'hud-btn', box, SPEED_NAMES[i]);
        b.addEventListener('click', () => {
          setSpeed(state, i);
          inputChanged();
        });
        speedButtons.push(b);
        speedActive.push({ on: false });
      }
      describe(dialLabel, help, row, speedButtons.slice(-SPEED_NAMES.length));
    } else {
      const idx = CARGO_DIAL_IDS.indexOf(dial.id as CargoDialId);
      const id = CARGO_DIAL_IDS[idx];
      const input = el('input', 'mc-range', row);
      input.type = 'range';
      input.min = '0';
      input.step = '1';
      input.value = String(state[id]);
      input.setAttribute('aria-label', dial.name);
      const value = el('span', 'mc-value', row);
      input.addEventListener('input', () => {
        setDial(state, id, Number(input.value));
        inputChanged();
      });
      describe(dialLabel, help, row, [input]);
      sliderInputs[idx] = input;
      sliderValues[idx] = value;
      shownMax[idx] = -1;
    }
  }

  // Derived numbers
  const nums = el('div', 'mc-nums', body);
  const numRow = (label: string): HTMLElement => {
    el('span', 'mc-dim', nums, label);
    return el('span', 'mc-num', nums);
  };
  const etaEl = numRow('ETA');
  const eventsEl = numRow('Expected events');
  const rangeEl = numRow('Range');
  const marginEl = numRow('Supply margin');
  describe(marginEl, MARGIN_HELP, nums);
  const foodEl = numRow('Food on arrival');
  const gradeEl = numRow('Founding-grade margin');
  const oddsEl = numRow('Founding odds');
  oddsEl.classList.add('mc-key');
  gradeEl.classList.add('mc-key');
  const costEl = numRow('Production cost');
  const warnEl = el('div', 'mc-warn', body);
  warnEl.hidden = true;
  const launchBtn = el('button', 'hud-btn mc-launch', body, 'Launch');
  const problemEl = el('div', 'mc-problem', body);
  const shipsEl = el('div', 'mc-dim', body);
  let shownMarginClass = '';
  const rangeBad: Flag = { on: false };

  launchBtn.addEventListener('click', () => {
    if (!snap) return;
    const cmd = launchCommand(state, snap);
    if (cmd && launchEnabled(gate, null)) {
      gateSent(gate);
      opts.onLaunch(cmd);
      inputChanged();
    }
  });

  planetSelect.addEventListener('change', () => {
    chooseDestination(state, state.system, Number(planetSelect.value), snap);
    inputChanged();
    opts.onPlanetChange?.(state.planetSlot);
  });

  // Change tracking: user inputs bump the version; snapshots compare a small signature.
  let inputVersion = 0;
  let renderedInputVersion = -1;
  const sig = new Int32Array(SIG_LENGTH);
  const lastSig = new Int32Array(SIG_LENGTH);
  let haveSig = false;

  function inputChanged(): void {
    inputVersion++;
    refresh();
  }

  /** Fill `sig` from the snapshot: colony row, ship count and the destination system's planets. */
  function readSignature(s: Snapshot): void {
    const row = launchingColonyRow(s);
    const o = row * COLONY_STRIDE;
    sig[0] = row;
    sig[1] = row >= 0 ? s.colonies[o + C_POPULATION] : 0;
    sig[2] = row >= 0 ? s.colonies[o + C_SUPPLIES] : 0;
    sig[3] = row >= 0 ? s.colonies[o + C_FUEL] : 0;
    sig[4] = row >= 0 ? s.colonies[o + C_PRODUCTION] : 0;
    sig[5] = s.meta[META_SHIP_COUNT];
    const n = state.system >= 0 ? s.planetCount[state.system] : 0;
    sig[6] = n;
    sig[7] = state.system >= 0 ? s.systemPlanetStart[state.system] : 0;
    for (let i = 0; i < MAX_PLANETS_SHOWN; i++) {
      const b = 8 + i * 4;
      if (i < n) {
        const p = sig[7] + i;
        sig[b] = s.planetSurvey[p];
        sig[b + 1] = s.planetHabLo[p];
        sig[b + 2] = s.planetHabHi[p];
        sig[b + 3] = s.planetOwned[p];
      } else {
        sig[b] = sig[b + 1] = sig[b + 2] = sig[b + 3] = 0;
      }
    }
  }

  function sigChanged(): boolean {
    if (!haveSig) return true;
    for (let i = 0; i < SIG_LENGTH; i++) if (sig[i] !== lastSig[i]) return true;
    return false;
  }

  function setActive(btn: HTMLElement, flag: Flag, on: boolean): void {
    if (flag.on !== on) {
      flag.on = on;
      btn.classList.toggle('active', on);
    }
  }

  let shownPlanetsSystem = -2;
  let shownPlanetCount = -1;

  function syncPlanets(s: Snapshot): void {
    const n = state.system >= 0 ? s.planetCount[state.system] : 0;
    if (shownPlanetsSystem !== state.system || shownPlanetCount !== n) {
      shownPlanetsSystem = state.system;
      shownPlanetCount = n;
      planetSelect.length = 0;
      for (let i = 0; i < n; i++) planetSelect.add(new Option('', String(i)));
      planetSelect.hidden = n === 0;
    }
    // Option text is rebuilt here only: this runs when the signature (survey, ranges, owners) changed.
    for (let i = 0; i < n; i++) {
      const p = s.systemPlanetStart[state.system] + i;
      const owned = s.planetOwned[p] !== 0 ? ', colony' : '';
      const text = `Planet ${i + 1} (${surveyLabel(s.planetSurvey[p])}, habitability ${s.planetHabLo[p]} to ${s.planetHabHi[p]}%${owned})`;
      const opt = planetSelect.options[i];
      if (opt.text !== text) opt.text = text;
    }
    const want = String(state.planetSlot);
    if (planetSelect.value !== want) planetSelect.value = want;
  }

  function refresh(): void {
    renderedInputVersion = inputVersion;
    // Controls reflect the state first, so they never lag the numbers.
    for (let i = 0; i < hullButtons.length; i++)
      setActive(hullButtons[i], hullActive[i], i === state.hull);
    for (let i = 0; i < speedButtons.length; i++)
      setActive(speedButtons[i], speedActive[i], i === state.speed);
    for (let i = 0; i < CARGO_DIAL_IDS.length; i++) {
      const id = CARGO_DIAL_IDS[i];
      const input = sliderInputs[i];
      const max = sliderMax(state, id);
      if (shownMax[i] !== max) {
        shownMax[i] = max;
        input.max = String(max);
      }
      if (input.valueAsNumber !== state[id]) input.value = String(state[id]);
      setText(sliderValues[i], `${state[id]} steps, ${dialAmountText(id, state[id])}`);
    }
    if (!snap) return;
    syncPlanets(snap);
    setText(shipsEl, `Ships launched: ${snap.meta[META_SHIP_COUNT]}`);
    const view = buildView(state, snap);
    if (!view) {
      setText(destTitle, state.system < 0 ? 'Destination: click a star' : `System ${state.system}`);
      setText(destInfo, '');
      setText(fromInfo, '');
      setText(etaEl, '-');
      setText(eventsEl, '-');
      setText(rangeEl, '-');
      setText(marginEl, '-');
      setText(foodEl, '-');
      setText(gradeEl, '-');
      setText(oddsEl, '-');
      setText(costEl, '-');
      if (!warnEl.hidden) warnEl.hidden = true;
      if (!launchBtn.disabled) launchBtn.disabled = true;
      setText(problemEl, state.system < 0 ? 'Select a destination.' : 'No launching colony.');
      return;
    }
    const p = view.preview;
    setText(destTitle, `System ${state.system}, planet ${state.planetSlot + 1}`);
    setText(
      destInfo,
      `${surveyLabel(view.survey)}: habitability ${view.habLo} to ${view.habHi}%. Distance ${formatRange(p.distanceFp)} units.`,
    );
    setText(fromInfo, `From colony ${view.colonyEntity}.`);
    const frac = p.cargoCapacity > 0 ? Math.min(100, (p.cargoUsed * 100) / p.cargoCapacity) : 0;
    const width = `${frac}%`;
    if (width !== shownBarWidth) {
      shownBarWidth = width;
      barFill.style.width = width;
    }
    const full = p.cargoUsed >= p.cargoCapacity;
    if (barFull.on !== full) {
      barFull.on = full;
      barFill.classList.toggle('full', full);
    }
    setText(barText, `Cargo ${p.cargoUsed} / ${hullCapacity(state.hull)}`);
    setText(etaEl, `${p.etaDays} days`);
    setText(eventsEl, `${formatExpectedEvents(view.expectedEventsX100)} cards`);
    setText(rangeEl, `${formatRange(p.rangeFp)} units (needs ${formatRange(p.distanceFp)})`);
    const bad = p.rangeFp < p.distanceFp;
    if (rangeBad.on !== bad) {
      rangeBad.on = bad;
      rangeEl.classList.toggle('bad', bad);
    }
    setText(marginEl, `${p.supplyMarginPct}%`);
    const mc = marginClass(p.supplyMarginPct);
    if (mc !== shownMarginClass) {
      shownMarginClass = mc;
      marginEl.className = `mc-num ${mc}`;
    }
    setText(foodEl, `${arrivalFoodText(p.arrivalFoodDays)} [${arrivalFoodCue(p.arrivalFoodDays)}]`);
    setText(gradeEl, foundingGradeText(p.foundingGradeMarginPct, p.supplyMarginPct));
    setText(oddsEl, formatOdds(p.oddsLo, p.oddsHi));
    setText(costEl, `${p.productionCost}`);
    const lowMargin = p.supplyMarginPct < 100;
    if (warnEl.hidden === lowMargin) warnEl.hidden = !lowMargin;
    if (lowMargin) {
      setText(
        warnEl,
        `Warning: supplies cover only ${p.supplyMarginPct}% of the trip. Colonists will starve.`,
      );
    }
    const disabled = !launchEnabled(gate, p.problem);
    if (launchBtn.disabled !== disabled) launchBtn.disabled = disabled;
    setText(
      problemEl,
      p.problem !== null ? PROBLEM_TEXT[p.problem] : gate.awaiting ? 'Launch sent...' : '',
    );
  }

  refresh();

  return {
    update(s) {
      snap = s;
      const wasAwaiting = gate.awaiting;
      gateSettled(gate);
      readSignature(s);
      if (!sigChanged() && renderedInputVersion === inputVersion && !wasAwaiting) return;
      lastSig.set(sig);
      haveSig = true;
      refresh();
    },
    setSystem(index) {
      chooseDestination(state, index, 0, snap);
      inputChanged();
    },
    setPlanet(slot) {
      if (state.system < 0 || slot === state.planetSlot) return;
      chooseDestination(state, state.system, slot, snap);
      inputChanged();
    },
    dispose() {
      panel.remove();
    },
    commandSettled() {
      gateSettled(gate);
      inputChanged();
    },
  };
}
