import type { Snapshot } from '../shared/snapshot';
import { el, setClass, setHidden, setText } from './dom';
import { createFactorTable, type FactorTable } from './factorTable';
import { buildLastRolls, type LastRollView } from './rollModel';

export interface RollPanel {
  update(snap: Snapshot, expRow: number): void;
  dispose(): void;
}

interface RollDom {
  box: HTMLElement;
  title: HTMLElement;
  table: FactorTable;
  product: HTMLElement;
  clamp: HTMLElement;
  roll: HTMLElement;
  result: HTMLElement;
  hazard: HTMLElement;
  ambush: HTMLElement;
}

/**
 * "Last roll" panel: every recorded roll of the expedition with all its factors, the effect of
 * each on the percentage, the clamp flag, the roll against the needed value and the result. The
 * result line is announced to screen readers (aria-live polite).
 */
export function createRollPanel(root: HTMLElement): RollPanel {
  const panel = el('section', 'hud-panel pv-panel', root);
  panel.setAttribute('aria-label', 'Last roll');
  panel.hidden = true;
  el('h2', 'hud-title', panel, 'Last roll');
  const live = el('div', 'pv-sr', panel);
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('role', 'status');
  const doms: RollDom[] = [];
  let lastSpoken = '';
  let lastKey = '';

  function ensure(n: number): void {
    while (doms.length < n) {
      const box = el('div', 'pv-preview', panel);
      const title = el('div', 'pv-subtitle', box);
      const table = createFactorTable(box, 'Factors of the roll', 'Chance so far');
      const product = el('div', 'mc-dim', box);
      const clamp = el('div', 'mc-warn', box);
      const roll = el('div', '', box);
      const result = el('div', 'pv-result', box);
      const hazard = el('div', 'mc-dim', box);
      const ambush = el('div', 'mc-dim', box);
      doms.push({ box, title, table, product, clamp, roll, result, hazard, ambush });
    }
  }

  function write(d: RollDom, v: LastRollView): void {
    setText(d.title, v.title);
    d.table.update(v.rows);
    setText(d.product, v.productText);
    setText(d.clamp, v.clampText);
    setHidden(d.clamp, v.clampText === '');
    setText(d.roll, v.rollLine);
    setText(d.result, v.resultText);
    setClass(d.result, `pv-result ${v.good ? 'pv-good' : 'pv-bad'}`);
    setText(d.hazard, v.hazardText);
    setHidden(d.hazard, v.hazardText === '');
    setText(d.ambush, v.ambushText);
    setHidden(d.ambush, v.ambushText === '');
  }

  return {
    update(snap, expRow) {
      const views = expRow >= 0 ? buildLastRolls(snap, expRow) : [];
      setHidden(panel, views.length === 0);
      ensure(views.length);
      let key = '';
      for (let i = 0; i < doms.length; i++) {
        const d = doms[i];
        const v = i < views.length ? views[i] : null;
        setHidden(d.box, v === null);
        if (v !== null) {
          write(d, v);
          key += `${v.title}|${v.rollLine}|${v.resultText};`;
        }
      }
      if (key !== lastKey) {
        lastKey = key;
        const spoken = views.map((v) => v.spoken).join(' ');
        if (spoken !== lastSpoken) {
          lastSpoken = spoken;
          setText(live, spoken);
        }
      }
    },
    dispose() {
      panel.remove();
    },
  };
}
