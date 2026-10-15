import type { Snapshot } from '../shared/snapshot';
import { el, setHidden, setText } from './dom';
import { buildPlanetRows, type PlanetRowView } from './systemPlanetsModel';

export interface SystemPlanetsPanel {
  /** `system` is the selected star, or -1. Rebuilds the rows only when they changed. */
  update(snap: Snapshot, system: number): void;
  setVisible(visible: boolean): void;
  /** Mark the row of the planet picked on the system map (slot in the system, -1 for none). */
  setSelected(slot: number): void;
  dispose(): void;
}

/** The 'Open planet' button text is clicked by text in the browser smoke script: keep it stable. */
/** Planets of the selected star, each with its status and an Open planet button when the planet view can open. */
export function createSystemPlanetsPanel(
  root: HTMLElement,
  opts: { onLand(planet: number): void },
): SystemPlanetsPanel {
  const panel = el('section', 'hud-panel pv-panel', root);
  panel.setAttribute('aria-label', 'Planets of this system');
  panel.hidden = true;
  el('h2', 'hud-title', panel, 'Planets');
  const list = el('ul', 'pv-planets', panel);
  let key = '';
  let visible = true;
  let hasRows = false;
  let selectedSlot = -1;

  interface RowDom {
    li: HTMLElement;
    label: HTMLElement;
    status: HTMLElement;
    btn: HTMLButtonElement;
    planet: number;
    slot: number;
  }
  const pool: RowDom[] = [];

  /** Update the rows in place so a focused Land button is never destroyed by a refresh. */
  function rebuild(rows: PlanetRowView[]): void {
    for (let i = 0; i < Math.max(rows.length, pool.length); i++) {
      if (i >= pool.length) {
        const li = el('li', 'pv-planet', list);
        const label = el('div', 'pv-planet-label', li);
        const status = el('div', 'mc-dim', li);
        const btn = el('button', 'hud-btn hud-btn--primary', li, 'Open planet');
        btn.type = 'button';
        const row: RowDom = { li, label, status, btn, planet: -1, slot: -1 };
        btn.addEventListener('click', () => opts.onLand(row.planet));
        pool.push(row);
      }
      const d = pool[i];
      if (i >= rows.length) {
        setHidden(d.li, true);
        continue;
      }
      const r = rows[i];
      setHidden(d.li, false);
      setText(d.label, r.label);
      setText(d.status, r.status);
      setHidden(d.status, r.status === '');
      d.planet = r.planet;
      d.slot = r.slot;
      setHidden(d.btn, !r.canLand);
      d.btn.setAttribute('aria-label', `Open planet ${r.slot + 1}`);
    }
    markSelected();
  }

  function markSelected(): void {
    for (const d of pool) d.li.classList.toggle('pv-planet--sel', d.slot === selectedSlot);
  }

  return {
    update(snap, system) {
      const rows = buildPlanetRows(snap, system);
      const k = `${system}|${rows.map((r) => `${r.label}|${r.status}|${r.canLand}`).join(';')}`;
      if (k !== key) {
        key = k;
        rebuild(rows);
      }
      hasRows = rows.length > 0;
      setHidden(panel, !visible || !hasRows);
    },
    setVisible(v) {
      visible = v;
      setHidden(panel, !visible || !hasRows);
    },
    setSelected(slot) {
      if (slot === selectedSlot) return;
      selectedSlot = slot;
      markSelected();
    },
    dispose() {
      panel.remove();
    },
  };
}
