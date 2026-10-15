import type { RerouteShipCommand } from '../shared/commands';
import type { Snapshot } from '../shared/snapshot';
import { gateReply, gateSend, gateSnapshot } from './commandGate';
import { el, setClass, setDisabled, setHidden, setText } from './dom';
import {
  buildReroutePanelModel,
  createRerouteScratch,
  createRerouteSession,
  fillRerouteSig,
  REROUTE_SIG_LENGTH,
  selectShip,
  selectTargetSystem,
  type ReroutePanelModel,
} from './rerouteModel';

export interface ReroutePanel {
  /** Read a snapshot (the main-thread mirror); rebuilds only when the ship or target changed. */
  update(snap: Snapshot): void;
  /** Select a ship by entity id (-1 to deselect). */
  selectShip(entity: number): void;
  /** A star was clicked: true when it was taken as a reroute target (a ship is selected). */
  pickSystem(system: number): boolean;
  /** The worker answered the last RerouteShip; `text` is the reject message when not ok. */
  commandReply(ok: boolean, text: string): void;
  selectedShip(): number;
  dispose(): void;
}

export interface ReroutePanelOptions {
  onConfirm(cmd: RerouteShipCommand): void;
  /** Ring radius (world units) and the lit systems for the map; radius 0 clears both. */
  onRange(radiusWorld: number, reachable: Uint8Array | null): void;
  /** System to draw the preview line to, or -1. */
  onPreview(system: number): void;
  /** The player pressed 'Open planet' (a ground expedition blocks the ship): open this planet. */
  onOpenPlanet(planet: number): void;
  /** The player closed the panel (deselect the ship). */
  onClose(): void;
}

/**
 * Reroute panel (M3b). With a ship selected it shows the range ring's meaning ("click a lit star"),
 * then for a clicked target the preview from the shared reroutePreview: new ETA, supply margin,
 * fuel penalty and fuel left, the unload option, a red warning under 100% margin and a Confirm
 * button guarded by a CommandGate so one click sends one command.
 */
export function createReroutePanel(root: HTMLElement, opts: ReroutePanelOptions): ReroutePanel {
  const session = createRerouteSession();
  const scratch = createRerouteScratch();
  let latest: Snapshot | null = null;
  let okPending = false;
  let message = '';

  const panel = el('aside', 'hud-panel rr-panel', root);
  panel.setAttribute('aria-label', 'Reroute ship');
  panel.hidden = true;
  const head = el('div', 'mc-head', panel);
  const title = el('h2', 'hud-title', head, 'Reroute');
  const close = el('button', 'hud-btn mc-toggle', head, 'Close');
  close.type = 'button';
  const shipLine = el('div', 'mc-dim', panel);
  const hint = el('div', 'hud-body', panel);
  const openBtn = el('button', 'hud-btn hud-btn--primary', panel, 'Open planet');
  openBtn.type = 'button';
  openBtn.hidden = true;
  let openPlanet = -1;
  const targetBox = el('div', 'mc-card', panel);
  const targetTitle = el('div', 'mc-card-title', targetBox);
  const planetSelect = el('select', 'mc-select', targetBox);
  planetSelect.setAttribute('aria-label', 'Target planet');
  const nums = el('div', 'mc-nums', targetBox);
  const numRow = (label: string): HTMLElement => {
    el('span', 'mc-dim', nums, label);
    return el('span', 'mc-num', nums);
  };
  const etaEl = numRow('New ETA');
  const marginEl = numRow('Supply margin');
  const penaltyEl = numRow('Course change');
  const tripEl = numRow('Fuel for new leg');
  const afterEl = numRow('Fuel left');
  const unloadEl = el('div', 'mc-dim', targetBox);
  const warnEl = el('div', 'mc-warn', targetBox);
  const confirm = el('button', 'hud-btn mc-launch', targetBox, 'Confirm course change');
  confirm.type = 'button';
  const problemEl = el('div', 'mc-problem', panel);
  problemEl.setAttribute('role', 'status');

  const sig = new Int32Array(REROUTE_SIG_LENGTH);
  const lastSig = new Int32Array(REROUTE_SIG_LENGTH);
  let haveSig = false;
  let model: ReroutePanelModel | null = null;
  let renderedSystem = -2;
  let renderedLabels = '';

  function sigDiffers(): boolean {
    for (let i = 0; i < REROUTE_SIG_LENGTH; i++) if (sig[i] !== lastSig[i]) return true;
    return false;
  }

  function render(m: ReroutePanelModel): void {
    model = m;
    const visible = session.ship >= 0;
    setHidden(panel, !visible);
    if (!visible) return;
    setText(title, m.title);
    setText(shipLine, m.shipLine);
    setText(hint, m.hint);
    setHidden(hint, m.hint === '');
    openPlanet = m.openPlanet;
    setHidden(openBtn, openPlanet < 0);
    openBtn.setAttribute('aria-label', 'Open the planet where the expedition is on the ground');
    const showTarget = m.mode === 'preview';
    setHidden(targetBox, !showTarget);
    if (showTarget) {
      setText(targetTitle, `Target: ${m.target}`);
      const labels = m.planets.map((p) => p.label).join('|');
      if (renderedSystem !== session.system || renderedLabels !== labels) {
        renderedSystem = session.system;
        renderedLabels = labels;
        planetSelect.length = 0;
        for (const p of m.planets) planetSelect.add(new Option(p.label, String(p.slot)));
      }
      const want = String(m.chosenSlot);
      if (planetSelect.value !== want) planetSelect.value = want;
      const hasNumbers = m.command !== null || m.warn !== '';
      setText(etaEl, hasNumbers ? m.eta : '-');
      setText(marginEl, hasNumbers ? m.margin : '-');
      setClass(marginEl, `mc-num ${m.marginClass}`);
      setText(penaltyEl, hasNumbers ? m.fuelPenalty : '-');
      setText(tripEl, hasNumbers ? m.fuelTrip : '-');
      setText(afterEl, hasNumbers ? m.fuelAfter : '-');
      setText(unloadEl, m.unload);
      setText(warnEl, m.warn);
      setHidden(warnEl, m.warn === '');
      setDisabled(confirm, !m.confirmEnabled);
      setText(confirm, session.gate.awaiting ? 'Sending...' : 'Confirm course change');
    }
    setText(problemEl, message);
    opts.onRange(m.radiusWorld, m.radiusWorld > 0 ? m.reachable : null);
    opts.onPreview(m.previewSystem);
  }

  function rebuild(): void {
    if (!latest) return;
    render(buildReroutePanelModel(latest, session, scratch));
    fillRerouteSig(latest, session, lastSig);
    haveSig = true;
  }

  close.addEventListener('click', () => opts.onClose());
  openBtn.addEventListener('click', () => {
    if (openPlanet >= 0) opts.onOpenPlanet(openPlanet);
  });
  planetSelect.addEventListener('change', () => {
    session.slot = Number(planetSelect.value);
    message = '';
    rebuild();
  });
  confirm.addEventListener('click', () => {
    const cmd = model?.command;
    if (!cmd || !model?.confirmEnabled) return;
    if (!gateSend(session.gate)) return;
    message = '';
    opts.onConfirm(cmd);
    rebuild();
  });

  return {
    update(snap) {
      latest = snap;
      if (gateSnapshot(session.gate) && okPending) {
        // The course change went through: the old target is meaningless now.
        okPending = false;
        session.system = -1;
        session.slot = 0;
        message = 'Course changed.';
        haveSig = false;
      }
      fillRerouteSig(snap, session, sig);
      if (haveSig && !sigDiffers()) return;
      rebuild();
    },
    selectShip(entity) {
      if (entity === session.ship) return;
      selectShip(session, entity);
      message = '';
      renderedSystem = -2;
      if (latest) rebuild();
      else if (entity < 0) setHidden(panel, true);
    },
    pickSystem(system) {
      if (!latest || session.ship < 0) return false;
      message = '';
      selectTargetSystem(session, latest, system, scratch);
      rebuild();
      return true;
    },
    commandReply(ok, text) {
      gateReply(session.gate, ok);
      if (ok) okPending = true;
      else message = text;
      if (latest) rebuild();
    },
    selectedShip() {
      return session.ship;
    },
    dispose() {
      panel.remove();
    },
  };
}
