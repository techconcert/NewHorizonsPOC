import type { ExploreRegionCommand, ReEmbarkCommand } from '../shared/commands';
import type { Snapshot } from '../shared/snapshot';
import {
  createCommandGate,
  gateReply,
  gateSend,
  gateSnapshot,
  type CommandGate,
} from './commandGate';
import { ExpeditionStatus } from '../shared/planetfall';
import { el, setClass, setDisabled, setHidden, setText } from './dom';
import { createFactorTable, type FactorTable } from './factorTable';
import {
  buildExplorePlan,
  buildExpeditionStatus,
  buildReEmbarkView,
  type ExplorePlan,
  type ExpeditionStatusView,
  type ReEmbarkView,
} from './expeditionModel';
import { buildShipSupplyView } from './shipSupplyModel';
import { regionName } from './planetRegions';
import { setSecondRegion, setSplit, type PlanetContext, type PlanetSession } from './planetSession';

export interface ExpeditionPanelOptions {
  onExplore(cmd: ExploreRegionCommand): void;
  onReEmbark(cmd: ReEmbarkCommand): void;
  /** The second region or the split flag changed (the map highlights the second region). */
  onSessionChanged(): void;
  /** Put focus back on the control that opened the confirmation (the region card's Explore). */
  focusTrigger(): void;
}

export interface ExpeditionPanel {
  update(snap: Snapshot, session: PlanetSession, ctx: PlanetContext): void;
  /** The region card's Explore button: ask for the confirmation step for the selected region. */
  arm(): void;
  /** Cancel an armed confirmation. Returns true when there was one (Escape uses this first). */
  cancelArmed(): boolean;
  /** True when the selected region could be explored now (idle expedition, frontier region). */
  canExplore(): boolean;
  commandReply(kind: 'explore' | 'embark', ok: boolean, text: string): void;
  dispose(): void;
}

interface PreviewDom {
  box: HTMLElement;
  title: HTMLElement;
  table: FactorTable;
  chance: HTMLElement;
  clamp: HTMLElement;
  hazard: HTMLElement;
  ambush: HTMLElement;
}

/**
 * Button texts here ('Explore', 'Confirm: explore', 'Re-embark the expedition') are clicked by text
 * in the browser smoke script: keep them stable.
 *
 * Expedition panel: the status of the team on the ground, the exploration flow (pick a region
 * next to explored land, press Explore on the region card, read the chance of every region with
 * all its factors, confirm; Bold names a second region, other stances may split into two teams)
 * and the re-embark offer. Confirm and Re-embark are guarded by CommandGates.
 */
export function createExpeditionPanel(
  root: HTMLElement,
  opts: ExpeditionPanelOptions,
): ExpeditionPanel {
  const exploreGate: CommandGate = createCommandGate();
  let shownProgress = -1;
  const embarkGate: CommandGate = createCommandGate();
  let armed = false;
  let armedRegion = -1;
  /** The chances shown when the confirmation was armed: a change disarms it. */
  let armedChances = '';
  let exploreMessage = '';
  let embarkMessage = '';
  let latest: Snapshot | null = null;
  let session: PlanetSession | null = null;
  let ctx: PlanetContext | null = null;
  let plan: ExplorePlan | null = null;
  let reembark: ReEmbarkView | null = null;
  let status: ExpeditionStatusView | null = null;

  const panel = el('section', 'hud-panel pv-panel', root);
  panel.setAttribute('aria-label', 'Expedition');
  panel.hidden = true;
  el('h2', 'hud-title', panel, 'Expedition');
  const statusEl = el('div', 'pv-status', panel);
  statusEl.setAttribute('role', 'status');
  const teamEl = el('div', '', panel);
  const foodEl = el('div', 'pv-food', panel);
  const metaEl = el('div', 'mc-dim', panel);
  const roundEl = el('div', '', panel);
  const bar = el('div', 'mc-bar', panel);
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Exploration round progress');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const barFill = el('div', 'mc-bar-fill', bar);
  const oddsEl = el('div', 'mc-dim', panel);
  const depotEl = el('div', 'mc-dim', panel);
  const shipFoodEl = el('div', 'pv-shipfood', panel);
  const shipWarnEl = el('div', 'mc-warn', panel);
  shipWarnEl.setAttribute('role', 'status');

  const exploreBox = el('div', 'mc-card', panel);
  const exploreTitle = el('div', 'mc-card-title', exploreBox, 'Explore');
  const hintEl = el('div', 'mc-dim', exploreBox);
  const previews: PreviewDom[] = [];
  for (let i = 0; i < 2; i++) {
    const box = el('div', 'pv-preview', exploreBox);
    const title = el('div', 'pv-subtitle', box);
    const table = createFactorTable(box, 'Chance of exploring, by factor', 'Chance so far');
    const chance = el('div', 'pv-chance', box);
    const clamp = el('div', 'mc-warn', box);
    const hazard = el('div', 'mc-dim', box);
    const ambush = el('div', 'mc-dim', box);
    previews.push({ box, title, table, chance, clamp, hazard, ambush });
  }
  const summaryEl = el('div', 'mc-dim', exploreBox);
  const autoEl = el('div', 'mc-dim', exploreBox);

  const splitRow = el('div', 'mc-row', exploreBox);
  const splitLabel = el('label', 'pv-check', splitRow);
  const splitBox = el('input', '', splitLabel);
  splitBox.type = 'checkbox';
  el('span', '', splitLabel, 'Split the team in two (faster, riskier)');
  const splitWhy = el('div', 'mc-dim', exploreBox);
  const secondRow = el('div', 'mc-row', exploreBox);
  const secondLabel = el('label', 'mc-label', secondRow, 'Second region');
  const secondSelect = el('select', 'mc-select', secondRow);
  secondSelect.id = 'pv-second-region';
  secondLabel.htmlFor = 'pv-second-region';

  const confirmRow = el('div', 'mc-row', exploreBox);
  const confirmBtn = el('button', 'hud-btn mc-launch', confirmRow, 'Confirm: explore');
  confirmBtn.type = 'button';
  const cancelBtn = el('button', 'hud-btn', confirmRow, 'Cancel');
  cancelBtn.type = 'button';
  const exploreProblem = el('div', 'mc-problem', exploreBox);
  exploreProblem.setAttribute('role', 'status');

  const embarkBox = el('div', 'mc-card', panel);
  el('div', 'mc-card-title', embarkBox, 'Re-embark');
  el(
    'div',
    'mc-hint',
    embarkBox,
    'Bring the party back aboard so the ship can leave, reroute or land again.',
  );
  const embarkText = el('div', 'mc-dim', embarkBox);
  const embarkBtn = el('button', 'hud-btn hud-btn--primary', embarkBox, 'Re-embark the expedition');
  embarkBtn.type = 'button';
  const embarkProblem = el('div', 'mc-problem', embarkBox);
  embarkProblem.setAttribute('role', 'status');

  function disarm(): void {
    armed = false;
    armedRegion = -1;
    armedChances = '';
  }

  function chancesOf(p: ExplorePlan): string {
    return p.previews.map((v) => v.chance).join('/');
  }

  splitBox.addEventListener('change', () => {
    if (!session) return;
    setSplit(session, splitBox.checked);
    opts.onSessionChanged();
    refresh();
  });
  secondSelect.addEventListener('change', () => {
    if (!session) return;
    setSecondRegion(session, Number(secondSelect.value));
    opts.onSessionChanged();
    refresh();
  });
  function cancelArmed(): boolean {
    if (!armed) return false;
    disarm();
    exploreMessage = '';
    refresh();
    opts.focusTrigger();
    return true;
  }
  cancelBtn.addEventListener('click', () => {
    cancelArmed();
  });
  confirmBtn.addEventListener('click', () => {
    const cmd = plan?.command;
    if (!armed || !cmd || !gateSend(exploreGate)) return;
    exploreMessage = '';
    opts.onExplore(cmd);
    disarm();
    refresh();
    opts.focusTrigger();
  });
  embarkBtn.addEventListener('click', () => {
    const cmd = reembark?.command;
    if (!cmd || !gateSend(embarkGate)) return;
    embarkMessage = '';
    opts.onReEmbark(cmd);
    refresh();
  });

  function writePreview(d: PreviewDom, p: ExplorePlan['previews'][number] | null): void {
    setHidden(d.box, p === null);
    if (p === null) return;
    setText(d.title, p.label);
    d.table.update(p.rows);
    setText(d.chance, `Chance of exploring ${p.label}: ${p.chance}%`);
    setText(d.clamp, p.clampText);
    setHidden(d.clamp, p.clampText === '');
    setText(d.hazard, p.hazardText);
    const note = p.ambushText !== '' ? p.ambushText : p.nativeNote;
    setText(d.ambush, note);
    setHidden(d.ambush, note === '');
  }

  function refresh(): void {
    if (!latest || !session || !ctx) return;
    const snap = latest;
    status = buildExpeditionStatus(snap, ctx.expRow);
    const show = status !== null && status.live;
    setHidden(panel, !show);
    if (!show || status === null) {
      plan = null;
      reembark = null;
      return;
    }
    setText(
      statusEl,
      `${status.statusLabel}${status.status === ExpeditionStatus.Active ? `, ${status.stanceName} stance` : ''}`,
    );
    setText(teamEl, status.teamText);
    setText(foodEl, status.foodText);
    setClass(foodEl, `pv-food food-${status.foodCue}`);
    setText(metaEl, status.exploredText);
    setText(roundEl, status.roundText);
    // Style and attribute writes only when the percentage changed (M8 perf pass).
    if (status.progressPct !== shownProgress) {
      shownProgress = status.progressPct;
      barFill.style.width = `${status.progressPct}%`;
      bar.setAttribute('aria-valuenow', String(status.progressPct));
    }
    setHidden(bar, status.progressPct === 0 && status.idle);
    setText(oddsEl, status.oddsText);
    setText(depotEl, status.depotText);
    const food = buildShipSupplyView(snap, ctx.shipRow, ctx.expRow);
    setText(shipFoodEl, food?.text ?? '');
    setHidden(shipFoodEl, food === null);
    setText(shipWarnEl, food?.warning ?? '');
    setHidden(shipWarnEl, !food || food.warning === '');

    plan = buildExplorePlan(
      snap,
      session.planet,
      ctx.expRow,
      session.region,
      session.region2,
      session.split,
    );
    // A different region or a different shown chance (the world moved) needs a fresh decision.
    if (armed && (armedRegion !== session.region || armedChances !== chancesOf(plan))) disarm();
    const frontierChosen = plan.command !== null || plan.previews.length > 0;
    setHidden(exploreBox, !status.idle && !frontierChosen && plan.problem === null);
    setText(
      hintEl,
      plan.problem !== null && !armed
        ? plan.problem
        : session.region >= 0
          ? `Selected: ${regionName(session.region)}`
          : '',
    );
    for (let i = 0; i < previews.length; i++) {
      writePreview(previews[i], i < plan.previews.length ? plan.previews[i] : null);
    }
    setText(summaryEl, plan.summary);
    setHidden(summaryEl, plan.summary === '');
    setText(autoEl, plan.autoNote);
    setHidden(autoEl, plan.autoNote === '');

    // Controls: split (non-Bold) and the second region (Bold, or a split).
    const showSplit = status.idle && !plan.bold;
    setHidden(splitRow, !showSplit);
    splitBox.checked = session.split && plan.canSplit;
    splitBox.disabled = !plan.canSplit;
    setText(splitWhy, !plan.bold && !plan.canSplit ? plan.splitProblem : '');
    setHidden(splitWhy, plan.bold || plan.canSplit || !status.idle);
    const showSecond = status.idle && (plan.bold || session.split);
    setHidden(secondRow, !showSecond);
    if (showSecond) {
      const want = plan.region2Options.join(',');
      if (secondSelect.dataset.options !== `${want}|${plan.bold}`) {
        secondSelect.dataset.options = `${want}|${plan.bold}`;
        secondSelect.length = 0;
        secondSelect.add(
          new Option(plan.bold ? 'Automatic (the simulation picks)' : 'Choose a region', '-1'),
        );
        for (const r of plan.region2Options) secondSelect.add(new Option(regionName(r), String(r)));
      }
      if (secondSelect.value !== String(session.region2))
        secondSelect.value = String(session.region2);
    }

    const canConfirm = armed && plan.command !== null && !exploreGate.awaiting;
    setHidden(confirmRow, !armed);
    setDisabled(confirmBtn, !canConfirm);
    setText(
      confirmBtn,
      exploreGate.awaiting
        ? 'Sending...'
        : session.region >= 0
          ? `Confirm: explore ${regionName(session.region)}${plan.mode === 'split' || (plan.bold && session.region2 >= 0) ? ` and ${regionName(session.region2)}` : ''}${plan.previews.length > 0 ? ` (chance ${plan.previews.map((v) => `${v.chance}%`).join(' and ')})` : ''}`
          : 'Confirm: explore',
    );
    setText(exploreProblem, armed && plan.problem !== null ? plan.problem : exploreMessage);
    setText(exploreTitle, armed ? 'Explore: confirm the round' : 'Explore');

    reembark = buildReEmbarkView(snap, ctx.expRow, ctx.shipRow);
    setHidden(embarkBox, !reembark.available && reembark.problem === '');
    setText(embarkText, reembark.text);
    setDisabled(embarkBtn, !reembark.available || embarkGate.awaiting);
    setText(embarkBtn, embarkGate.awaiting ? 'Sending...' : 'Re-embark the expedition');
    setText(embarkProblem, reembark.problem !== '' ? reembark.problem : embarkMessage);
  }

  return {
    update(snap, s, c) {
      gateSnapshot(exploreGate);
      gateSnapshot(embarkGate);
      latest = snap;
      session = s;
      ctx = c;
      refresh();
    },
    arm() {
      if (!session || !plan || plan.mode === 'none') {
        // Nothing valid to confirm: refresh so the hint says why.
        refresh();
        return;
      }
      armed = true;
      armedRegion = session.region;
      armedChances = chancesOf(plan);
      refresh();
      confirmBtn.focus();
    },
    cancelArmed,
    canExplore() {
      return status !== null && status.idle;
    },
    commandReply(kind, ok, text) {
      // A late or duplicate reply for a panel that is not waiting must not touch it.
      if (!(kind === 'explore' ? exploreGate : embarkGate).awaiting) return;
      if (kind === 'explore') {
        gateReply(exploreGate, ok);
        exploreMessage = ok ? '' : text;
      } else {
        gateReply(embarkGate, ok);
        embarkMessage = ok ? '' : text;
      }
      refresh();
    },
    dispose() {
      panel.remove();
    },
  };
}
