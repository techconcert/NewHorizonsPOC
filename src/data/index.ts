import economyJson from './economy.json';
import eventsJson from './events.json';
import hullsJson from './hulls.json';
import loadoutJson from './loadout.json';
import planetfallJson from './planetfall.json';
import planetTypesJson from './planetTypes.json';
import speedsJson from './speeds.json';
import techsJson from './techs.json';
import terrainJson from './terrain.json';
import transitJson from './transit.json';
import type {
  CargoDialDef,
  EconomyConfig,
  EventCardDef,
  HullDef,
  LoadoutConfig,
  PlanetfallConfig,
  PlanetTypeDef,
  SpeedDef,
  TechsConfig,
  TerrainDef,
  TransitConfig,
} from './types';

export * from './limits';
export * from './types';

export const HULLS: readonly HullDef[] = hullsJson.hulls;
export const LOADOUT: LoadoutConfig = loadoutJson;
export const CARGO_DIALS: readonly CargoDialDef[] = loadoutJson.cargoDials;
export const SPEEDS: readonly SpeedDef[] = speedsJson.speeds;
export const TERRAINS: readonly TerrainDef[] = terrainJson.terrains;
export const FIND_KINDS: readonly string[] = terrainJson.findKinds;
export const TRANSIT: TransitConfig = transitJson;
export const EVENTS: readonly EventCardDef[] = eventsJson.events as unknown as EventCardDef[];
export const PLANETFALL: PlanetfallConfig = planetfallJson;
export const ECONOMY: EconomyConfig = economyJson;
export const TECHS: TechsConfig = techsJson;
export const PLANET_TYPES: readonly PlanetTypeDef[] = planetTypesJson.planetTypes;

/** Raw JSON roots, for the validators. */
export const RAW_CONTENT = {
  hulls: hullsJson,
  loadout: loadoutJson,
  speeds: speedsJson,
  terrain: terrainJson,
  planetTypes: planetTypesJson,
  planetfall: planetfallJson,
  transit: transitJson,
  events: eventsJson,
  economy: economyJson,
  techs: techsJson,
} as const;

let contentHashCache = -1;

/**
 * FNV-1a hash of all the game-data JSONs (their serialized text). A save stores it so a load can
 * refuse a save made with different content, which would replay to another game (D-106).
 */
export function contentHash(): number {
  if (contentHashCache >= 0) return contentHashCache;
  const text = JSON.stringify(RAW_CONTENT);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  contentHashCache = h >>> 0;
  return contentHashCache;
}
