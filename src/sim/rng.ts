/**
 * sfc32 PRNG (Chris Doty-Humphrey's Small Fast Counter), written in project code.
 * State lives in typed-array "component" storage, one slot per entity, so a roll depends only
 * on the run seed and the slot, never on the order of unrelated systems. No Math.* randomness.
 */

export interface RngStore {
  a: Uint32Array;
  b: Uint32Array;
  c: Uint32Array;
  d: Uint32Array;
}

export function createRngStore(slots: number): RngStore {
  return {
    a: new Uint32Array(slots),
    b: new Uint32Array(slots),
    c: new Uint32Array(slots),
    d: new Uint32Array(slots),
  };
}

/** Murmur3 fmix32 finalizer: a fast, well-mixing 32-bit integer hash. */
export function mix32(x: number): number {
  let h = x | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const GOLDEN = 0x9e3779b9;

/** Seed one slot from a 32-bit seed: state words from a mixed counter, then 12 warm-up draws. */
export function seedSlot(r: RngStore, slot: number, seed: number): void {
  let x = (mix32(seed) + Math.imul(slot, GOLDEN)) >>> 0;
  x = (x + GOLDEN) >>> 0;
  r.a[slot] = mix32(x);
  x = (x + GOLDEN) >>> 0;
  r.b[slot] = mix32(x);
  x = (x + GOLDEN) >>> 0;
  r.c[slot] = mix32(x);
  r.d[slot] = 1;
  for (let i = 0; i < 12; i++) nextU32(r, slot);
}

/** Next uint32 in [0, 2^32). */
export function nextU32(r: RngStore, slot: number): number {
  const a0 = r.a[slot] | 0;
  const b0 = r.b[slot] | 0;
  const c0 = r.c[slot] | 0;
  const d0 = r.d[slot] | 0;
  const t = (((a0 + b0) | 0) + d0) | 0;
  r.d[slot] = (d0 + 1) | 0;
  r.a[slot] = b0 ^ (b0 >>> 9);
  r.b[slot] = (c0 + (c0 << 3)) | 0;
  r.c[slot] = (((c0 << 21) | (c0 >>> 11)) + t) | 0;
  return t >>> 0;
}

/** Float in [0, 1) by integer division. */
export function nextFloat(r: RngStore, slot: number): number {
  return nextU32(r, slot) / 4294967296;
}

/** Integer in [lo, hi] inclusive. */
export function nextInt(r: RngStore, slot: number, lo: number, hi: number): number {
  return lo + Math.floor((nextU32(r, slot) * (hi - lo + 1)) / 4294967296);
}
