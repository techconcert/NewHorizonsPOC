/**
 * Frame-time summary for the ?debug overlay (M8, D-146). A fixed ring of the last frame times in a
 * preallocated Float32Array; p50 and p95 are computed on demand (twice a second at most) by a
 * counting pass over fixed 0.5 ms buckets, so neither recording nor reading allocates.
 */

export const FRAME_RING = 240;
const BUCKET_MS = 0.5;
const BUCKETS = 400; // 0 to 200 ms; slower frames land in the last bucket

export interface FrameStats {
  /** Record one frame time in ms (ignored when not a positive finite number). */
  add(ms: number): void;
  /** Number of frames currently in the ring. */
  count(): number;
  /** Percentile in ms (0 < p <= 100) over the ring; 0 when empty. Resolution 0.5 ms. */
  percentile(p: number): number;
  /** "p50 16.5 | p95 33.0 ms" or "p50 - | p95 -" when empty. */
  summary(): string;
  reset(): void;
}

export function createFrameStats(): FrameStats {
  const ring = new Float32Array(FRAME_RING);
  const hist = new Uint16Array(BUCKETS);
  let head = 0;
  let size = 0;
  function percentile(p: number): number {
    if (size === 0) return 0;
    hist.fill(0);
    for (let i = 0; i < size; i++) {
      let b = Math.floor(ring[i] / BUCKET_MS);
      if (b >= BUCKETS) b = BUCKETS - 1;
      hist[b]++;
    }
    const rank = Math.ceil((p / 100) * size);
    let seen = 0;
    for (let b = 0; b < BUCKETS; b++) {
      seen += hist[b];
      if (seen >= rank) return (b + 1) * BUCKET_MS;
    }
    return BUCKETS * BUCKET_MS;
  }
  return {
    add(ms) {
      if (!(ms > 0) || !Number.isFinite(ms)) return;
      ring[head] = ms;
      head = (head + 1) % FRAME_RING;
      if (size < FRAME_RING) size++;
    },
    count: () => size,
    percentile,
    summary() {
      if (size === 0) return 'p50 - | p95 -';
      return `p50 ${percentile(50).toFixed(1)} | p95 ${percentile(95).toFixed(1)} ms`;
    },
    reset() {
      head = 0;
      size = 0;
    },
  };
}
