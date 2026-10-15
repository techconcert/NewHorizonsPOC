import type { Command } from '../shared/commands';
import {
  C_ENTITY,
  COLONY_STRIDE,
  SNAPSHOT_REGIONS_PER_COLONY,
  type Snapshot,
} from '../shared/snapshot';
import { buildColonyView, colonyTitle, manageableRows, type ColonyView } from './colonyPanelModel';
import { createCommandGate, gateReply, gateSend, gateSnapshot } from './commandGate';
import { bindDetails, sectionAccordion } from './accordion';
import { el, setClass, setDisabled, setHidden, setText } from './dom';
import { openableColonyPlanet } from './openPlanetModel';

export interface ColonyPanelOptions {
  onCommand(command: Command): void;
  /** 'Open colony': zoom to the colony's planet (galaxy, system, then the hex world). */
  onOpenColony(planet: number): void;
}

export interface ColonyPanel {
  update(snap: Snapshot): void;
  commandReply(ok: boolean, text: string): void;
  /** Forget the selection, any in-flight command and the message (new game, load: D-110). */
  reset(): void;
  dispose(): void;
}

const MAX_COLONY_BUTTONS = 16;
const BUILD_BUTTONS = 6;
const STANCE_BUTTONS = 3;

/**
 * Colony panel (M5): pick a founded colony, read its stocks and daily flow, set the stance toward
 * the natives (Coexist / Defend / Push out), pick a site and start a district ("Build Farm" and
 * so on). One command at a time (CommandGate); a refusal shows under the buttons. Buttons are
 * created once and reused; text is written only when it changes.
 */
export function createColonyPanel(root: HTMLElement, opts: ColonyPanelOptions): ColonyPanel {
  const gate = createCommandGate();
  /** Selected colony by entity id (rows can shift when colonies collapse); -1 none (D-110). */
  let selectedEntity = -1;
  let selectedRow = 1;
  let selectedSite = -1;
  let message = '';
  let view: ColonyView | null = null;

  // A collapsible section: the title row toggles it, and only one of Colonies / Research is open.
  const panel = el('details', 'hud-panel col-panel', root);
  panel.setAttribute('aria-label', 'Colonies');
  el('summary', 'hud-title', panel, 'Colonies');
  const unbind = bindDetails(sectionAccordion, 'colonies', panel);
  const empty = el(
    'div',
    'hud-body',
    panel,
    'No colony founded yet. Land on a planet and found one.',
  );
  const body = el('div', 'col-body', panel);

  const tabs = el('div', 'col-tabs', body);
  const tabButtons: HTMLButtonElement[] = [];
  for (let i = 0; i < MAX_COLONY_BUTTONS; i++) {
    const b = el('button', 'hud-btn', tabs);
    b.type = 'button';
    b.addEventListener('click', () => {
      selectedRow = Number(b.dataset.row);
      selectedEntity = Number(b.dataset.entity);
      selectedSite = -1;
      message = '';
      render();
    });
    tabButtons.push(b);
  }
  const openBtn = el('button', 'hud-btn hud-btn--primary col-open', body, 'Open colony');
  openBtn.type = 'button';
  let openPlanet = -1;
  openBtn.addEventListener('click', () => {
    if (openPlanet >= 0) opts.onOpenColony(openPlanet);
  });
  const tierEl = el('div', 'col-line', body);
  const popEl = el('div', 'col-line', body);
  const stockEl = el('div', 'col-line', body);
  const flowEl = el('div', 'col-line mc-dim', body);
  const districtsEl = el('div', 'col-line', body);
  const nativesEl = el('div', 'col-line', body);
  const raidEl = el('div', 'col-line mc-warn', body);
  const starvingEl = el('div', 'col-line mc-warn', body);
  const crowdEl = el('div', 'col-line mc-warn', body);

  el('h3', 'col-sub', body, 'Stance toward the natives');
  const stanceRow = el('div', 'mc-row', body);
  const stanceButtons: HTMLButtonElement[] = [];
  for (let i = 0; i < STANCE_BUTTONS; i++) {
    const b = el('button', 'hud-btn', stanceRow);
    b.type = 'button';
    b.addEventListener('click', () => {
      const c = view?.stances[i].command;
      if (c !== undefined && gateSend(gate)) {
        message = '';
        opts.onCommand(c);
        render();
      }
    });
    stanceButtons.push(b);
  }
  const stanceText = el('div', 'col-line mc-dim', body);
  const pushEl = el('div', 'col-line mc-warn', body);

  el('h3', 'col-sub', body, 'Sites');
  const siteList = el('div', 'col-sites', body);
  const siteButtons: HTMLButtonElement[] = [];
  for (let i = 0; i < SNAPSHOT_REGIONS_PER_COLONY; i++) {
    const b = el('button', 'hud-btn col-site', siteList);
    b.type = 'button';
    b.addEventListener('click', () => {
      selectedSite = Number(b.dataset.local);
      message = '';
      render();
    });
    siteButtons.push(b);
  }
  const noSites = el('div', 'col-line mc-dim', body, 'No explored sites yet.');

  el('h3', 'col-sub', body, 'Build on the selected site');
  const buildRow = el('div', 'col-build', body);
  const buildButtons: HTMLButtonElement[] = [];
  const buildDetail: HTMLElement[] = [];
  for (let i = 0; i < BUILD_BUTTONS; i++) {
    const line = el('div', 'col-buildline', buildRow);
    const b = el('button', 'hud-btn', line);
    b.type = 'button';
    b.addEventListener('click', () => {
      const c = view?.options[i].command;
      if (c !== undefined && c !== null && gateSend(gate)) {
        message = '';
        opts.onCommand(c);
        render();
      }
    });
    buildButtons.push(b);
    buildDetail.push(el('span', 'mc-dim col-detail', line));
  }
  const problem = el('div', 'mc-problem', body);
  problem.setAttribute('role', 'status');

  let latest: Snapshot | null = null;

  function render(): void {
    const snap = latest;
    if (snap === null) return;
    const rows = manageableRows(snap);
    setHidden(empty, rows.length > 0);
    setHidden(body, rows.length === 0);
    if (rows.length === 0) {
      view = null;
      return;
    }
    // Find the selected colony by entity id; if it is gone, fall back to the first and drop the site.
    let found = -1;
    for (const r of rows) {
      if (snap.colonies[r * COLONY_STRIDE + C_ENTITY] === selectedEntity) found = r;
    }
    if (found < 0) {
      found = rows[0];
      selectedEntity = snap.colonies[found * COLONY_STRIDE + C_ENTITY];
      selectedSite = -1;
      message = '';
    }
    selectedRow = found;
    for (let i = 0; i < MAX_COLONY_BUTTONS; i++) {
      const b = tabButtons[i];
      const r = rows[i];
      setHidden(b, r === undefined);
      if (r === undefined) continue;
      b.dataset.row = String(r);
      b.dataset.entity = String(snap.colonies[r * COLONY_STRIDE + C_ENTITY]);
      setText(b, colonyTitle(r));
      setClass(b, r === selectedRow ? 'hud-btn active' : 'hud-btn');
    }
    openPlanet = openableColonyPlanet(snap, selectedRow);
    setDisabled(openBtn, openPlanet < 0);
    openBtn.title =
      openPlanet >= 0
        ? 'Zoom to this colony and open its hex world.'
        : 'The hex world of this colony cannot be opened right now.';
    view = buildColonyView(snap, selectedRow, selectedSite);
    if (view === null) return;
    const v = view;
    setText(tierEl, v.tier);
    setText(popEl, v.population);
    setText(stockEl, v.stocks);
    setText(flowEl, v.flow);
    setText(districtsEl, v.districts);
    setText(nativesEl, v.natives);
    setText(raidEl, v.raid);
    setHidden(raidEl, v.raid === '');
    setText(starvingEl, v.starving);
    setHidden(starvingEl, v.starving === '');
    setText(crowdEl, v.overHousing);
    setHidden(crowdEl, v.overHousing === '');
    for (let i = 0; i < STANCE_BUTTONS; i++) {
      const s = v.stances[i];
      setText(stanceButtons[i], s.label);
      setClass(stanceButtons[i], s.active ? 'hud-btn active' : 'hud-btn');
      stanceButtons[i].setAttribute('aria-pressed', s.active ? 'true' : 'false');
      setDisabled(stanceButtons[i], gate.awaiting || s.active);
    }
    setText(stanceText, v.stanceText);
    setText(pushEl, v.pushNote);
    setHidden(pushEl, v.pushNote === '');
    for (let i = 0; i < siteButtons.length; i++) {
      const b = siteButtons[i];
      const s = v.sites[i];
      setHidden(b, s === undefined);
      if (s === undefined) continue;
      b.dataset.local = String(s.local);
      setText(b, s.label);
      setClass(b, s.local === selectedSite ? 'hud-btn col-site active' : 'hud-btn col-site');
    }
    setHidden(noSites, v.sites.length > 0);
    for (let i = 0; i < BUILD_BUTTONS; i++) {
      const o = v.options[i];
      setText(buildButtons[i], o.label);
      setDisabled(buildButtons[i], o.command === null || gate.awaiting);
      setText(buildDetail[i], o.reason !== '' ? o.reason : o.detail);
    }
    setText(problem, message);
  }

  return {
    update(snap) {
      gateSnapshot(gate);
      latest = snap;
      render();
    },
    commandReply(ok, text) {
      gateReply(gate, ok);
      message = ok ? '' : text;
      render();
    },
    reset() {
      gate.awaiting = false;
      gate.replied = false;
      selectedEntity = -1;
      selectedRow = 1;
      selectedSite = -1;
      message = '';
      view = null;
      latest = null;
      setText(problem, '');
    },
    dispose() {
      unbind();
      panel.remove();
    },
  };
}
