/**
 * Guard for the event card's number keys (pure, injectable clock). A held key (auto-repeat), a
 * double tap, or a key still travelling from before a new card appeared must not answer a card
 * the player has not read yet.
 */

/** Keys are ignored for this long after a card is shown. */
export const CARD_KEY_COOLDOWN_MS = 300;

export interface KeyGuard {
  /** A card (new or the next queued one) just appeared. */
  cardShown(): void;
  /** The card closed. */
  cardClosed(): void;
  /**
   * Should this key press act? Only while a card is visible, not on auto-repeat, not within the
   * cooldown after a card appeared, not when typing in a form field, and once per press: after an
   * accepted press the guard closes until the next `cardShown`.
   */
  accept(e: { repeat: boolean; targetTag: string }): boolean;
}

const FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function createKeyGuard(
  now: () => number,
  cooldownMs: number = CARD_KEY_COOLDOWN_MS,
): KeyGuard {
  let visible = false;
  let shownAt = 0;
  return {
    cardShown() {
      visible = true;
      shownAt = now();
    },
    cardClosed() {
      visible = false;
    },
    accept(e) {
      if (!visible || e.repeat || FORM_TAGS.has(e.targetTag.toUpperCase())) return false;
      if (now() - shownAt < cooldownMs) return false;
      // One answer per card: further presses wait for the next card.
      visible = false;
      return true;
    },
  };
}
