import type { Command } from '../shared/commands';
import type { Snapshot } from '../shared/snapshot';
import type { CommandKind } from './commandGate';
import { createExpeditionPanel } from './expeditionPanel';
import { createFormationPanel } from './formationPanel';
import { createFoundingPanel } from './foundingPanel';
import { createPlanetPanel } from './planetPanel';
import type { PlanetContext, PlanetSession } from './planetSession';
import { createRollPanel } from './rollPanel';

export interface PlanetUiOptions {
  onBack(): void;
  /** A region was picked in the list or the card (local index). */
  onSelectRegion(region: number): void;
  /** The second region or the split flag changed in the session. */
  onSessionChanged(): void;
  /** One of several parked ships was picked (entity id). */
  onPickShip(entity: number): void;
  onCommand(command: Command, kind: CommandKind): void;
}

export interface PlanetUi {
  /** Rebuild every panel from the snapshot. Call after each snapshot while the planet view is open. */
  update(snap: Snapshot, session: PlanetSession, ctx: PlanetContext): void;
  showTooltip(snap: Snapshot, planet: number, region: number, sx: number, sy: number): void;
  /** A reply for one of the planetfall command kinds arrived. */
  commandReply(kind: CommandKind, ok: boolean, text: string): void;
  focusBack(): void;
  /** Cancel an armed confirmation in any panel. Returns true when one was armed. */
  cancelArmed(): boolean;
  dispose(): void;
}

/**
 * The planet view's DOM: one column holding the planet panel, the formation panel, the
 * expedition panel, the last roll and the founding panel. It reuses the right column container
 * class, so it stacks under the other panels at narrow widths (the existing <800px rule).
 */
export function createPlanetUi(parent: HTMLElement, opts: PlanetUiOptions): PlanetUi {
  const col = document.createElement('div');
  col.className = 'hud-col-right pv-col';
  parent.appendChild(col);

  // Panels refer to each other (the region card's Explore button arms the expedition panel).
  let expedition: ReturnType<typeof createExpeditionPanel> | null = null;
  const planet = createPlanetPanel(col, {
    onBack: opts.onBack,
    onSelectRegion: opts.onSelectRegion,
    onExplore: () => expedition?.arm(),
    onPickShip: opts.onPickShip,
  });
  const formation = createFormationPanel(col, {
    onForm: (cmd) => opts.onCommand(cmd, 'form'),
  });
  expedition = createExpeditionPanel(col, {
    onExplore: (cmd) => opts.onCommand(cmd, 'explore'),
    onReEmbark: (cmd) => opts.onCommand(cmd, 'embark'),
    onSessionChanged: opts.onSessionChanged,
    focusTrigger: () => planet.focusExplore(),
  });
  const founding = createFoundingPanel(col, {
    onFound: (cmd) => opts.onCommand(cmd, 'found'),
    focusFallback: () => planet.focusBack(),
  });
  const rolls = createRollPanel(col);

  return {
    update(snap, session, ctx) {
      // Expedition first: its canExplore() feeds the region card's Explore button.
      expedition?.update(snap, session, ctx);
      planet.update(snap, session, ctx, expedition?.canExplore() ?? false);
      formation.update(snap, ctx);
      founding.update(snap, session, ctx);
      rolls.update(snap, ctx.expRow);
    },
    showTooltip: (snap, p, region, sx, sy) => planet.showTooltip(snap, p, region, sx, sy),
    commandReply(kind, ok, text) {
      if (kind === 'form') formation.commandReply(ok, text);
      else if (kind === 'explore' || kind === 'embark') expedition?.commandReply(kind, ok, text);
      else if (kind === 'found') founding.commandReply(ok, text);
    },
    focusBack: () => planet.focusBack(),
    cancelArmed: () => (expedition?.cancelArmed() ?? false) || founding.cancelArmed(),
    dispose() {
      planet.dispose();
      formation.dispose();
      expedition?.dispose();
      founding.dispose();
      rolls.dispose();
      col.remove();
    },
  };
}
