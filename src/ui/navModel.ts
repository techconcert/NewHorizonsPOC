/**
 * Keyboard navigation and announcement logic (M8, D-143). Pure: index arithmetic for arrow keys in
 * a list, for a Tab focus trap, and a small announcer that batches the sentences of one snapshot
 * into a single screen reader message. The DOM glue is in a11y.ts.
 */

export type ListOrientation = 'vertical' | 'horizontal' | 'both';

/**
 * The index to focus after `key` in a list of `count` items with `index` focused (-1 when focus is
 * not on an item). Arrow keys wrap; Home and End jump. Returns -1 when the key does nothing.
 */
export function arrowTarget(
  key: string,
  index: number,
  count: number,
  orientation: ListOrientation = 'vertical',
): number {
  if (count <= 0) return -1;
  const vertical = orientation !== 'horizontal';
  const horizontal = orientation !== 'vertical';
  const forward = (vertical && key === 'ArrowDown') || (horizontal && key === 'ArrowRight');
  const back = (vertical && key === 'ArrowUp') || (horizontal && key === 'ArrowLeft');
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (forward) return index < 0 ? 0 : (index + 1) % count;
  if (back) return index < 0 ? count - 1 : (index - 1 + count) % count;
  return -1;
}

/**
 * Tab inside a dialog: the index to focus so focus never leaves the `count` focusable items.
 * Returns -1 when the browser's own move is fine (focus is inside and not at an edge).
 */
export function trapTarget(index: number, count: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (index < 0) return shift ? count - 1 : 0; // focus is outside the dialog: pull it in
  if (shift && index === 0) return count - 1;
  if (!shift && index === count - 1) return 0;
  return -1;
}

export interface Announcer {
  /** Queue a sentence for the next flush. */
  say(text: string): void;
  /** Join everything queued into one message and hand it to the output; no-op when nothing is queued. */
  flush(): void;
  /** Drop what is queued (a new world replaced the old one). */
  clear(): void;
}

/**
 * Batches sentences. A live region only speaks when its text changes, so a message equal to the
 * previous one gets a trailing non-breaking space (the text differs, the speech does not).
 */
export function createAnnouncer(output: (text: string) => void): Announcer {
  let queue: string[] = [];
  let last = '';
  return {
    say(text) {
      if (text !== '' && !queue.includes(text)) queue.push(text);
    },
    flush() {
      if (queue.length === 0) return;
      let msg = queue.join(' ');
      queue = [];
      if (msg === last) msg += ' ';
      last = msg;
      output(msg);
    },
    clear() {
      queue = [];
    },
  };
}

/** "System 12: Yellow star, 3 planets" for the keyboard star chooser. */
export function systemAnnouncement(
  index: number,
  starName: string,
  planets: number,
  home: boolean,
): string {
  const p = planets === 1 ? '1 planet' : `${planets} planets`;
  return `System ${index}${home ? ' (homeworld)' : ''}: ${starName}, ${p}.`;
}

/** Next/previous star index in a ring of `count` systems; -1 selects the first or last. */
export function nextSystem(current: number, count: number, step: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return step === 1 ? 0 : count - 1;
  return (current + step + count) % count;
}
