import { createFrameStats } from './frameStats';

export interface DebugOverlay {
  frame(nowMs: number): void;
  setWorkerTickMs(ms: number): void;
  setStateHash(hash: number): void;
}

/**
 * Shows fps, frame ms, the p50 / p95 of the last 240 frame times and worker tick ms. Updates text
 * twice a second; recording a frame writes one slot of a preallocated ring (no allocation). A gap
 * over 250 ms (a hidden tab, a long stall) is not recorded, so p95 shows rendering, not pauses.
 */
export function createDebugOverlay(): DebugOverlay {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:4px;left:4px;font:12px monospace;color:#0f0;background:#000a;padding:4px;z-index:200;pointer-events:none';
  document.body.appendChild(el);
  const stats = createFrameStats();
  let last = 0;
  let frameMs = 0;
  let frames = 0;
  let acc = 0;
  let tickMs = 0;
  let hash = 0;
  return {
    setWorkerTickMs(ms) {
      tickMs = ms;
    },
    setStateHash(h) {
      hash = h;
    },
    frame(nowMs) {
      frameMs = nowMs - last;
      last = nowMs;
      if (frameMs < 250) stats.add(frameMs);
      acc += frameMs;
      frames++;
      if (acc >= 500) {
        el.textContent = `fps ${((frames * 1000) / acc).toFixed(0)} | frame ${frameMs.toFixed(1)} ms | ${stats.summary()} | worker tick ${tickMs.toFixed(2)} ms | hash ${hash.toString(16).padStart(8, '0')}`;
        acc = 0;
        frames = 0;
      }
    },
  };
}
