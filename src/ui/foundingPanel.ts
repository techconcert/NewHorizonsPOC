import type { FoundColonyCommand } from '../shared/commands';
import type { Snapshot } from '../shared/snapshot';
import { createCommandGate, gateReply, gateSend, gateSnapshot } from './commandGate';
import { el, setClass, setDisabled, setHidden, setText } from './dom';
import { createFactorTable } from './factorTable';
import { buildFoundingView, type FoundingView } from './foundingModel';
import { buildShipSupplyView } from './shipSupplyModel';
import { regionName } from './planetRegions';
import type { PlanetContext, PlanetSession } from './planetSession';
import { colonyTierText } from './colonyModel';

export interface FoundingPanelOptions {
  onFound(cmd: FoundColonyCommand): void;
  /** Focus a stable control (Back) when the Found button is gone or disabled. */
  focusFallback(): void;
}

export interface FoundingPanel {
  update(snap: Snapshot, session: PlanetSession, ctx: PlanetContext): void;
  /** Cancel an armed confirmation. Returns true when there was one (Escape uses this first). */
  cancelArmed(): boolean;
  commandReply(ok: boolean, text: string): void;
  dispose(): void;
}

/**
 * Button texts ('Found colony here', 'Confirm: found a colony in ...') are clicked by text in the
 * browser smoke script: keep them stable.
 *
 * Found colony panel: the six factors of the founding roll for the selected explored region plus
 * the research placeholder, the resulting chance, the three tiers and what each one costs or
 * gives, all before the commit. Confirm is guarded by a CommandGate. After the roll the recorded
 * breakdown is in the Last roll panel and the colony line says which tier happened.
 */
export function createFoundingPanel(root: HTMLElement, opts: FoundingPanelOptions): FoundingPanel {
  const gate = createCommandGate();
  let view: FoundingView | null = null;
  let message = '';
  let armed = false;
  let armedRegion = -1;
  /** The chance shown when the confirmation was armed: a change disarms it. */
  let armedChance = '';

  const panel = el('section', 'hud-panel pv-panel', root);
  panel.setAttribute('aria-label', 'Found colony');
  panel.hidden = true;
  el('h2', 'hud-title', panel, 'Found colony');
  const site = el('div', '', panel);
  const colonyLine = el('div', 'pv-colony', panel);
  const table = createFactorTable(panel, 'Chance of founding, by factor', 'Chance so far');
  const chance = el('div', 'pv-chance', panel);
  const shipFoodEl = el('div', 'pv-shipfood', panel);
  const shipWarnEl = el('div', 'mc-warn', panel);
  shipWarnEl.setAttribute('role', 'status');
  const research = el(
    'div',
    'mc-dim',
    panel,
    'Research bonus: not available yet (placeholder, +0%).',
  );
  research.setAttribute('data-placeholder', 'research');
  const tiersEl = el('ul', 'pv-tiers', panel);
  const tierItems = [0, 1, 2].map(() => el('li', 'pv-tier', tiersEl));
  const row = el('div', 'mc-row', panel);
  const found = el('button', 'hud-btn mc-launch', row, 'Found colony here');
  found.type = 'button';
  // The confirmation is a separate button so a double-click on 'Found colony here' cannot confirm.
  const confirmRow = el('div', 'mc-row', panel);
  const confirm = el('button', 'hud-btn mc-launch', confirmRow);
  confirm.type = 'button';
  const cancel = el('button', 'hud-btn', confirmRow, 'Cancel');
  cancel.type = 'button';
  const problem = el('div', 'mc-problem', panel);
  problem.setAttribute('role', 'status');

  found.addEventListener('click', () => {
    if (!view || view.problem !== null || !view.command || armed) return;
    armed = true;
    armedRegion = view.region;
    armedChance = view.chanceText;
    refreshLast();
    confirm.focus();
  });
  confirm.addEventListener('click', () => {
    if (!armed || !view || view.problem !== null || !view.command) return;
    if (!gateSend(gate)) return;
    message = '';
    armed = false;
    armedChance = '';
    opts.onFound(view.command);
    refreshLast();
    opts.focusFallback();
  });
  function cancelArmed(): boolean {
    if (!armed) return false;
    armed = false;
    armedChance = '';
    refreshLast();
    found.focus();
    return true;
  }
  cancel.addEventListener('click', () => {
    cancelArmed();
  });

  let last: { snap: Snapshot; session: PlanetSession; ctx: PlanetContext } | null = null;
  function refreshLast(): void {
    if (last) render(last.snap, last.session, last.ctx);
  }

  function render(snap: Snapshot, session: PlanetSession, ctx: PlanetContext): void {
    const colonised = ctx.colonyRow >= 0;
    const live = ctx.expRow >= 0;
    view =
      live && !colonised
        ? buildFoundingView(snap, session.planet, ctx.expRow, session.region)
        : null;
    setHidden(panel, view === null && !colonised);
    if (colonised) {
      setHidden(site, true);
      setHidden(table.root, true);
      setHidden(chance, true);
      setHidden(research, true);
      setHidden(tiersEl, true);
      setHidden(row, true);
      setHidden(confirmRow, true);
      setText(colonyLine, colonyTierText(snap, ctx.colonyRow));
      setHidden(colonyLine, false);
      setText(problem, '');
      return;
    }
    setHidden(colonyLine, true);
    if (view === null) return;
    if (armed && (armedRegion !== view.region || armedChance !== view.chanceText)) armed = false;
    setHidden(site, false);
    setText(
      site,
      view.siteText !== '' ? `Site: ${view.siteText}` : 'Site: pick an explored region on the map.',
    );
    const detail = view.rows.length > 0;
    setHidden(table.root, !detail);
    setHidden(chance, !detail);
    setHidden(research, !detail);
    setHidden(tiersEl, !detail);
    if (detail) {
      table.update(view.rows);
      setText(chance, `Chance of founding: ${view.chanceText}`);
      const food = buildShipSupplyView(snap, ctx.shipRow, ctx.expRow);
      setText(shipFoodEl, food?.text ?? '');
      setHidden(shipFoodEl, food === null);
      setText(shipWarnEl, food?.warning ?? '');
      setHidden(shipWarnEl, !food || food.warning === '');
      for (let i = 0; i < tierItems.length; i++) {
        const t = view.tiers[i];
        setText(tierItems[i], `${t.name} (${t.oddsText}): ${t.consequence}`);
        setClass(tierItems[i], `pv-tier pv-tier-${t.name.toLowerCase()}`);
      }
    }
    const blocked = view.problem !== null || view.command === null;
    setHidden(row, (!detail && blocked) || armed);
    setHidden(confirmRow, !armed);
    setDisabled(found, blocked || gate.awaiting);
    setDisabled(confirm, blocked || gate.awaiting);
    setText(found, gate.awaiting ? 'Sending...' : 'Found colony here');
    setText(
      confirm,
      gate.awaiting
        ? 'Sending...'
        : `Confirm: found a colony in ${regionName(view.region)} (chance ${view.chanceText})`,
    );
    setText(problem, view.problem ?? message);
  }

  return {
    update(snap, session, ctx) {
      gateSnapshot(gate);
      last = { snap, session, ctx };
      render(snap, session, ctx);
    },
    cancelArmed,
    commandReply(ok, text) {
      if (!gate.awaiting) return;
      gateReply(gate, ok);
      message = ok ? '' : text;
      refreshLast();
    },
    dispose() {
      panel.remove();
    },
  };
}
