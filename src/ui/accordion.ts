/**
 * Collapsible sections of the right column (Colonies, Research). At most one section of a group
 * is open: opening one closes the others, so the column never turns into one long scroll. The
 * state lives in memory only (a page reload starts from the initial section), never in
 * localStorage. The state object is pure; `bindDetails` connects it to a <details> element.
 */

export interface Accordion {
  isOpen(key: string): boolean;
  /** The open section, or null when all are closed. */
  openKey(): string | null;
  /**
   * The player opened or closed `key`. Opening closes the others. A key that is not part of the
   * group is ignored. Returns true when the state changed.
   */
  set(key: string, open: boolean): boolean;
  /** Called after every change. Returns the function that removes the listener. */
  subscribe(fn: () => void): () => void;
}

export function createAccordion(keys: readonly string[], initial: string | null): Accordion {
  let current: string | null = initial !== null && keys.includes(initial) ? initial : null;
  const listeners = new Set<() => void>();
  return {
    isOpen: (key) => key === current,
    openKey: () => current,
    set(key, open) {
      if (!keys.includes(key)) return false;
      const next = open ? key : current === key ? null : current;
      if (next === current) return false;
      current = next;
      for (const fn of listeners) fn();
      return true;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** The group shared by the Colonies and Research panels. Colonies starts open. */
export const sectionAccordion: Accordion = createAccordion(['colonies', 'research'], 'colonies');

/** Keep `details.open` and the accordion in step. Returns the function that unbinds them. */
export function bindDetails(acc: Accordion, key: string, details: HTMLDetailsElement): () => void {
  details.open = acc.isOpen(key);
  const onToggle = (): void => {
    if (details.open !== acc.isOpen(key)) acc.set(key, details.open);
  };
  details.addEventListener('toggle', onToggle);
  const unsubscribe = acc.subscribe(() => {
    const want = acc.isOpen(key);
    if (details.open !== want) details.open = want;
  });
  return () => {
    details.removeEventListener('toggle', onToggle);
    unsubscribe();
  };
}
