import type { HashTarget, Stores } from './components';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a over the live prefix of each target's bytes (Uint8Array views created once at store
 * creation). Assumes a little-endian host (all supported browsers). No allocation.
 */
export function hashTargets(
  targets: readonly HashTarget[],
  counts: Int32Array,
  seed: number,
): number {
  let h = (FNV_OFFSET ^ seed) >>> 0;
  for (let t = 0; t < targets.length; t++) {
    const tg = targets[t];
    const n = tg.unitBytes * counts[tg.group];
    const bytes = tg.bytes;
    for (let i = 0; i < n; i++) {
      h ^= bytes[i];
      h = Math.imul(h, FNV_PRIME);
    }
  }
  return h >>> 0;
}

/** Hash of the generated galaxy (set once after generation, folded into every tick hash). */
export function hashGalaxy(s: Stores): number {
  return hashTargets(s.staticTargets, s.counts, 0x47414c58);
}

/** State hash after a tick; stored in run.stateHash. */
export function hashState(s: Stores): number {
  const h = hashTargets(s.dynamicTargets, s.counts, 0);
  s.run.stateHash[0] = h;
  return h;
}
