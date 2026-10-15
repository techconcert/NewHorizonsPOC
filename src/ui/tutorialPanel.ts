import type { Snapshot } from '../shared/snapshot';
import { el, setHidden, setText } from './dom';
import {
  back,
  createTutorial,
  createTutorialFacts,
  currentStep,
  next,
  observe,
  progressText,
  readTutorialFacts,
  reopen,
  resetForNewWorld,
  skip,
  TUTORIAL_STEPS,
  type TutorialState,
} from './tutorialModel';

export interface TutorialViewState {
  /** A star is selected on the map. */
  starSelected: boolean;
  /** The open planet index, or -1. */
  planet: number;
}

export interface TutorialPanel {
  /** Read a snapshot (the main-thread mirror): advances the steps the player has done. */
  update(snap: Snapshot): void;
  /** The Help button: open the guide at the first step not done yet, or close it when open. */
  toggle(): void;
  /**
   * The "show the guide at the start" setting (M8): false marks the guide as seen and closes it;
   * true lets the next new game or load start it again (it never pops up in the middle of a game).
   */
  setAutoStart(on: boolean): void;
  /** A new game or a load: drop the progress; the guide restarts only if it was never seen. */
  reset(): void;
  isOpen(): boolean;
  dispose(): void;
}

export interface TutorialPanelOptions {
  /** The view state the machine cannot read from the snapshot. */
  getView(): TutorialViewState;
  /** The guide opened or closed (to keep the Help button's pressed state in step). */
  onOpenChange(open: boolean): void;
  /** The player pressed Skip guide or Done on the last step: the caller saves "do not show it again". */
  onDismiss?(): void;
}

/**
 * Coach-mark DOM for the guided first launch (M7c). A small card at the bottom of the free map area
 * with the step title and text (an `aria-live="polite"` region, so a screen reader hears each new
 * step without a focus change), Back, Next and Skip buttons, and a highlight ring on the part of
 * the interface the step is about. It takes no clicks outside its own card, never pauses or blocks
 * anything, and keeps its "seen" flag in memory only. The ring has no animation under
 * `prefers-reduced-motion`.
 */
export function createTutorialPanel(root: HTMLElement, opts: TutorialPanelOptions): TutorialPanel {
  const state: TutorialState = createTutorial();
  const facts = createTutorialFacts();
  let latest: Snapshot | null = null;

  const card = el('aside', 'tut-coach', root);
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', 'Guide');
  const head = el('div', 'tut-head', card);
  const progress = el('span', 'tut-progress', head);
  const closeBtn = el('button', 'hud-btn tut-skip', head, 'Skip guide');
  closeBtn.type = 'button';
  // The live region holds the title and the text, so one polite announcement carries both.
  const live = el('div', 'tut-live', card);
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  const title = el('h2', 'tut-title', live);
  const text = el('p', 'tut-text', live);
  const row = el('div', 'tut-row', card);
  const backBtn = el('button', 'hud-btn', row, 'Back');
  backBtn.type = 'button';
  const nextBtn = el('button', 'hud-btn hud-btn--primary', row, 'Next');
  nextBtn.type = 'button';

  let focusRing: HTMLElement | null = null;
  let shownStep = -1;
  let shownOpen = false;

  function clearRing(): void {
    if (focusRing) {
      focusRing.classList.remove('tut-focus');
      focusRing = null;
    }
  }

  /** Put the ring on the first anchor of the step that is actually on screen. */
  function placeRing(): void {
    const step = currentStep(state);
    let found: HTMLElement | null = null;
    if (step) {
      for (const sel of step.anchors) {
        const node = document.querySelector<HTMLElement>(sel);
        if (node && node.getClientRects().length > 0 && !card.contains(node)) {
          found = node;
          break;
        }
      }
    }
    if (found === focusRing) return;
    clearRing();
    if (found) {
      found.classList.add('tut-focus');
      focusRing = found;
    }
  }

  function render(): void {
    const step = currentStep(state);
    setHidden(card, step === null);
    if (state.open !== shownOpen) {
      shownOpen = state.open;
      opts.onOpenChange(state.open);
    }
    if (step === null) {
      clearRing();
      shownStep = -1;
      return;
    }
    if (shownStep !== state.step) {
      shownStep = state.step;
      setText(progress, progressText(state));
      setText(title, step.title);
      setText(text, step.text);
      setText(nextBtn, state.step === TUTORIAL_STEPS.length - 1 ? 'Done' : 'Next');
      backBtn.disabled = state.step === 0;
    }
    placeRing();
  }

  function refresh(): void {
    if (latest) {
      readTutorialFacts(latest, opts.getView(), facts);
      observe(state, facts);
    }
    render();
  }

  closeBtn.addEventListener('click', () => {
    skip(state);
    render();
    opts.onDismiss?.();
  });
  nextBtn.addEventListener('click', () => {
    const last = state.step === TUTORIAL_STEPS.length - 1;
    next(state);
    // The step the click lands on may already be done: let the machine catch up.
    refresh();
    if (last) opts.onDismiss?.();
  });
  backBtn.addEventListener('click', () => {
    back(state);
    render();
  });

  render();
  return {
    update(snap) {
      latest = snap;
      refresh();
    },
    toggle() {
      if (state.open) {
        skip(state);
        render();
        return;
      }
      if (latest) readTutorialFacts(latest, opts.getView(), facts);
      reopen(state, facts);
      render();
      nextBtn.focus();
    },
    setAutoStart(on) {
      if (on) {
        state.seen = false;
        return;
      }
      skip(state);
      render();
    },
    reset() {
      resetForNewWorld(state);
      shownStep = -1;
      render();
    },
    isOpen: () => state.open,
    dispose() {
      clearRing();
      card.remove();
    },
  };
}
