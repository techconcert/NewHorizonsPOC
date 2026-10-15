import type { GameSpeed } from '../shared/commands';

export interface AutoPause {
  /** The player chose a speed: send it, and cancel any pending auto-resume. */
  userSpeed(speed: GameSpeed): void;
  /** The tab was hidden: pause if the game is running. */
  hidden(): void;
  /** The tab is visible again: resume only if we paused it and nothing changed since. */
  shown(): void;
  /** A new game or a load replaced the world: forget the remembered speed and the pending resume (D-110). */
  reset(speed?: GameSpeed): void;
}

/**
 * D-022 auto-pause (pure, no DOM). Tracks the last speed this side sent, not the lagging
 * snapshot, so a user pause or speed change always wins over the automatic restore.
 */
export function createAutoPause(
  send: (speed: GameSpeed) => void,
  initial: GameSpeed = 1,
): AutoPause {
  let lastSent: GameSpeed = initial;
  let resumeTo: GameSpeed | null = null;
  const emit = (speed: GameSpeed): void => {
    lastSent = speed;
    send(speed);
  };
  return {
    userSpeed(speed) {
      resumeTo = null;
      emit(speed);
    },
    hidden() {
      if (resumeTo !== null || lastSent === 0) return;
      resumeTo = lastSent;
      emit(0);
    },
    reset(speed = initial) {
      resumeTo = null;
      lastSent = speed;
    },
    shown() {
      if (resumeTo === null) return;
      const speed = resumeTo;
      resumeTo = null;
      emit(speed);
    },
  };
}
