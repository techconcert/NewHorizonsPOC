/**
 * Short trails behind ships: a ring buffer of recent positions per ship entity in one preallocated
 * Float32Array. Main thread only, derived from snapshots, never sent to the sim. No allocation
 * after creation.
 */

/** Points kept per ship. */
export const TRAIL_POINTS = 8;
/** Entity ids covered (MAX_ENTITIES in the sim is 1024, D-031). Ids beyond this get no trail. */
export const TRAIL_ENTITY_CAP = 1024;

export interface TrailStore {
  points: number;
  cap: number;
  /** x,y per point: [entity][slot][2]. */
  xy: Float32Array;
  /** Next slot to write per entity. */
  head: Uint8Array;
  /** Points held per entity (<= points). */
  count: Uint8Array;
  /** Sync sequence number in which each entity was last seen (0 = never). */
  seen: Int32Array;
}

export function createTrailStore(cap = TRAIL_ENTITY_CAP, points = TRAIL_POINTS): TrailStore {
  return {
    points,
    cap,
    xy: new Float32Array(cap * points * 2),
    head: new Uint8Array(cap),
    count: new Uint8Array(cap),
    seen: new Int32Array(cap),
  };
}

/** Number of points stored for an entity. */
export function trailCount(t: TrailStore, entity: number): number {
  return entity >= 0 && entity < t.cap ? t.count[entity] : 0;
}

/**
 * Remember a position. A point equal to the newest one is skipped, so a ship standing still
 * (delay, arrived) does not fill its trail with copies. Returns true when stored.
 */
export function trailPush(t: TrailStore, entity: number, x: number, y: number): boolean {
  if (entity < 0 || entity >= t.cap) return false;
  const n = t.count[entity];
  const base = entity * t.points * 2;
  if (n > 0) {
    const last = (t.head[entity] + t.points - 1) % t.points;
    if (t.xy[base + last * 2] === x && t.xy[base + last * 2 + 1] === y) return false;
  }
  const h = t.head[entity];
  t.xy[base + h * 2] = x;
  t.xy[base + h * 2 + 1] = y;
  t.head[entity] = (h + 1) % t.points;
  if (n < t.points) t.count[entity] = n + 1;
  return true;
}

export function trailClear(t: TrailStore, entity: number): void {
  if (entity < 0 || entity >= t.cap) return;
  t.head[entity] = 0;
  t.count[entity] = 0;
}

/**
 * Write the trail of an entity as line segments, newest first, starting at the ship's current
 * drawn position (headX, headY): segment k joins point k-1 to point k. Writes 6 floats per segment
 * (two x,y,z vertices; z = 0) into `out` from float offset `off`. Returns the segments written.
 * `fade` receives a 0..1 brightness per vertex (2 per segment) at `fadeOff`, oldest dimmest.
 */
export function writeTrailSegments(
  t: TrailStore,
  entity: number,
  headX: number,
  headY: number,
  out: Float32Array,
  off: number,
  fade: Float32Array,
  fadeOff: number,
): number {
  const n = trailCount(t, entity);
  if (n === 0) return 0;
  const base = entity * t.points * 2;
  let px = headX;
  let py = headY;
  let w = off;
  let f = fadeOff;
  for (let k = 0; k < n; k++) {
    const slot = (t.head[entity] + t.points - 1 - k) % t.points;
    const x = t.xy[base + slot * 2];
    const y = t.xy[base + slot * 2 + 1];
    out[w] = px;
    out[w + 1] = py;
    out[w + 2] = 0;
    out[w + 3] = x;
    out[w + 4] = y;
    out[w + 5] = 0;
    w += 6;
    fade[f] = 1 - k / (n + 1);
    fade[f + 1] = 1 - (k + 1) / (n + 1);
    f += 2;
    px = x;
    py = y;
  }
  return n;
}

/**
 * Note that `entity` is in sync number `seq` (1, 2, 3 ... one per snapshot). An entity that was
 * not in the previous sync is new (first sight, or an id reused after a gap): its old trail is
 * dropped so it cannot draw a line from a dead ship's last position. Returns true when cleared.
 */
export function trailTouch(t: TrailStore, entity: number, seq: number): boolean {
  if (entity < 0 || entity >= t.cap) return false;
  const gap = t.seen[entity] !== seq - 1 && t.seen[entity] !== seq;
  t.seen[entity] = seq;
  if (gap && t.count[entity] > 0) {
    trailClear(t, entity);
    return true;
  }
  return false;
}

/**
 * Per ship and snapshot: the trail remembers where each game day's step started. Pushes
 * (x, y) on the first snapshot of a new day, and whenever the trail is empty. Returns true
 * when a point was stored.
 */
export function trailSyncShip(
  t: TrailStore,
  entity: number,
  seq: number,
  newDay: boolean,
  x: number,
  y: number,
): boolean {
  trailTouch(t, entity, seq);
  if (newDay || trailCount(t, entity) === 0) return trailPush(t, entity, x, y);
  return false;
}
