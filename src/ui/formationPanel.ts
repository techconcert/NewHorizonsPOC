import type { FormExpeditionCommand } from '../shared/commands';
import { STANCE_NAMES } from '../shared/planetfall';
import { liveExpeditionRowOfShip } from '../shared/planetSnapshot';
import type { Snapshot } from '../shared/snapshot';
import { createCommandGate, gateReply, gateSend, gateSnapshot } from './commandGate';
import { el, setClass, setDisabled, setHidden, setText } from './dom';
import { createFactorTable } from './factorTable';
import {
  buildFormationView,
  createFormationState,
  formationLimitsOf,
  syncFormation,
  type FormationLimits,
  type FormationView,
} from './formationModel';
import type { PlanetContext } from './planetSession';

export interface FormationPanelOptions {
  onForm(cmd: FormExpeditionCommand): void;
}

export interface FormationPanel {
  update(snap: Snapshot, ctx: PlanetContext): void;
  commandReply(ok: boolean, text: string): void;
  dispose(): void;
}

interface SliderDom {
  row: HTMLElement;
  input: HTMLInputElement;
  value: HTMLElement;
}

/**
 * The button text 'Land the expedition' is clicked by text in the browser smoke script: keep it stable.
 *
 * Formation panel: shown when a ship is waiting in orbit and no expedition is out. Sliders for
 * explorers, escort, supplies and survey kit, three stance buttons, and the live exploration
 * chance with every factor, so each choice shows its effect before Land is pressed. The Land
 * button is guarded by a CommandGate like Launch and Reroute.
 */
export function createFormationPanel(
  root: HTMLElement,
  opts: FormationPanelOptions,
): FormationPanel {
  const state = createFormationState();
  const gate = createCommandGate();
  let limits: FormationLimits | null = null;
  let nativeDisp = 0;
  let shipEntity = -1;
  let message = '';

  const panel = el('section', 'hud-panel pv-panel', root);
  panel.setAttribute('aria-label', 'Form an expedition');
  panel.hidden = true;
  el('h2', 'hud-title', panel, 'Form an expedition');
  el(
    'div',
    'mc-dim',
    panel,
    'Land a team from the ship. Explorers are colonists taken from the ship.',
  );

  function slider(label: string, onInput: (v: number) => void): SliderDom {
    const row = el('div', 'mc-row', panel);
    const lab = el('label', 'mc-label', row, label);
    const input = el('input', 'mc-range', row);
    input.type = 'range';
    input.min = '0';
    input.step = '1';
    const id = `pv-form-${label.toLowerCase().replace(/\W+/g, '-')}`;
    input.id = id;
    lab.htmlFor = id;
    const value = el('span', 'mc-value', row);
    input.addEventListener('input', () => {
      onInput(Number(input.value));
      refresh();
    });
    return { row, input, value };
  }
  const sExplorers = slider('Explorers', (v) => (state.explorers = v));
  const sGuards = slider('Escort', (v) => (state.guards = v));
  const sSupplies = slider('Supplies', (v) => (state.supplies = v));
  const sKit = slider('Survey kit', (v) => (state.kit = v));

  const stanceRow = el('div', 'mc-row', panel);
  el('span', 'mc-label', stanceRow, 'Stance');
  const stanceBox = el('span', 'mc-seg', stanceRow);
  stanceBox.setAttribute('role', 'radiogroup');
  stanceBox.setAttribute('aria-label', 'Stance');
  const stanceButtons: HTMLButtonElement[] = [];
  STANCE_NAMES.forEach((name, i) => {
    const b = el('button', 'hud-btn', stanceBox, name);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      state.stance = i;
      refresh();
    });
    stanceButtons.push(b);
  });
  const stanceText = el('div', 'mc-dim', panel);

  const table = createFactorTable(
    panel,
    'Exploration chance per region, by factor',
    'Chance so far',
  );
  const chanceEl = el('div', 'pv-chance', panel);
  chanceEl.setAttribute('role', 'status');
  const hazardEl = el('div', 'mc-dim', panel);
  const foodEl = el('div', 'pv-food', panel);
  const nativesEl = el('div', 'mc-dim', panel);
  const depotEl = el('div', 'mc-dim', panel);
  const formBtn = el('button', 'hud-btn mc-launch', panel, 'Land the expedition');
  formBtn.type = 'button';
  const problemEl = el('div', 'mc-problem', panel);
  problemEl.setAttribute('role', 'status');
  let view: FormationView | null = null;

  formBtn.addEventListener('click', () => {
    const cmd = view?.command;
    if (!cmd || !gateSend(gate)) return;
    message = '';
    opts.onForm(cmd);
    refresh();
  });

  function writeSlider(s: SliderDom, v: number, max: number, text: string, show: boolean): void {
    setHidden(s.row, !show);
    if (s.input.max !== String(max)) s.input.max = String(max);
    if (s.input.valueAsNumber !== v) s.input.value = String(v);
    s.input.setAttribute('aria-valuetext', text);
    setText(s.value, text);
  }

  function refresh(): void {
    if (!limits) return;
    syncFormation(state, limits, shipEntity);
    view = buildFormationView(state, limits, nativeDisp, shipEntity);
    writeSlider(
      sExplorers,
      state.explorers,
      limits.colonists,
      `${state.explorers} of ${limits.colonists}`,
      true,
    );
    writeSlider(
      sGuards,
      state.guards,
      limits.security,
      `${state.guards} of ${limits.security}`,
      limits.security > 0,
    );
    writeSlider(
      sSupplies,
      state.supplies,
      limits.supplies,
      `${state.supplies} of ${limits.supplies}`,
      true,
    );
    writeSlider(sKit, state.kit, limits.kit, `${state.kit} of ${limits.kit}`, limits.kit > 0);
    for (let i = 0; i < stanceButtons.length; i++) {
      const on = i === state.stance;
      setClass(stanceButtons[i], on ? 'hud-btn active' : 'hud-btn');
      stanceButtons[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
    setText(stanceText, view.stanceText);
    table.update(view.rows);
    setText(chanceEl, `Exploration chance: ${view.chanceText}`);
    setText(hazardEl, view.hazardText);
    setText(foodEl, view.foodText);
    setClass(foodEl, `pv-food food-${view.foodCue}`);
    setText(nativesEl, view.nativesText);
    setText(depotEl, view.depotText);
    setDisabled(formBtn, view.command === null || gate.awaiting);
    setText(formBtn, gate.awaiting ? 'Landing...' : 'Land the expedition');
    setText(problemEl, view.problem ?? message);
  }

  return {
    update(snap, ctx) {
      gateSnapshot(gate);
      const eligible =
        ctx.shipRow >= 0 &&
        liveExpeditionRowOfShip(snap, ctx.shipEntity) < 0 &&
        snap.planetOwned[ctx.planet] === 0;
      setHidden(panel, !eligible);
      if (!eligible) {
        limits = null;
        return;
      }
      limits = formationLimitsOf(snap, ctx.shipRow, false);
      nativeDisp = snap.planetNative[ctx.planet];
      shipEntity = ctx.shipEntity;
      refresh();
    },
    commandReply(ok, text) {
      if (!gate.awaiting) return;
      gateReply(gate, ok);
      message = ok ? '' : text;
      refresh();
    },
    dispose() {
      panel.remove();
    },
  };
}
