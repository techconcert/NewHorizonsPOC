import type { Snapshot } from '../shared/snapshot';
import { el, setClass, setHidden, setText } from './dom';
import { buildEndView } from './endScreenModel';

export interface EndScreenOptions {
  /** "Play again": start a new game with a fresh seed. */
  onRestart(): void;
}

export interface EndScreen {
  update(snap: Snapshot): void;
  isOpen(): boolean;
  dispose(): void;
}

/**
 * End screen (M5): shown once the run has ended. Title, why, the score and the days it took, and a
 * "Play again" button. The simulation is already stopped and refuses commands, so nothing here
 * sends one; the panel only reads the snapshot.
 */
export function createEndScreen(root: HTMLElement, opts: EndScreenOptions): EndScreen {
  const dim = el('div', 'ec-dim', root);
  dim.setAttribute('aria-hidden', 'true');
  const card = el('section', 'ec-card end-card', root);
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Game over');
  const title = el('h2', 'ec-title', card);
  const reason = el('div', 'ec-body', card);
  const score = el('div', 'end-score', card);
  const again = el('button', 'hud-btn mc-launch', card, 'Play again');
  again.type = 'button';
  again.addEventListener('click', () => opts.onRestart());
  let open = false;
  setHidden(dim, true);
  setHidden(card, true);

  return {
    update(snap) {
      const v = buildEndView(snap);
      if (v.over !== open) {
        open = v.over;
        setHidden(dim, !open);
        setHidden(card, !open);
        if (open) again.focus();
      }
      if (!v.over) return;
      setText(title, v.title);
      setText(reason, v.reason);
      setText(score, v.scoreText);
      setClass(card, v.won ? 'ec-card end-card end-won' : 'ec-card end-card end-lost');
    },
    isOpen: () => open,
    dispose() {
      dim.remove();
      card.remove();
    },
  };
}
