import { HULL_NAMES } from '../shared/loadout';
import { ExpeditionStatus } from '../shared/planetfall';
import {
  expeditionCodeOfShip,
  isParkedState,
  liveExpeditionRowOfShip,
} from '../shared/planetSnapshot';
import {
  EXPEDITION_STRIDE,
  META_SHIP_COUNT,
  X_ROUND_DAY,
  X_ROUND_LEN,
  X_STATUS,
  X_TARGET,
  type Snapshot,
} from '../shared/snapshot';
import {
  SHIP_KIND_LABEL,
  SHIP_STATE,
  SUPPLY_MARGIN_CAP_PCT,
  shipKindOf,
  type ShipKind,
} from '../shared/transit';
import { marginClass, marginCue } from './missionModel';
import { groundBlockedPlanet } from './openPlanetModel';

/**
 * Pure view model of the ship list panel. A cheap integer key per ship tells the panel which rows
 * changed, so strings are only built for rows that need a rewrite (D-063).
 */

export type RowMarginClass = 'bad' | 'ok' | 'good' | 'none';

/** Finer state of a ship in orbit (M4b): drives the label and a CSS class next to the kind. */
export type ShipStateKey =
  | 'transit'
  | 'event'
  | 'drifting'
  | 'lost'
  | 'orbit'
  | 'arrived'
  | 'exploring'
  | 'ground'
  | 'card'
  | 'stranded';

export interface ShipRowView {
  entity: number;
  kind: ShipKind;
  stateKey: ShipStateKey;
  /** "Ark #7" */
  name: string;
  state: string;
  dest: string;
  eta: string;
  margin: string;
  marginClass: RowMarginClass;
  fuel: string;
  selected: boolean;
  /** Planet to open when a ground expedition blocks this ship from leaving, else -1 (no badge). */
  openPlanet: number;
}

/** Values that decide what a row shows. */
export const ROW_KEY_LENGTH = 10;

/** Write the row's change key into `out[off .. off + ROW_KEY_LENGTH)`. No allocation. */
export function fillRowKey(
  snap: Snapshot,
  row: number,
  selectedEntity: number,
  out: Int32Array,
  off: number,
): void {
  out[off] = snap.shipEntity[row];
  out[off + 1] = snap.shipHull[row] * 16 + snap.shipState[row];
  out[off + 2] = snap.shipDest[row];
  out[off + 3] = snap.shipEta[row];
  out[off + 4] = snap.shipMargin[row];
  out[off + 5] = snap.shipFuel[row];
  out[off + 6] = snap.shipColonists[row];
  out[off + 7] = snap.shipEntity[row] === selectedEntity ? 1 : 0;
  out[off + 8] = isParkedState(snap.shipState[row])
    ? expeditionCodeOfShip(snap, snap.shipEntity[row]) * 100 + (snap.shipState[row] % 100)
    : 0;
  const x = isParkedState(snap.shipState[row])
    ? liveExpeditionRowOfShip(snap, snap.shipEntity[row])
    : -1;
  out[off + 9] = x >= 0 ? snap.expeditions[x * EXPEDITION_STRIDE + X_ROUND_DAY] : 0;
}

const STATE_LABEL: Record<ShipStateKey, string> = {
  transit: SHIP_KIND_LABEL.transit,
  event: SHIP_KIND_LABEL.event,
  drifting: SHIP_KIND_LABEL.drifting,
  lost: SHIP_KIND_LABEL.lost,
  arrived: SHIP_KIND_LABEL.arrived,
  orbit: 'In orbit',
  exploring: 'Exploring',
  ground: 'On the ground',
  card: 'Expedition card',
  stranded: 'Stranded',
};

/**
 * The state of a ship row as the list shows it: a ship in orbit with an expedition out is
 * Exploring (a round is running), On the ground (waiting for orders), Expedition card (an event
 * card waits) or Stranded (the founding failed); without one it is Arrived, or In orbit for the
 * older orbit state id.
 */
export function shipStateKey(snap: Snapshot, row: number): ShipStateKey {
  const state = snap.shipState[row];
  if (!isParkedState(state)) return shipKindOf(state);
  const x = liveExpeditionRowOfShip(snap, snap.shipEntity[row]);
  if (x >= 0) {
    const status = snap.expeditions[x * EXPEDITION_STRIDE + X_STATUS];
    if (status === ExpeditionStatus.Stranded) return 'stranded';
    if (status === ExpeditionStatus.Event) return 'card';
    return snap.expeditions[x * EXPEDITION_STRIDE + X_TARGET] >= 0 ? 'exploring' : 'ground';
  }
  return state === SHIP_STATE.InOrbit ? 'orbit' : 'arrived';
}

/** "System 12, planet 2" for a planet index. */
export function planetLabel(snap: Snapshot, planet: number): string {
  if (planet < 0) return '-';
  const sys = snap.planetSystem[planet];
  return `System ${sys}, planet ${planet - snap.systemPlanetStart[sys] + 1}`;
}

/** "250%", "999%+" at the cap, "-" when there is nobody to feed or the ship is not flying. */
export function formatMargin(pct: number, colonists: number, flying: boolean): string {
  if (!flying || colonists <= 0) return '-';
  return pct >= SUPPLY_MARGIN_CAP_PCT ? `${SUPPLY_MARGIN_CAP_PCT}%+` : `${pct}%`;
}

/** Margin with a text cue ("49% LOW", "174% SAFE") for rows and cards; '-' when not applicable. */
export function formatMarginCue(pct: number, colonists: number, flying: boolean): string {
  const base = formatMargin(pct, colonists, flying);
  return base === '-' ? base : `${base} ${marginCue(pct)}`;
}

export function buildShipRow(snap: Snapshot, row: number, selectedEntity: number): ShipRowView {
  const state = snap.shipState[row];
  const kind = shipKindOf(state);
  const flying = state === SHIP_STATE.InTransit || state === SHIP_STATE.Event;
  const eta = snap.shipEta[row];
  const colonists = snap.shipColonists[row];
  const margin = snap.shipMargin[row];
  let etaText = '-';
  if (flying) etaText = state === SHIP_STATE.Event ? `${eta} d, paused` : `${eta} d`;
  else if (kind === 'arrived') etaText = 'arrived';
  const stateKey = shipStateKey(snap, row);
  if (stateKey === 'exploring') {
    const x = liveExpeditionRowOfShip(snap, snap.shipEntity[row]) * EXPEDITION_STRIDE;
    etaText = `day ${snap.expeditions[x + X_ROUND_DAY]} of ${snap.expeditions[x + X_ROUND_LEN]}`;
  }
  const entity = snap.shipEntity[row];
  return {
    entity,
    kind,
    stateKey,
    name: `${HULL_NAMES[snap.shipHull[row]] ?? 'Ship'} #${entity}`,
    state: STATE_LABEL[stateKey],
    dest: planetLabel(snap, snap.shipDest[row]),
    eta: etaText,
    margin: formatMarginCue(margin, colonists, flying),
    marginClass: flying && colonists > 0 ? marginClass(margin) : 'none',
    fuel: `${snap.shipFuel[row]}`,
    selected: entity === selectedEntity,
    openPlanet: groundBlockedPlanet(snap, row),
  };
}

/** Number of ship rows in a snapshot. */
export function shipRowCount(snap: Snapshot): number {
  return snap.meta[META_SHIP_COUNT];
}
