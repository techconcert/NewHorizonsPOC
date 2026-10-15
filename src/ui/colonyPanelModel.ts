import type { Command } from '../shared/commands';
import {
  colonyModPct,
  daysToExtinction,
  District,
  DISTRICT_COST,
  DISTRICT_DAYS,
  DISTRICT_MAKES,
  DISTRICT_NAMES,
  districtOutput,
  eatPerDay,
  NATIVE_NAMES,
  pushCost,
  pushMinPopulation,
  Stance,
  STANCE_NAMES,
  STANCE_TEXT,
  workPct,
} from '../shared/colony';
import { FOG_EXPLORED } from '../shared/fog';
import { NATIVE_VARIANT_NAMES } from '../shared/planetfall';
import {
  C_ENTITY,
  C_FUEL,
  C_POPULATION,
  C_PRODUCTION,
  C_SPACEPORT,
  C_SUPPLIES,
  CD_PENALTY_DAYS,
  CD_PLANET,
  COLONY_DETAIL_STRIDE,
  COLONY_STRIDE,
  EC_BUILDING,
  EC_CLAIMED,
  EC_DEFEND_UNPAID,
  EC_EAT,
  EC_FUEL,
  EC_HOUSING,
  EC_HUNGER,
  EC_NATIVE,
  EC_NATIVE_HOMES,
  EC_PRODUCTION,
  EC_RAID_DAY,
  EC_RAID_LOSS,
  EC_RESEARCH,
  EC_STANCE,
  EC_UPKEEP,
  EC_SUPPLIES,
  EC_WORKING,
  ECON_STRIDE,
  META_COLONY_COUNT,
  META_TECH_MASK,
  SNAPSHOT_REGIONS_PER_COLONY,
  type Snapshot,
} from '../shared/snapshot';
import { terrainName } from '../shared/terrain';
import { colonyTierText } from './colonyModel';

/**
 * Pure view model of the colony panel (M5): one founded colony at a time, its stocks and daily
 * flow, the stance toward the natives, a list of sites (explored regions) and the districts that
 * can be started on the selected site, each with cost, build time, yield and a reason when off.
 * Button texts ('Build Farm', 'Coexist', 'Site 3: ...') are clicked by text in the browser smoke
 * script: keep them stable.
 */

export interface StanceButton {
  stance: number;
  label: string;
  active: boolean;
  command: Command;
}

export interface SiteRow {
  local: number;
  label: string;
  kind: number;
  /** True when a district can still be started here (empty, not native ground). */
  free: boolean;
}

export interface BuildOption {
  district: number;
  label: string;
  detail: string;
  /** Why the button is off; '' when it can be pressed. */
  reason: string;
  command: Command | null;
}

export interface ColonyView {
  row: number;
  entity: number;
  title: string;
  tier: string;
  stocks: string;
  flow: string;
  population: string;
  natives: string;
  raid: string;
  /** Warning when the colony has more people than housing; '' otherwise. */
  overHousing: string;
  /** "starving: N days to extinction" when the colony cannot feed its people; '' otherwise. */
  starving: string;
  /** Why Push out does nothing right now (colony too small); '' when it works or is not chosen. */
  pushNote: string;
  stance: number;
  stanceText: string;
  stances: StanceButton[];
  districts: string;
  sites: SiteRow[];
  options: BuildOption[];
  hasSpaceport: boolean;
}

/** Colony rows that can be managed (every row but the homeworld at row 0). */
export function manageableRows(snap: Snapshot): number[] {
  const out: number[] = [];
  const n = snap.meta[META_COLONY_COUNT];
  for (let i = 1; i < n; i++) out.push(i);
  return out;
}

const MAKES_UNIT: readonly string[] = [
  '',
  'Supplies',
  'Production',
  'Fuel',
  'Supplies',
  'Research',
  '',
];

export function colonyTitle(row: number): string {
  return `Colony ${row}`;
}

function optionFor(
  snap: Snapshot,
  row: number,
  entity: number,
  kind: number,
  site: SiteRow | undefined,
  hasPort: boolean,
): BuildOption {
  const cost = DISTRICT_COST[kind];
  const days = DISTRICT_DAYS[kind];
  const name = DISTRICT_NAMES[kind];
  const production = snap.colonies[row * COLONY_STRIDE + C_PRODUCTION];
  let detail = `${name}: ${cost} Production, ${days} days to build. ${DISTRICT_MAKES[kind]}.`;
  let reason = '';
  if (site === undefined) {
    reason = 'Pick a site first.';
  } else {
    const g =
      snap.planetRegionStart[snap.colonyDetail[row * COLONY_DETAIL_STRIDE + CD_PLANET]] +
      site.local;
    if (kind !== District.Spaceport) {
      const out = districtOutput(
        kind,
        snap.regionTerrain[g],
        workPct(snap.colonies[row * COLONY_STRIDE + C_POPULATION], 1),
        snap.meta[META_TECH_MASK],
        colonyModPct(0, false),
      );
      detail += ` About ${out} ${MAKES_UNIT[kind]} a day here with a full crew.`;
    }
    if (!site.free) reason = 'That site is not free.';
  }
  if (reason === '' && kind === District.Spaceport && hasPort)
    reason = 'This colony has a Spaceport.';
  if (reason === '' && production < cost)
    reason = `Needs ${cost} Production; the colony has ${production}.`;
  let command: Command | null = null;
  if (reason === '' && site !== undefined) {
    command =
      kind === District.Spaceport
        ? { type: 'BuildSpaceport', colony: entity, region: site.local }
        : { type: 'BuildDistrict', colony: entity, region: site.local, district: kind };
  }
  return { district: kind, label: `Build ${name}`, detail, reason, command };
}

/** "(-3 Defend upkeep)" or "(Defend unpaid)" for the flow line; '' when no upkeep is involved. */
function upkeepText(paid: number, unpaid: boolean): string {
  if (unpaid) return ' (Defend upkeep unpaid)';
  return paid > 0 ? ` (-${paid} Defend upkeep)` : '';
}

export function buildColonyView(
  snap: Snapshot,
  row: number,
  selectedSite: number,
): ColonyView | null {
  if (row < 1 || row >= snap.meta[META_COLONY_COUNT]) return null;
  const co = row * COLONY_STRIDE;
  const eo = row * ECON_STRIDE;
  const ec = snap.colonyEcon;
  const entity = snap.colonies[co + C_ENTITY];
  const planet = snap.colonyDetail[row * COLONY_DETAIL_STRIDE + CD_PLANET];
  const start = snap.planetRegionStart[planet];
  const count = Math.min(snap.planetRegionCount[planet], SNAPSHOT_REGIONS_PER_COLONY);
  const dBase = row * SNAPSHOT_REGIONS_PER_COLONY;

  let hasPort = snap.colonies[co + C_SPACEPORT] !== 0;
  const sites: SiteRow[] = [];
  for (let i = 0; i < count; i++) {
    const kind = snap.colonyDistrictKind[dBase + i];
    if (kind === District.Spaceport) hasPort = true;
    if (snap.regionFog[start + i] !== FOG_EXPLORED) continue;
    const native = snap.regionNative[start + i] === 1;
    const left = snap.colonyDistrictLeft[dBase + i];
    let state: string;
    if (kind !== District.None)
      state = left > 0 ? `${DISTRICT_NAMES[kind]}, ${left} days left` : DISTRICT_NAMES[kind];
    else state = native ? 'native land' : 'empty';
    sites.push({
      local: i,
      label: `Site ${i + 1}: ${terrainName(snap.regionTerrain[start + i])}, ${state}`,
      kind,
      free: kind === District.None && !native,
    });
  }
  const site = sites.find((s) => s.local === selectedSite);

  const stance = ec[eo + EC_STANCE];
  const unpaid = ec[eo + EC_DEFEND_UNPAID] === 1;
  const stances: StanceButton[] = STANCE_NAMES.map((name, s) => ({
    stance: s,
    // Defend that could not be paid today acts as Coexist: say so on the button (D-109).
    label: s === Stance.Defend && s === stance && unpaid ? `${name} (unpaid)` : name,
    active: s === stance,
    command: { type: 'SetColonyStance', colony: entity, stance: s },
  }));

  const disp = ec[eo + EC_NATIVE];
  const variant = disp === 0 ? 0 : snap.planetNativeVariant[planet];
  const kind = variant > 0 ? ` (${NATIVE_VARIANT_NAMES[variant]})` : '';
  const natives =
    disp === 0
      ? 'Natives: none met on this planet.'
      : `Natives: ${NATIVE_NAMES[disp] ?? '?'}${kind}. ${ec[eo + EC_NATIVE_HOMES]} native home sites left, ${ec[eo + EC_CLAIMED]} claimed by the colony.`;
  const raidDay = ec[eo + EC_RAID_DAY];
  const raid =
    raidDay >= 0 ? `Last raid: day ${raidDay}, ${ec[eo + EC_RAID_LOSS]} colonists lost.` : '';

  const pop = snap.colonies[co + C_POPULATION];
  const mask = snap.meta[META_TECH_MASK];
  const have = snap.colonies[co + C_SUPPLIES] + ec[eo + EC_SUPPLIES];
  const hunger = ec[eo + EC_HUNGER];
  let starving = '';
  if (hunger > 0 || have < eatPerDay(pop, mask)) {
    const d = daysToExtinction(pop, have, mask, hunger);
    starving =
      d >= 0
        ? `starving: ${d} days to extinction`
        : 'starving: the colony shrinks until it can feed itself';
  }
  const pushNote =
    stance === Stance.PushOut && disp !== 0 && ec[eo + EC_NATIVE_HOMES] > 0 && pushCost(pop) === 0
      ? `Push out does nothing: the colony is too small (it needs ${pushMinPopulation()} people).`
      : '';

  const options: BuildOption[] = [];
  for (let k = District.Farm; k <= District.Research; k++)
    options.push(optionFor(snap, row, entity, k, site, hasPort));
  options.push(optionFor(snap, row, entity, District.Spaceport, site, hasPort));

  return {
    row,
    entity,
    title: colonyTitle(row),
    tier: colonyTierText(snap, row),
    stocks: `Stock: ${snap.colonies[co + C_SUPPLIES]} Supplies, ${snap.colonies[co + C_FUEL]} Fuel, ${snap.colonies[co + C_PRODUCTION]} Production.`,
    flow: `Last day: +${ec[eo + EC_SUPPLIES]} Supplies, +${ec[eo + EC_FUEL]} Fuel, +${ec[eo + EC_PRODUCTION]} Production${upkeepText(ec[eo + EC_UPKEEP], unpaid)}, +${ec[eo + EC_RESEARCH]} Research; the people ate ${ec[eo + EC_EAT]}.`,
    population: `Population ${snap.colonies[co + C_POPULATION]} of ${ec[eo + EC_HOUSING]} housing. Penalty days: ${snap.colonyDetail[row * COLONY_DETAIL_STRIDE + CD_PENALTY_DAYS]}.`,
    overHousing:
      ec[eo + EC_HOUSING] > 0 && pop > ec[eo + EC_HOUSING]
        ? `Overcrowded: ${pop} people but housing for ${ec[eo + EC_HOUSING]}. The colony cannot grow; build Habitats.`
        : '',
    natives,
    raid,
    starving,
    pushNote: pushNote,
    stance,
    stanceText: STANCE_TEXT[stance] ?? '',
    stances,
    districts: `Districts: ${ec[eo + EC_WORKING]} working, ${ec[eo + EC_BUILDING]} being built.`,
    sites,
    options,
    hasSpaceport: hasPort,
  };
}
