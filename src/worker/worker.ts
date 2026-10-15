import type { ToWorker } from '../shared/messages';
import { createHandler } from './handler';

/** How often the worker advances the sim; snapshots are rate-limited separately. */
const PUMP_INTERVAL_MS = 25;

const handler = createHandler(
  { postMessage: (msg, transfer) => self.postMessage(msg, transfer) },
  () => performance.now(),
);

self.onmessage = (e: MessageEvent<ToWorker>) => handler.onMessage(e.data);
setInterval(() => handler.pump(), PUMP_INTERVAL_MS);
