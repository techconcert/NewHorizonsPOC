import { SNAPSHOT_MAX_SHIPS, META_SHIPS_LOST, type Snapshot } from '../shared/snapshot';
import { el, setClass, setHidden, setText } from './dom';
import { GROUND_BADGE_TEXT, GROUND_HELP_TEXT } from './openPlanetModel';
import {
  buildShipRow,
  fillRowKey,
  ROW_KEY_LENGTH,
  shipRowCount,
  type ShipRowView,
} from './shipListModel';

export interface ShipListPanel {
  /** Read the snapshot; rewrites only rows whose key changed. */
  update(snap: Snapshot): void;
  /** Highlight a ship by entity id (-1 for none). */
  setSelected(entity: number): void;
  dispose(): void;
}

export interface ShipListOptions {
  onSelect(entity: number): void;
  /** 'Open planet' on a ship blocked by an expedition on the ground. */
  onOpenPlanet(planet: number): void;
}

interface RowDom {
  /** The wrapper of the row button and its badge line. */
  item: HTMLElement;
  root: HTMLButtonElement;
  cells: HTMLElement[];
  badge: HTMLElement;
  entity: number;
  planet: number;
}

const COLUMNS = ['Ship', 'State', 'To', 'ETA', 'Margin', 'Fuel'];

/**
 * Ship list (M3b): one row per player ship with state, destination, ETA, supply margin (red under
 * 100%) and fuel. Rows are created once and reused. A snapshot compares an integer key per row and
 * rewrites text only for rows that changed; nothing is built with innerHTML.
 */
export function createShipList(root: HTMLElement, opts: ShipListOptions): ShipListPanel {
  const panel = el('aside', 'hud-panel sl-panel', root);
  panel.setAttribute('aria-label', 'Ships');
  const head = el('div', 'sl-head', panel);
  el('h2', 'hud-title', head, 'Ships');
  const summary = el('span', 'mc-dim', head);
  const empty = el('div', 'hud-body', panel, 'No ships in flight yet.');
  const table = el('div', 'sl-table', panel);
  const header = el('div', 'sl-row sl-header', table);
  for (const c of COLUMNS) el('span', 'sl-cell', header, c);
  const list = el('div', 'sl-rows', table);

  const rows: RowDom[] = [];
  const keys = new Int32Array(SNAPSHOT_MAX_SHIPS * ROW_KEY_LENGTH);
  const lastKeys = new Int32Array(SNAPSHOT_MAX_SHIPS * ROW_KEY_LENGTH);
  let shown = 0;
  let selected = -1;
  let latest: Snapshot | null = null;

  function makeRow(): RowDom {
    // The row is a button, so the badge and its Open planet button sit beside it, not inside it.
    const item = el('div', 'sl-item', list);
    const b = el('button', 'sl-row', item);
    b.type = 'button';
    const cells: HTMLElement[] = [];
    for (let i = 0; i < COLUMNS.length; i++) cells.push(el('span', 'sl-cell', b));
    const badge = el('div', 'sl-badge', item);
    badge.hidden = true;
    const text = el('span', 'sl-badge-text', badge, GROUND_BADGE_TEXT);
    text.title = GROUND_HELP_TEXT;
    const open = el('button', 'hud-btn hud-btn--primary sl-open', badge, 'Open planet');
    open.type = 'button';
    open.title = GROUND_HELP_TEXT;
    const r: RowDom = { item, root: b, cells, badge, entity: -1, planet: -1 };
    b.addEventListener('click', () => opts.onSelect(r.entity));
    open.addEventListener('click', () => {
      if (r.planet >= 0) opts.onOpenPlanet(r.planet);
    });
    return r;
  }

  function writeRow(r: RowDom, v: ShipRowView): void {
    r.entity = v.entity;
    setText(r.cells[0], v.name);
    setText(r.cells[1], v.state);
    setText(r.cells[2], v.dest);
    setText(r.cells[3], v.eta);
    setText(r.cells[4], v.margin);
    setText(r.cells[5], v.fuel);
    setClass(r.cells[1], `sl-cell sl-state-${v.kind} sl-state-${v.stateKey}`);
    setClass(r.cells[4], `sl-cell sl-margin-${v.marginClass}`);
    setClass(r.root, v.selected ? 'sl-row selected' : 'sl-row');
    r.root.setAttribute('aria-pressed', v.selected ? 'true' : 'false');
    r.planet = v.openPlanet;
    setHidden(r.badge, v.openPlanet < 0);
  }

  function render(snap: Snapshot): void {
    const n = shipRowCount(snap);
    for (let i = 0; i < n; i++) {
      while (rows.length <= i) rows.push(makeRow());
      fillRowKey(snap, i, selected, keys, i * ROW_KEY_LENGTH);
      let changed = i >= shown;
      for (let k = 0; k < ROW_KEY_LENGTH && !changed; k++) {
        changed = keys[i * ROW_KEY_LENGTH + k] !== lastKeys[i * ROW_KEY_LENGTH + k];
      }
      if (changed) {
        writeRow(rows[i], buildShipRow(snap, i, selected));
        for (let k = 0; k < ROW_KEY_LENGTH; k++) {
          lastKeys[i * ROW_KEY_LENGTH + k] = keys[i * ROW_KEY_LENGTH + k];
        }
      }
      setHidden(rows[i].item, false);
    }
    for (let i = n; i < shown; i++) setHidden(rows[i].item, true);
    shown = n;
    setHidden(empty, n > 0);
    setHidden(table, n === 0);
    const lost = snap.meta[META_SHIPS_LOST];
    setText(summary, lost > 0 ? `${n} flying, ${lost} lost` : `${n}`);
  }

  return {
    update(snap) {
      latest = snap;
      render(snap);
    },
    dispose() {
      panel.remove();
    },
    setSelected(entity) {
      if (entity === selected) return;
      selected = entity;
      // Selection is part of the key; redraw from the last snapshot.
      if (latest) render(latest);
    },
  };
}
