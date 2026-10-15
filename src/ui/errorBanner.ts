import { el } from './dom';

export interface ErrorBanner {
  show(text: string): void;
  dispose(): void;
}

/** A visible, assertive banner for fatal problems such as a crashed worker. */
export function createErrorBanner(root: HTMLElement): ErrorBanner {
  const box = el('div', 'err-banner', root);
  box.setAttribute('role', 'alert');
  box.hidden = true;
  return {
    show(text) {
      box.textContent = text;
      box.hidden = false;
    },
    dispose() {
      box.remove();
    },
  };
}
