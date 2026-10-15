import { FIND_KINDS, HULLS, PLANET_TYPES, SPEEDS, TERRAINS } from '../data';

/**
 * Immutable indexed tables compiled from src/data JSON. Hot code reads typed arrays by index and
 * never follows object references. Fixed-point scales are noted per field.
 */
export interface Content {
  hullCount: number;
  hullNames: readonly string[];
  hullCargo: Int32Array;
  hullSpeed: Int32Array;
  hullRating: Int32Array;
  hullCost: Int32Array;

  speedCount: number;
  speedNames: readonly string[];
  /** Fuel multiplier x100 (1.5 becomes 150). */
  speedFuelX100: Int32Array;
  /** ETA multiplier x100. */
  speedEtaX100: Int32Array;

  terrainCount: number;
  terrainNames: readonly string[];
  /** 1 Low, 2 Medium, 3 High, 2 Variable. */
  terrainHazard: Uint8Array;
  terrainHazardVariable: Uint8Array;
  findKindCount: number;
  findKindNames: readonly string[];
  /** terrainCount x findKindCount, each row sums to 100. */
  terrainFinds: Uint8Array;

  planetTypeCount: number;
  planetTypeNames: readonly string[];
  /** planetTypeCount x terrainCount, each row sums to 100. */
  planetTypeTerrainWeights: Uint8Array;
}

const HAZARD_LEVEL: Record<string, number> = { Low: 1, Medium: 2, High: 3, Variable: 2 };

export function compileContent(): Content {
  const hullCount = HULLS.length;
  const hullCargo = new Int32Array(hullCount);
  const hullSpeed = new Int32Array(hullCount);
  const hullRating = new Int32Array(hullCount);
  const hullCost = new Int32Array(hullCount);
  HULLS.forEach((h, i) => {
    hullCargo[i] = h.cargoCapacity;
    hullSpeed[i] = h.baseSpeed;
    hullRating[i] = h.hullRating;
    hullCost[i] = h.productionCost;
  });

  const speedCount = SPEEDS.length;
  const speedFuelX100 = new Int32Array(speedCount);
  const speedEtaX100 = new Int32Array(speedCount);
  SPEEDS.forEach((s, i) => {
    speedFuelX100[i] = Math.round(s.fuelMult * 100);
    speedEtaX100[i] = Math.round(s.etaMult * 100);
  });

  const terrainCount = TERRAINS.length;
  const findKindCount = FIND_KINDS.length;
  const terrainHazard = new Uint8Array(terrainCount);
  const terrainHazardVariable = new Uint8Array(terrainCount);
  const terrainFinds = new Uint8Array(terrainCount * findKindCount);
  TERRAINS.forEach((t, i) => {
    terrainHazard[i] = HAZARD_LEVEL[t.hazard] ?? 0;
    terrainHazardVariable[i] = t.hazard === 'Variable' ? 1 : 0;
    for (let k = 0; k < findKindCount; k++) terrainFinds[i * findKindCount + k] = t.finds[k] ?? 0;
  });

  const planetTypeCount = PLANET_TYPES.length;
  const planetTypeTerrainWeights = new Uint8Array(planetTypeCount * terrainCount);
  PLANET_TYPES.forEach((p, i) => {
    for (let k = 0; k < terrainCount; k++) {
      planetTypeTerrainWeights[i * terrainCount + k] = p.terrainWeights[k] ?? 0;
    }
  });

  return {
    hullCount,
    hullNames: HULLS.map((h) => h.name),
    hullCargo,
    hullSpeed,
    hullRating,
    hullCost,
    speedCount,
    speedNames: SPEEDS.map((s) => s.name),
    speedFuelX100,
    speedEtaX100,
    terrainCount,
    terrainNames: TERRAINS.map((t) => t.name),
    terrainHazard,
    terrainHazardVariable,
    findKindCount,
    findKindNames: FIND_KINDS,
    terrainFinds,
    planetTypeCount,
    planetTypeNames: PLANET_TYPES.map((p) => p.name),
    planetTypeTerrainWeights,
  };
}
