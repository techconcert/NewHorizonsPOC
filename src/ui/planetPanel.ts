import {
  Disp,
  FOUND_TIER_NAMES,
  NATIVE_VARIANT_FLAVOUR,
  nativeKindText,
} from '../shared/planetfall';
import {
  C_POPULATION,
  CD_TIER,
  COLONY_DETAIL_STRIDE,
  COLONY_STRIDE,
  type Snapshot,
} from '../shared/snapshot';
import { nthParkedShipRowAt, parkedShipCountAt } from '../shared/planetSnapshot';
import { colonyTierText } from './colonyModel';
import { el, setClass, setDisabled, setHidden, setText } from './dom';
import { surveyLabel } from './missionModel';
import { regionInfo, type RegionInfo } from './planetRegions';
import type { PlanetContext, PlanetSession } from './planetSession';
import { planetLabel } from './shipListModel';

export interface PlanetPanelOptions {
  onBack(): void;
  onSelectRegion(region: number): void;
  /** The region card's Explore button: arm the exploration confirmation for the selected region. */
  onExplore(): void;
  /** The player picked one of several parked ships (entity id). */
  onPickShip(entity: number): void;
}

export interface PlanetPanel {
  /** Rebuild the summary, banner, region card and region list. */
  update(snap: Snapshot, session: PlanetSession, ctx: PlanetContext, canExplore: boolean): void;
  /** Hover tooltip: region -1 hides it. */
  showTooltip(snap: Snapshot, planet: number, region: number, sx: number, sy: number): void;
  focusBack(): void;
  /** Focus the region card's Explore button, or the Back button when Explore is not usable. */
  focusExplore(): void;
  dispose(): void;
}

const MAX_LIST = 19;

/** Native disposition text and the effect the design gives it, so contact is never just a colour. */
export function nativesBanner(disp: number, strength: number, variant = 0): string {
  const kind = nativeKindText(disp, variant);
  const about = variant > 0 ? ` ${NATIVE_VARIANT_FLAVOUR[variant]}` : '';
  if (disp === Disp.Peaceful) {
    return `CONTACT: ${kind} (strength ${strength}).${about} They guide the expedition: better exploration odds and shared food.`;
  }
  if (disp === Disp.Wary) {
    return `CONTACT: ${kind} (strength ${strength}).${about} They only watch for now; Security and your choices tilt them towards peaceful or hostile.`;
  }
  if (disp === Disp.Hostile) {
    return `DANGER, CONTACT: ${kind} (strength ${strength}).${about} Expect ambushes in their home regions; Security cuts the losses.`;
  }
  return '';
}

/**
 * 'Back to galaxy' and 'Explore this region' are clicked by text in the browser smoke script: keep them.
 *
 * The planet panel: title and Back button, the planet's facts, the native-contact banner, a card
 * for the selected region (terrain, hazard, find, native home, Explore button) and a list of all
 * regions as buttons, which is also the keyboard way to pick a region.
 */
export function createPlanetPanel(root: HTMLElement, opts: PlanetPanelOptions): PlanetPanel {
  const panel = el('section', 'hud-panel pv-panel', root);
  panel.setAttribute('aria-label', 'Planet');
  const head = el('div', 'mc-head', panel);
  const title = el('h2', 'hud-title', head, 'Planet');
  const back = el('button', 'hud-btn', head, 'Back to galaxy');
  back.type = 'button';
  back.addEventListener('click', () => opts.onBack());
  const endedEl = el('div', 'mc-warn', panel);
  endedEl.setAttribute('role', 'status');
  endedEl.hidden = true;
  const shipsEl = el('div', 'mc-dim', panel);
  const shipPick = el('div', 'mc-row', panel);
  shipPick.setAttribute('role', 'group');
  shipPick.setAttribute('aria-label', 'Ships in orbit');
  const shipBtns: HTMLButtonElement[] = [];
  let wasEnded = false;
  const surveyEl = el('div', 'mc-dim', panel);
  const habEl = el('div', 'mc-dim', panel);
  const colonyEl = el('div', 'pv-colony', panel);
  colonyEl.setAttribute('role', 'status');
  const nativeEl = el('div', 'pv-banner', panel);
  nativeEl.setAttribute('role', 'status');
  nativeEl.setAttribute('aria-live', 'polite');
  const natEmpty = el('div', 'mc-dim', panel);

  const card = el('div', 'mc-card pv-region', panel);
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Selected region');
  const cardTitle = el('div', 'mc-card-title', card);
  const cardLines = el('ul', 'pv-lines', card);
  const lineEls: HTMLElement[] = [];
  for (let i = 0; i < 6; i++) lineEls.push(el('li', '', cardLines));
  const exploreBtn = el('button', 'hud-btn pv-explore', card, 'Explore this region');
  exploreBtn.type = 'button';
  exploreBtn.addEventListener('click', () => opts.onExplore());
  const exploreWhy = el('div', 'mc-dim', card);

  const listHead = el('div', 'hud-title', panel, 'Regions');
  listHead.setAttribute('role', 'presentation');
  const list = el('div', 'pv-list', panel);
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Regions of this planet');
  const items: HTMLButtonElement[] = [];
  for (let i = 0; i < MAX_LIST; i++) {
    const b = el('button', 'pv-item', list);
    b.type = 'button';
    b.addEventListener('click', () => opts.onSelectRegion(i));
    items.push(b);
  }

  const tip = el('div', 'pv-tooltip', root);
  tip.hidden = true;
  tip.setAttribute('role', 'tooltip');

  function writeCard(info: RegionInfo, canExplore: boolean): void {
    setText(cardTitle, info.region < 0 ? info.name : `${info.name}: ${info.terrain}`);
    for (let i = 0; i < lineEls.length; i++) {
      const t = i < info.lines.length ? info.lines[i] : '';
      setText(lineEls[i], t);
      setHidden(lineEls[i], t === '');
    }
    const can = canExplore && info.frontier;
    setDisabled(exploreBtn, !can);
    setHidden(exploreBtn, info.region < 0);
    setText(
      exploreWhy,
      info.region < 0
        ? ''
        : info.explored
          ? 'Explored already.'
          : info.frontier
            ? canExplore
              ? ''
              : 'No expedition is ready to explore.'
            : 'Not next to explored land: it cannot be explored yet.',
    );
  }

  return {
    update(snap, session, ctx, canExplore) {
      const p = session.planet;
      setText(title, `Planet: ${planetLabel(snap, p)}`);
      setText(
        surveyEl,
        `Survey: ${surveyLabel(snap.planetSurvey[p])}. ${snap.planetRegionCount[p]} regions.`,
      );
      setText(
        habEl,
        `Habitability ${snap.planetHabLo[p]} to ${snap.planetHabHi[p]}% (known range)`,
      );
      if (snap.planetOwned[p] !== 0 && ctx.colonyRow >= 0) {
        setText(
          colonyEl,
          `COLONY: ${colonyTierText(snap, ctx.colonyRow)}. Population ${snap.colonies[ctx.colonyRow * COLONY_STRIDE + C_POPULATION]}.`,
        );
        const tier = snap.colonyDetail[ctx.colonyRow * COLONY_DETAIL_STRIDE + CD_TIER];
        setClass(colonyEl, `pv-colony tier-${FOUND_TIER_NAMES[tier] ?? 'x'}`);
        setHidden(colonyEl, false);
      } else {
        setHidden(colonyEl, true);
      }
      const disp = snap.planetNative[p];
      const banner = nativesBanner(disp, snap.planetNativeStrength[p], snap.planetNativeVariant[p]);
      setText(nativeEl, banner);
      setClass(nativeEl, `pv-banner disp-${disp}`);
      setHidden(nativeEl, banner === '');
      setText(natEmpty, banner === '' ? 'Natives: none met yet. Their presence is unknown.' : '');
      setHidden(natEmpty, banner !== '');

      setText(
        endedEl,
        session.ended
          ? 'The expedition was lost: nobody survived. Nothing is left to do on this planet. Press Back to return to the galaxy.'
          : '',
      );
      setHidden(endedEl, !session.ended);
      if (session.ended && !wasEnded) back.focus();
      wasEnded = session.ended;

      const nShips = parkedShipCountAt(snap, p);
      setText(shipsEl, nShips > 1 ? `${nShips} ships in orbit. Choose the one to command:` : '');
      setHidden(shipsEl, nShips <= 1);
      setHidden(shipPick, nShips <= 1);
      for (let k = 0; k < Math.max(nShips, shipBtns.length); k++) {
        if (k >= shipBtns.length) {
          const b = el('button', 'hud-btn', shipPick);
          b.type = 'button';
          b.addEventListener('click', () => {
            const e = Number(b.dataset.entity);
            if (Number.isFinite(e)) opts.onPickShip(e);
          });
          shipBtns.push(b);
        }
        const b = shipBtns[k];
        const row = nShips > 1 && k < nShips ? nthParkedShipRowAt(snap, p, k) : -1;
        setHidden(b, row < 0);
        if (row < 0) continue;
        const entity = snap.shipEntity[row];
        const current = entity === ctx.shipEntity;
        b.dataset.entity = String(entity);
        setText(b, `Ship ${k + 1}${current ? ' (selected)' : ''}`);
        b.setAttribute('aria-pressed', current ? 'true' : 'false');
      }

      writeCard(regionInfo(snap, p, session.region), canExplore);
      const n = snap.planetRegionCount[p];
      for (let i = 0; i < items.length; i++) {
        const b = items[i];
        setHidden(b, i >= n);
        if (i >= n) continue;
        const info = regionInfo(snap, p, i);
        setText(b, info.summary);
        setClass(
          b,
          `pv-item pv-${info.state}${i === session.region ? ' selected' : ''}${info.nativeHome ? ' pv-native' : ''}`,
        );
        b.setAttribute('aria-pressed', i === session.region ? 'true' : 'false');
        b.setAttribute('aria-label', `${info.summary}${i === session.region ? ', selected' : ''}`);
      }
    },
    showTooltip(snap, planet, region, sx, sy) {
      if (region < 0) {
        tip.hidden = true;
        return;
      }
      setText(tip, regionInfo(snap, planet, region).summary);
      tip.style.left = `${sx + 14}px`;
      tip.style.top = `${sy + 14}px`;
      tip.hidden = false;
    },
    focusBack() {
      back.focus();
    },
    focusExplore() {
      if (!exploreBtn.hidden && !exploreBtn.disabled) exploreBtn.focus();
      else back.focus();
    },
    dispose() {
      tip.remove();
      panel.remove();
    },
  };
}
