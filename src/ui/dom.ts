/** Tiny DOM helpers for the panels. Text is always set through textContent, never innerHTML. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: HTMLElement,
  text = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** Write text only when it differs from what is there. */
export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Set `hidden` only when it changes. */
export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

/** Set `className` only when it changes. */
export function setClass(node: HTMLElement, className: string): void {
  if (node.className !== className) node.className = className;
}

export function setDisabled(node: HTMLButtonElement, disabled: boolean): void {
  if (node.disabled !== disabled) node.disabled = disabled;
}

let helpCounter = 0;

/**
 * Attach a one-sentence help text (M7c): a `title` tooltip on `target` and a visually hidden note
 * inside `host` that `controls` reference with `aria-describedby`. Returns the note's id.
 */
export function describe(
  target: HTMLElement,
  text: string,
  host: HTMLElement,
  controls: readonly HTMLElement[] = [],
): string {
  const id = `help-${++helpCounter}`;
  const note = el('span', 'sr-only', host, text);
  note.id = id;
  target.title = text;
  target.setAttribute('aria-describedby', id);
  for (const c of controls) c.setAttribute('aria-describedby', id);
  return id;
}
