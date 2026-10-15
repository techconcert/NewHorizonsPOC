import { el } from './dom';
import { arrowTarget, trapTarget, type ListOrientation } from './navModel';

/**
 * Accessibility DOM glue (M8, D-143): arrow keys inside lists, a Tab trap for dialogs, the
 * aria-live regions and the skip link. The decisions are made by the pure functions in navModel.ts.
 */

const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/** Can this element take focus now: enabled, not hidden by [hidden] or display:none? */
export function isFocusable(node: HTMLElement): boolean {
  if ((node as HTMLButtonElement).disabled) return false;
  if (node.closest('[hidden]') !== null) return false;
  return node.getClientRects().length > 0;
}

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isFocusable);
}

/**
 * Arrow keys, Home and End move focus between the items that match `selector` inside `container`
 * (or inside the nearest `groupSelector` ancestor of the focused item). Returns the unbind function.
 */
export function bindArrowNav(
  container: HTMLElement,
  selector: string,
  orientation: ListOrientation = 'vertical',
  groupSelector = '',
): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    // With a group selector, only the items of the group the focused item belongs to take part.
    const scope = groupSelector === '' ? container : target.closest<HTMLElement>(groupSelector);
    if (!scope) return;
    const items = Array.from(scope.querySelectorAll<HTMLElement>(selector)).filter(isFocusable);
    const index = items.indexOf(target);
    if (index < 0) return;
    const to = arrowTarget(e.key, index, items.length, orientation);
    if (to < 0) return;
    e.preventDefault();
    items[to].focus();
  };
  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}

/** Keep Tab inside `dialog` while it is open. Returns the release function. */
export function trapFocus(dialog: HTMLElement): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const items = focusableIn(dialog);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const to = trapTarget(
      items.indexOf(document.activeElement as HTMLElement),
      items.length,
      e.shiftKey,
    );
    if (to >= 0) {
      e.preventDefault();
      items[to].focus();
    }
  };
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}

export interface LiveRegions {
  /** Polite announcement (status). */
  polite(text: string): void;
  /** Assertive announcement (alert), for the end of the game. */
  assertive(text: string): void;
  dispose(): void;
}

/** Two visually hidden live regions at the end of `root`. */
export function createLiveRegions(root: HTMLElement): LiveRegions {
  const p = el('div', 'sr-only', root);
  p.setAttribute('role', 'status');
  p.setAttribute('aria-live', 'polite');
  p.setAttribute('aria-atomic', 'true');
  p.id = 'live-polite';
  const a = el('div', 'sr-only', root);
  a.setAttribute('role', 'alert');
  a.setAttribute('aria-live', 'assertive');
  a.setAttribute('aria-atomic', 'true');
  a.id = 'live-assertive';
  return {
    polite: (t) => {
      p.textContent = t;
    },
    assertive: (t) => {
      a.textContent = t;
    },
    dispose() {
      p.remove();
      a.remove();
    },
  };
}

/** A link that is the first thing Tab reaches and jumps to `target`. */
export function createSkipLink(
  parent: HTMLElement,
  target: HTMLElement,
  label: string,
): HTMLAnchorElement {
  if (target.id === '') target.id = 'main-content';
  const a = document.createElement('a');
  a.className = 'skip-link';
  a.href = `#${target.id}`;
  a.textContent = label;
  a.addEventListener('click', (e) => {
    e.preventDefault();
    target.focus();
  });
  parent.insertBefore(a, parent.firstChild);
  return a;
}
